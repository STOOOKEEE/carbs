// Sessions in the test app: open one with Touch ID or the Stax, act with the session key
// without any prompt, and watch the node refuse what the session does not allow.
// The session key lives in this page's memory only (proof of concept).

import { generateSeed } from "ripple-keypairs";

import { type Connection, requestFunding, signAndSubmitWithPasskey } from "./account.ts";
import { element, guarded } from "./dom.ts";
import {
  type SubmittedTx,
  type TxJson,
  addressOfSeed,
  autofill,
  read,
  signWithSeed,
  submitAndWait,
} from "./ledger.ts";
import { signAndSubmitWithStax, staxAccount } from "./ledger-panel.ts";
import { log, logError } from "./log.ts";
import { RpcError, type RpcResult } from "./rpc.ts";
import {
  type SessionMode,
  type SessionRules,
  TF_ALL_TRANSACTIONS,
  closeSessionTx,
  openSessionTx,
  paymentTx,
  witnessSign,
} from "./session.ts";
import type { StoredWallet } from "./storage.ts";

const DROPS_PER_XRP = 1_000_000;
const COUNTDOWN_INTERVAL_MS = 1_000;
/** Seconds between the Unix epoch and the XRPL epoch (2000-01-01). */
const RIPPLE_EPOCH_OFFSET_S = 946_684_800;
/** AccountSet flag asfDefaultRipple: an account setting no session may change. */
const ASF_DEFAULT_RIPPLE = 8;

/** Mode P choices: PermissionValue = transaction type + 1. */
const PERMISSIONS: ReadonlyArray<{ name: string; value: number }> = [
  { name: "Payment", value: 1 },
  { name: "EscrowCreate", value: 2 },
  { name: "OfferCreate", value: 8 },
  { name: "TrustSet", value: 21 },
  { name: "NFTokenMint", value: 26 },
];

const OPENER_LABELS = {
  passkey: "Touch ID",
  staxClassic: "Stax classique",
  staxPostQuantum: "Stax ML-DSA",
} as const;
type OpenerLabel = (typeof OPENER_LABELS)[keyof typeof OPENER_LABELS];

interface ActiveSession {
  owner: string;
  openedBy: OpenerLabel;
  keySeed: string;
  keyAddress: string;
  rules: SessionRules;
  witnessSeed?: string;
  closed: boolean;
}

const ui = {
  info: element("session-info", HTMLElement),
  opener: element("session-opener", HTMLSelectElement),
  mode: element("session-mode", HTMLSelectElement),
  duration: element("session-duration", HTMLInputElement),
  capFields: element("session-cap-fields", HTMLFieldSetElement),
  permissions: element("session-permissions", HTMLFieldSetElement),
  cap: element("session-cap", HTMLInputElement),
  maxPerTx: element("session-max-per-tx", HTMLInputElement),
  witness: element("session-witness", HTMLInputElement),
  open: element("session-open", HTMLButtonElement),
  payForm: element("session-pay-form", HTMLFormElement),
  payDestination: element("session-pay-destination", HTMLInputElement),
  payAmount: element("session-pay-amount", HTMLInputElement),
  attackRegularKey: element("attack-regular-key", HTMLButtonElement),
  attackAccountSet: element("attack-account-set", HTMLButtonElement),
  attackPerTx: element("attack-per-tx", HTMLButtonElement),
  attackNoWitness: element("attack-no-witness", HTMLButtonElement),
  close: element("session-close", HTMLButtonElement),
  attackAfterClose: element("attack-after-close", HTMLButtonElement),
};

let active: ActiveSession | undefined;

function isSessionMode(value: string): value is SessionMode {
  return value === "cap" || value === "all" || value === "permissions";
}

function selectedMode(): SessionMode {
  const value = ui.mode.value;
  if (!isSessionMode(value)) throw new Error(`unknown session mode ${value}`);
  return value;
}

function selectedPermissions(): number[] {
  const values = Array.from(ui.permissions.querySelectorAll("input"))
    .filter((input) => input.type === "checkbox" && input.checked)
    .map((input) => Number(input.value));
  if (values.length === 0) throw new Error("tick at least one permission");
  return values;
}

function permissionName(value: number): string {
  return PERMISSIONS.find((permission) => permission.value === value)?.name ?? `#${value}`;
}

function maxPerTxXrp(rules: SessionRules): number | undefined {
  return rules.mode === "cap" ? rules.maxPerTxXrp : undefined;
}

/** Mode C shows the cap inputs, mode P the permission checkboxes, mode A neither. */
function showModeFields(): void {
  const mode = selectedMode();
  ui.capFields.hidden = mode !== "cap";
  ui.permissions.hidden = mode !== "permissions";
}

function buildPermissionCheckboxes(): void {
  for (const { name, value } of PERMISSIONS) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(value);
    input.checked = value === PERMISSIONS[0]?.value;
    const label = document.createElement("label");
    label.className = "inline";
    label.append(input, ` ${name}`);
    ui.permissions.append(label);
  }
}

/** The session's ledger entry; undefined once it is gone (closed or deleted). */
async function sessionEntry(
  connection: Connection,
  session: ActiveSession,
): Promise<RpcResult | undefined> {
  try {
    return await connection.node.request("ledger_entry", {
      signing_session: { account: session.owner, session_key: session.keyAddress },
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
}

function destination(): string {
  const value = ui.payDestination.value.trim();
  if (value === "") throw new Error("fill in a destination first");
  return value;
}

function positiveNumber(input: HTMLInputElement, label: string): number {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive number`);
  return value;
}

/** A transaction of the owner, signed by the session key (and the witness when required): no prompt. */
async function submitWithSessionKey(
  connection: Connection,
  session: ActiveSession,
  tx: TxJson,
  withWitness = true,
): Promise<SubmittedTx> {
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: session.owner,
  });
  const signed = signWithSeed(connection.defs, filled, session.keySeed);
  const final =
    withWitness && session.witnessSeed !== undefined
      ? witnessSign(connection.defs, signed, session.witnessSeed)
      : signed;
  return submitAndWait(connection.node, connection.defs, final);
}

async function openSession(
  connection: Connection,
  wallet: StoredWallet | undefined,
): Promise<void> {
  const opener = ui.opener.value === "stax" ? "stax" : "passkey";
  const owner = opener === "passkey" ? wallet?.address : staxAccount()?.address;
  if (owner === undefined)
    throw new Error(
      opener === "passkey" ? "create the passkey account first" : "connect the Stax first",
    );

  const durationSeconds = positiveNumber(ui.duration, "the duration");
  const mode = selectedMode();
  const rules: SessionRules =
    mode === "cap"
      ? {
          mode,
          durationSeconds,
          capXrp: positiveNumber(ui.cap, "the cap"),
          ...(ui.maxPerTx.value === ""
            ? {}
            : { maxPerTxXrp: positiveNumber(ui.maxPerTx, "the cap per payment") }),
        }
      : mode === "all"
        ? { mode, durationSeconds }
        : { mode, durationSeconds, permissions: selectedPermissions() };
  let witnessSeed: string | undefined;
  if (ui.witness.checked) {
    witnessSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
    const witnessAddress = addressOfSeed(witnessSeed);
    await requestFunding(witnessAddress);
    log(`Témoin créé et financé par le faucet : ${witnessAddress}`);
    rules.witness = witnessAddress;
  }

  const keySeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const keyAddress = addressOfSeed(keySeed);
  const tx = openSessionTx(owner, keyAddress, rules);
  const postQuantum = staxAccount()?.postQuantum ?? false;
  const openedBy =
    opener === "passkey"
      ? OPENER_LABELS.passkey
      : postQuantum
        ? OPENER_LABELS.staxPostQuantum
        : OPENER_LABELS.staxClassic;
  log(
    `Ouverture d'une session pour ${keyAddress} : ${opener === "passkey" ? "validez avec Touch ID" : "relisez les règles sur la Stax"}…`,
  );
  const submitted =
    opener === "passkey" && wallet !== undefined
      ? await signAndSubmitWithPasskey(connection, wallet, tx)
      : await signAndSubmitWithStax(connection, tx, postQuantum);
  log("SigningSessionSet :", submitted);
  if (submitted.result !== "tesSUCCESS") return;

  active = {
    owner,
    openedBy,
    keySeed,
    keyAddress,
    rules,
    ...(witnessSeed === undefined ? {} : { witnessSeed }),
    closed: false,
  };
}

export async function refreshSessionPanel(connection: Connection | undefined): Promise<void> {
  const usable = connection !== undefined && active !== undefined && !active.closed;
  ui.open.disabled = connection === undefined;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement)
      field.disabled = !usable;
  }
  ui.attackRegularKey.disabled = !usable;
  ui.attackAccountSet.disabled = !usable;
  ui.attackPerTx.disabled =
    !usable || active === undefined || maxPerTxXrp(active.rules) === undefined;
  ui.attackNoWitness.disabled = !usable || active?.witnessSeed === undefined;
  ui.close.disabled = !usable;
  ui.attackAfterClose.disabled = connection === undefined || active?.closed !== true;

  if (active === undefined || connection === undefined) {
    ui.info.textContent = "Aucune session ouverte.";
    return;
  }
  const entry = await sessionEntry(connection, active);
  const header = `Clé de session ${active.keyAddress} pour ${active.owner}, ouverte par ${active.openedBy}`;
  if (entry === undefined) {
    ui.info.textContent = `${header} · ${active.closed ? "fermée" : "absente du ledger"}`;
    return;
  }
  ui.info.textContent = [header, ...describeEntry(read(entry, ["node"]))].join(" · ");
}

function xrp(value: unknown): string {
  return typeof value === "string" ? `${Number(value) / DROPS_PER_XRP}` : "?";
}

/** The node renders PermissionValue as its name ("Payment", "TrustlineAuthorize"); a number is mapped through the table. */
function permissionLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return permissionName(value);
  return "?";
}

/** Mode, limits, witness and time left, as the node stores them in the session entry. */
function describeEntry(node: unknown): string[] {
  const flags = read(node, ["Flags"]);
  const permissions = read(node, ["Permissions"]);
  const cap = read(node, ["SessionCap"]);
  const maxPerTx = read(node, ["SessionMaxPerTx"]);
  const witness = read(node, ["SessionWitness"]);
  const expiration = read(node, ["Expiration"]);

  const parts: string[] = [];
  if (typeof flags === "number" && (flags & TF_ALL_TRANSACTIONS) !== 0) {
    parts.push("mode A : toutes les transactions délégables");
  } else if (Array.isArray(permissions)) {
    const names = permissions.map((permission) =>
      permissionLabel(read(permission, ["Permission", "PermissionValue"])),
    );
    parts.push(`mode P : ${names.join(", ")}`);
  } else if (cap !== undefined) {
    parts.push(`mode C : dépensé ${xrp(read(node, ["SessionSpent"]))} / ${xrp(cap)} XRP`);
    if (maxPerTx !== undefined) parts.push(`max ${xrp(maxPerTx)} XRP par paiement`);
  }
  if (typeof witness === "string") parts.push(`témoin ${witness}`);
  if (typeof expiration === "number") {
    const nowRipple = Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_OFFSET_S;
    const remaining = expiration - nowRipple;
    parts.push(remaining > 0 ? `expire dans ${remaining} s` : "expirée");
  }
  return parts;
}

export function setupSessionPanel(
  getConnection: () => Connection | undefined,
  getWallet: () => StoredWallet | undefined,
  refreshAll: () => Promise<void>,
): void {
  buildPermissionCheckboxes();
  showModeFields();
  ui.mode.addEventListener("change", showModeFields);

  const run = (action: () => Promise<void>) => guarded(action, logError, refreshAll);
  const withSession = (action: (connection: Connection, session: ActiveSession) => Promise<void>) =>
    run(async () => {
      const connection = getConnection();
      if (connection === undefined || active === undefined) return;
      await action(connection, active);
    });

  ui.open.addEventListener(
    "click",
    run(async () => {
      const connection = getConnection();
      if (connection !== undefined) await openSession(connection, getWallet());
    }),
  );

  ui.payForm.addEventListener("submit", (event) => {
    event.preventDefault();
    withSession(async (connection, session) => {
      const amount = positiveNumber(ui.payAmount, "the amount");
      const tx = paymentTx(session.owner, destination(), amount);
      log(
        `Paiement de ${amount} XRP par la clé de session (aucune validation demandée)…`,
        await submitWithSessionKey(connection, session, tx),
      );
    })();
  });

  ui.attackRegularKey.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const tx: TxJson = {
        TransactionType: "SetRegularKey",
        Account: session.owner,
        RegularKey: session.keyAddress,
      };
      log(
        "Attaque : la clé de session volée tente de devenir la RegularKey du compte :",
        await submitWithSessionKey(connection, session, tx),
      );
    }),
  );

  ui.attackAccountSet.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const tx: TxJson = {
        TransactionType: "AccountSet",
        Account: session.owner,
        SetFlag: ASF_DEFAULT_RIPPLE,
      };
      log(
        "Attaque : la clé de session volée tente de modifier les réglages du compte (AccountSet) :",
        await submitWithSessionKey(connection, session, tx),
      );
    }),
  );

  ui.attackPerTx.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const amount = (maxPerTxXrp(session.rules) ?? 0) + 1;
      const tx = paymentTx(session.owner, destination(), amount);
      log(
        `Attaque : paiement de ${amount} XRP, au-dessus du plafond par paiement :`,
        await submitWithSessionKey(connection, session, tx),
      );
    }),
  );

  ui.attackNoWitness.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const tx = paymentTx(session.owner, destination(), 1);
      log(
        "Attaque : paiement sans la co-signature du témoin :",
        await submitWithSessionKey(connection, session, tx, false),
      );
    }),
  );

  ui.close.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const submitted = await submitWithSessionKey(
        connection,
        session,
        closeSessionTx(session.owner, session.keyAddress),
        false,
      );
      log("La clé de session ferme sa propre session :", submitted);
      if (submitted.result === "tesSUCCESS") session.closed = true;
    }),
  );

  ui.attackAfterClose.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const tx = paymentTx(session.owner, destination(), 1);
      log(
        "Attaque : paiement avec la clé après la fermeture :",
        await submitWithSessionKey(connection, session, tx),
      );
    }),
  );

  setInterval(
    () => void refreshSessionPanel(getConnection()).catch(logError),
    COUNTDOWN_INTERVAL_MS,
  );
}
