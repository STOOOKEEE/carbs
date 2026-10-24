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
  type SessionRules,
  closeSessionTx,
  openSessionTx,
  paymentTx,
  witnessSign,
} from "./session.ts";
import type { StoredWallet } from "./storage.ts";

const DROPS_PER_XRP = 1_000_000;
const COUNTDOWN_INTERVAL_MS = 1_000;

interface ActiveSession {
  owner: string;
  keySeed: string;
  keyAddress: string;
  rules: SessionRules;
  witnessSeed?: string;
  /** Unix time, seconds: when the node will refuse the session key. */
  expiresAt: number;
  closed: boolean;
}

const ui = {
  info: element("session-info", HTMLElement),
  opener: element("session-opener", HTMLSelectElement),
  duration: element("session-duration", HTMLInputElement),
  cap: element("session-cap", HTMLInputElement),
  maxPerTx: element("session-max-per-tx", HTMLInputElement),
  witness: element("session-witness", HTMLInputElement),
  open: element("session-open", HTMLButtonElement),
  payForm: element("session-pay-form", HTMLFormElement),
  payDestination: element("session-pay-destination", HTMLInputElement),
  payAmount: element("session-pay-amount", HTMLInputElement),
  attackRegularKey: element("attack-regular-key", HTMLButtonElement),
  attackPerTx: element("attack-per-tx", HTMLButtonElement),
  attackNoWitness: element("attack-no-witness", HTMLButtonElement),
  close: element("session-close", HTMLButtonElement),
  attackAfterClose: element("attack-after-close", HTMLButtonElement),
};

let active: ActiveSession | undefined;

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

  const rules: SessionRules = {
    durationSeconds: positiveNumber(ui.duration, "the duration"),
    capXrp: positiveNumber(ui.cap, "the cap"),
    ...(ui.maxPerTx.value === ""
      ? {}
      : { maxPerTxXrp: positiveNumber(ui.maxPerTx, "the cap per payment") }),
  };
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
  log(
    `Ouverture d'une session pour ${keyAddress} : ${opener === "passkey" ? "validez avec Touch ID" : "relisez les règles sur la Stax"}…`,
  );
  const submitted =
    opener === "passkey" && wallet !== undefined
      ? await signAndSubmitWithPasskey(connection, wallet, tx)
      : await signAndSubmitWithStax(connection, tx, staxAccount()?.postQuantum ?? false);
  log("SigningSessionSet :", submitted);
  if (submitted.result !== "tesSUCCESS") return;

  active = {
    owner,
    keySeed,
    keyAddress,
    rules,
    ...(witnessSeed === undefined ? {} : { witnessSeed }),
    expiresAt: Math.floor(Date.now() / 1000) + rules.durationSeconds,
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
  ui.attackPerTx.disabled = !usable || active?.rules.maxPerTxXrp === undefined;
  ui.attackNoWitness.disabled = !usable || active?.witnessSeed === undefined;
  ui.close.disabled = !usable;
  ui.attackAfterClose.disabled = connection === undefined || active?.closed !== true;

  if (active === undefined || connection === undefined) {
    ui.info.textContent = "Aucune session ouverte.";
    return;
  }
  const entry = await sessionEntry(connection, active);
  const spent = read(entry, ["node", "SessionSpent"]);
  const remaining = Math.max(0, active.expiresAt - Math.floor(Date.now() / 1000));
  ui.info.textContent = [
    `Clé de session ${active.keyAddress} pour ${active.owner}`,
    active.closed ? "fermée" : `expire dans ${remaining} s`,
    `dépensé ${typeof spent === "string" ? Number(spent) / DROPS_PER_XRP : "?"} / ${active.rules.capXrp} XRP`,
    active.rules.maxPerTxXrp === undefined
      ? ""
      : `max ${active.rules.maxPerTxXrp} XRP par paiement`,
    active.witnessSeed === undefined ? "" : "témoin requis",
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

export function setupSessionPanel(
  getConnection: () => Connection | undefined,
  getWallet: () => StoredWallet | undefined,
  refreshAll: () => Promise<void>,
): void {
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

  ui.attackPerTx.addEventListener(
    "click",
    withSession(async (connection, session) => {
      const amount = (session.rules.maxPerTxXrp ?? 0) + 1;
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
