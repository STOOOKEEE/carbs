// Sessions in the test app: open one with Touch ID or the Stax, act with the session key
// without any prompt, and watch the node refuse what the session does not allow.
// The session key lives in this page's memory only (proof of concept).

import { generateSeed } from "ripple-keypairs";

import { type Connection, requestFunding, signAndSubmitWithPasskey } from "./account.ts";
import { batchInnerResults } from "./batch-results.ts";
import { TF_ALL_OR_NOTHING, TF_INDEPENDENT, batchGroups, batchTx } from "./batch.ts";
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
import { log, logError, logInnerResults } from "./log.ts";
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
  batchDestination: element("session-batch-destination", HTMLInputElement),
  batchAmount: element("session-batch-amount", HTMLInputElement),
  openBatch: element("session-open-batch", HTMLButtonElement),
  revokeAll: element("session-revoke-all", HTMLButtonElement),
  payForm: element("session-pay-form", HTMLFormElement),
  payDestination: element("session-pay-destination", HTMLInputElement),
  payAmount: element("session-pay-amount", HTMLInputElement),
  attackRegularKey: element("attack-regular-key", HTMLButtonElement),
  attackAccountSet: element("attack-account-set", HTMLButtonElement),
  attackPerTx: element("attack-per-tx", HTMLButtonElement),
  attackNoWitness: element("attack-no-witness", HTMLButtonElement),
  attackBatch: element("attack-batch", HTMLButtonElement),
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

function destination(input: HTMLInputElement = ui.payDestination): string {
  const value = input.value.trim();
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

/** The account that opens or revokes sessions, as chosen in "Ouvrir avec", and how it signs. */
interface OwnerSigner {
  owner: string;
  openedBy: OpenerLabel;
  /** What the user must do to validate, for the journal. */
  prompt: string;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

function ownerSigner(connection: Connection, wallet: StoredWallet | undefined): OwnerSigner {
  if (ui.opener.value !== "stax") {
    if (wallet === undefined) throw new Error("create the passkey account first");
    return {
      owner: wallet.address,
      openedBy: OPENER_LABELS.passkey,
      prompt: "validez avec Touch ID",
      signAndSubmit: (tx) => signAndSubmitWithPasskey(connection, wallet, tx),
    };
  }
  const stax = staxAccount();
  if (stax === undefined) throw new Error("connect the Stax first");
  return {
    owner: stax.address,
    openedBy: stax.postQuantum ? OPENER_LABELS.staxPostQuantum : OPENER_LABELS.staxClassic,
    prompt: "relisez sur la Stax",
    signAndSubmit: (tx) => signAndSubmitWithStax(connection, tx, stax.postQuantum),
  };
}

/** The rules set in the panel; a witness, when asked for, is created and funded here. */
async function panelRules(): Promise<{ rules: SessionRules; witnessSeed: string | undefined }> {
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
  if (!ui.witness.checked) return { rules, witnessSeed: undefined };
  const witnessSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const witnessAddress = addressOfSeed(witnessSeed);
  await requestFunding(witnessAddress);
  log(`Témoin créé et financé par le faucet : ${witnessAddress}`);
  rules.witness = witnessAddress;
  return { rules, witnessSeed };
}

/** Reads what a validated Batch applied and journals each inner transaction. */
async function logBatch(
  connection: Connection,
  label: string,
  submitted: SubmittedTx,
): Promise<Array<string | undefined>> {
  log(`${label} (Batch externe) :`, submitted);
  if (submitted.result !== "tesSUCCESS") return [];
  const inner = await batchInnerResults(connection.node, submitted.hash);
  logInnerResults(inner);
  return inner.map((tx) => tx.applied?.result);
}

/**
 * Opens a session with the panel's rules, signed by the owner. With a first payment, the opening
 * and the payment travel in one all-or-nothing Batch: one validation for both.
 */
async function openSession(
  connection: Connection,
  wallet: StoredWallet | undefined,
  firstPayment?: { destination: string; amountXrp: number },
): Promise<void> {
  const signer = ownerSigner(connection, wallet);
  const { rules, witnessSeed } = await panelRules();
  const keySeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const keyAddress = addressOfSeed(keySeed);
  const tx = openSessionTx(signer.owner, keyAddress, rules);

  let opened: boolean;
  if (firstPayment === undefined) {
    log(`Ouverture d'une session pour ${keyAddress} : ${signer.prompt}…`);
    const submitted = await signer.signAndSubmit(tx);
    log("SigningSessionSet :", submitted);
    opened = submitted.result === "tesSUCCESS";
  } else {
    const payment = paymentTx(signer.owner, firstPayment.destination, firstPayment.amountXrp);
    log(
      `Ouverture d'une session pour ${keyAddress} et paiement de ${firstPayment.amountXrp} XRP en un seul Batch (tout ou rien) : ${signer.prompt}…`,
    );
    const submitted = await signer.signAndSubmit(
      batchTx(signer.owner, [tx, payment], TF_ALL_OR_NOTHING),
    );
    const [openResult] = await logBatch(connection, "Ouvrir et payer", submitted);
    opened = openResult === "tesSUCCESS";
  }
  if (!opened) return;

  active = {
    owner: signer.owner,
    openedBy: signer.openedBy,
    keySeed,
    keyAddress,
    rules,
    ...(witnessSeed === undefined ? {} : { witnessSeed }),
    closed: false,
  };
}

/** SessionKey of every signing_session entry of `owner`, page after page. */
async function sessionKeysOf(connection: Connection, owner: string): Promise<string[]> {
  const keys: string[] = [];
  let marker: unknown;
  do {
    const page = await connection.node.request("account_objects", {
      account: owner,
      type: "signing_session",
      ledger_index: "current",
      ...(marker === undefined ? {} : { marker }),
    });
    const objects = read(page, ["account_objects"]);
    if (!Array.isArray(objects)) throw new Error("unexpected node answer: account_objects");
    for (const object of objects) {
      const key = read(object, ["SessionKey"]);
      if (typeof key === "string") keys.push(key);
    }
    marker = read(page, ["marker"]);
  } while (marker !== undefined);
  return keys;
}

/**
 * Deletes every session of the owner, signed by the owner: one SigningSessionDelete for a single
 * session, otherwise independent Batches of up to 8 deletions, one validation each.
 */
async function revokeAllSessions(
  connection: Connection,
  wallet: StoredWallet | undefined,
): Promise<void> {
  const signer = ownerSigner(connection, wallet);
  const keys = await sessionKeysOf(connection, signer.owner);
  if (keys.length === 0) {
    log(`Aucune session à révoquer pour ${signer.owner}.`);
    return;
  }
  const groups = batchGroups(keys);
  log(
    `Révocation de ${keys.length} session(s) de ${signer.owner} en ${groups.length} validation(s) : ${signer.prompt}…`,
  );
  for (const group of groups) {
    // The owner deletes its own sessions: Account is the owner, no Owner field.
    const deletes = group.map((key) => closeSessionTx(signer.owner, key));
    const [single] = deletes;
    let results: Array<string | undefined>;
    if (deletes.length === 1 && single !== undefined) {
      const submitted = await signer.signAndSubmit(single);
      log("SigningSessionDelete par le propriétaire :", submitted);
      results = [submitted.result];
    } else {
      const submitted = await signer.signAndSubmit(batchTx(signer.owner, deletes, TF_INDEPENDENT));
      results = await logBatch(connection, "Révoquer toutes les sessions", submitted);
    }
    const session = active;
    if (session !== undefined && session.owner === signer.owner) {
      const index = group.indexOf(session.keyAddress);
      if (index !== -1 && results[index] === "tesSUCCESS") session.closed = true;
    }
  }
}

export async function refreshSessionPanel(connection: Connection | undefined): Promise<void> {
  const usable = connection !== undefined && active !== undefined && !active.closed;
  ui.open.disabled = connection === undefined;
  ui.openBatch.disabled = connection === undefined;
  ui.batchDestination.disabled = connection === undefined;
  ui.batchAmount.disabled = connection === undefined;
  ui.revokeAll.disabled = connection === undefined;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement)
      field.disabled = !usable;
  }
  ui.attackRegularKey.disabled = !usable;
  ui.attackAccountSet.disabled = !usable;
  ui.attackPerTx.disabled =
    !usable || active === undefined || maxPerTxXrp(active.rules) === undefined;
  ui.attackNoWitness.disabled = !usable || active?.witnessSeed === undefined;
  ui.attackBatch.disabled = !usable;
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

  ui.openBatch.addEventListener(
    "click",
    run(async () => {
      const connection = getConnection();
      if (connection === undefined) return;
      await openSession(connection, getWallet(), {
        destination: destination(ui.batchDestination),
        amountXrp: positiveNumber(ui.batchAmount, "the amount"),
      });
    }),
  );

  ui.revokeAll.addEventListener(
    "click",
    run(async () => {
      const connection = getConnection();
      if (connection !== undefined) await revokeAllSessions(connection, getWallet());
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

  ui.attackBatch.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const to = destination();
      const batch = batchTx(
        session.owner,
        [paymentTx(session.owner, to, 1), paymentTx(session.owner, to, 1)],
        TF_ALL_OR_NOTHING,
      );
      log(
        "Attaque : la clé de session tente de signer un Batch du compte (attendu tefSESSION_TX_NOT_ALLOWED) :",
        await submitWithSessionKey(connection, session, batch),
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
