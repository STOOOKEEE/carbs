// The post-quantum Touch ID account: the passkey never goes on the ledger. Its PRF output
// (released only after Touch ID) unlocks an ML-DSA-44 seed kept encrypted in this browser,
// and that ML-DSA-44 key is the account's only authority (RegularKey, master key disabled).

import { addressFromPublicKey, generateMlDsaSeed, mlDsaKeyPairFromSeed } from "@carbs/sessions";
import { generateSeed } from "ripple-keypairs";

import { type Connection, requestFunding } from "./account.ts";
import { element, guarded } from "./dom.ts";
import { hexToBytes } from "./hex.ts";
import {
  type SubmittedTx,
  type TxJson,
  accountInfo,
  addressOfSeed,
  autofill,
  read,
  signWithSeed,
  submitAndWait,
} from "./ledger.ts";
import { explorerLink, log, logError } from "./log.ts";
import { disableMasterTx, proofTx, regularKeyTx } from "./pq-migration.ts";
import {
  PrfUnsupportedError,
  createPrfPasskey,
  evaluatePrf,
  prfAvailable,
} from "./pq-passkey/prf.ts";
import {
  type PqVault,
  clearVault,
  loadVault,
  openSeed,
  saveVault,
  sealSeed,
  signTxMlDsa,
} from "./pq-passkey/vault.ts";
import { openSessionTx, paymentTx, type SessionRules } from "./session.ts";

const SUCCESS = "tesSUCCESS";
const DROPS_PER_XRP = 1_000_000;
/** Bytes of the PRF input (salt) stored next to the encrypted seed. */
const PRF_SALT_BYTES = 32;
/** lsfDisableMaster in AccountRoot Flags. */
const LSF_DISABLE_MASTER = 0x00100000;
const ML_DSA_44_PUBLIC_KEY_BYTES = 1312;
/** The mode C session opened by the ML-DSA-44 key. */
const SESSION_RULES = {
  mode: "cap",
  capXrp: 20,
  maxPerTxXrp: 5,
  durationSeconds: 300,
  maxTxCount: 50,
} satisfies SessionRules;
const PRF_UNSUPPORTED_MESSAGE =
  "This browser does not provide the WebAuthn PRF extension: use Safari 18 or later (macOS 15 Sequoia) or a recent Chrome with an iCloud Keychain passkey.";
const AUTHORITY_VERIFIED = `On the ledger: no P-256 key, authority = ML-DSA-44 (${ML_DSA_44_PUBLIC_KEY_BYTES} bytes)`;

const ui = {
  prfStatus: element("pq-prf-status", HTMLElement),
  accountInfo: element("pq-account-info", HTMLElement),
  authority: element("pq-ledger-authority", HTMLElement),
  create: element("pq-create", HTMLButtonElement),
  forget: element("pq-forget", HTMLButtonElement),
  payForm: element("pq-pay-form", HTMLFormElement),
  payDestination: element("pq-pay-destination", HTMLInputElement),
  payAmount: element("pq-pay-amount", HTMLInputElement),
  session: element("pq-session", HTMLButtonElement),
};

let vault: PqVault | undefined = loadVault();
let prfSupported = true;

function showPrfUnsupported(): void {
  prfSupported = false;
  ui.prfStatus.textContent = PRF_UNSUPPORTED_MESSAGE;
  ui.prfStatus.className = "error";
}

function onError(error: unknown): void {
  if (error instanceof PrfUnsupportedError) showPrfUnsupported();
  logError(error);
}

function requireSuccess(step: string, tx: SubmittedTx): void {
  if (tx.result !== SUCCESS) throw new Error(`${step} failed (${tx.result}): creation stopped`);
}

function destination(): string {
  const value = ui.payDestination.value.trim();
  if (value === "") throw new Error("fill in a destination");
  return value;
}

function amountXrp(): number {
  const value = Number(ui.payAmount.value);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("the amount must be a positive number of XRP");
  return value;
}

function requireVault(): PqVault {
  if (vault === undefined) throw new Error("create the post-quantum account first");
  return vault;
}

/** Touch ID, then the PRF secret opens the ML-DSA-44 seed; the secret is wiped at once. */
async function unlockSeed(current: PqVault): Promise<Uint8Array> {
  log("Approve with Touch ID (the passkey releases the ML-DSA-44 key)…");
  const secret = await evaluatePrf(
    { credentialId: current.credentialId },
    hexToBytes(current.salt),
  );
  try {
    return await openSeed(secret, current);
  } finally {
    secret.fill(0);
  }
}

/** The key that signs a transaction: the bootstrap master key, or an ML-DSA-44 seed the caller wipes. */
type SigningKey = { masterSeed: string } | { mlDsaSeed: Uint8Array };

/** Autofills, signs with `key`, then submits and waits for validation. */
async function submitSigned(
  { node, defs }: Connection,
  key: SigningKey,
  tx: TxJson,
): Promise<SubmittedTx> {
  const filled = await autofill(node, defs, tx);
  const signed =
    "masterSeed" in key
      ? signWithSeed(defs, filled, key.masterSeed)
      : signTxMlDsa(defs, filled, key.mlDsaSeed);
  return submitAndWait(node, defs, signed);
}

/** The account's transaction signed by its ML-DSA-44 key after a Touch ID; the seed is wiped. */
async function submitWithVault(connection: Connection, tx: TxJson): Promise<SubmittedTx> {
  const current = requireVault();
  const seed = await unlockSeed(current);
  try {
    return await submitSigned(connection, { mlDsaSeed: seed }, { ...tx, Account: current.account });
  } finally {
    seed.fill(0);
  }
}

/**
 * The full creation: ML-DSA-44 seed, PRF passkey (Touch ID twice), a classical bootstrap account
 * funded by the faucet whose master key hands the account to the ML-DSA-44 key and is then
 * disabled and forgotten, and the seed sealed with the PRF secret.
 */
async function createAccount(connection: Connection): Promise<void> {
  // Touch ID first, while the click's user activation lasts.
  const bootstrapSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const account = addressOfSeed(bootstrapSeed);
  log("Creating the PRF passkey (Touch ID)…");
  const passkey = await createPrfPasskey(`carbs PQ ${account.slice(0, 8)}`);
  const salt = crypto.getRandomValues(new Uint8Array(PRF_SALT_BYTES));
  log("Deriving the PRF secret: approve with Touch ID again…");
  const secret = await evaluatePrf(passkey, salt);

  const seed = generateMlDsaSeed();
  try {
    let sealed: PqVault;
    try {
      sealed = await sealSeed(secret, seed, {
        credentialId: passkey.credentialId,
        account,
        salt,
      });
    } finally {
      secret.fill(0);
    }
    const mlDsaAddress = sealed.mlDsaAddress;
    log(`ML-DSA-44 key generated (address ${mlDsaAddress}), sealed with the PRF secret.`);

    log(`Funding the bootstrap account ${account} from the faucet…`);
    await requestFunding(account);

    const master: SigningKey = { masterSeed: bootstrapSeed };
    const regularKey = await submitSigned(connection, master, regularKeyTx(account, mlDsaAddress));
    log("1/3 SetRegularKey to the ML-DSA-44 key (bootstrap master key):", regularKey);
    requireSuccess("SetRegularKey", regularKey);

    const proof = await submitSigned(connection, { mlDsaSeed: seed }, proofTx(account));
    log("2/3 AccountSet proof signed with ML-DSA-44:", proof);
    requireSuccess("The ML-DSA-44 proof", proof);

    const disableMaster = await submitSigned(connection, master, disableMasterTx(account));
    log("3/3 AccountSet asfDisableMaster (bootstrap master key):", disableMaster);
    requireSuccess("Disabling the master key", disableMaster);

    saveVault(sealed);
    vault = sealed;
    log(
      `Account ${account} created: master key disabled and forgotten, only the ML-DSA-44 key signs, unlocked by Touch ID.`,
    );
    await logPasskeyLists(connection, account);
  } finally {
    seed.fill(0);
  }
}

/** Number of passkey_list entries of the account (expected 0: the passkey is not on the ledger). */
async function passkeyListCount(connection: Connection, account: string): Promise<number> {
  const answer = await connection.node.request("account_objects", {
    account,
    type: "passkey_list",
    ledger_index: "validated",
  });
  const objects = read(answer, ["account_objects"]);
  if (!Array.isArray(objects)) throw new Error("unexpected node answer: account_objects");
  return objects.length;
}

async function logPasskeyLists(connection: Connection, account: string): Promise<void> {
  const count = await passkeyListCount(connection, account);
  log(
    count === 0
      ? "account_objects type passkey_list: empty, no passkey on the ledger."
      : `account_objects type passkey_list: ${count} entry(ies), unexpected.`,
  );
}

async function pay(connection: Connection): Promise<void> {
  const to = destination();
  const amount = amountXrp();
  const tx = await submitWithVault(connection, paymentTx(requireVault().account, to, amount));
  log(`Payment of ${amount} XRP signed with ML-DSA-44:`, tx);
}

/** Opens a mode C session signed by the ML-DSA-44 key, then pays once with the session key. */
async function openSessionAndPay(connection: Connection): Promise<void> {
  const to = destination();
  const amount = amountXrp();
  const owner = requireVault().account;
  const sessionSeed = generateMlDsaSeed();
  try {
    const sessionKeyPair = mlDsaKeyPairFromSeed(sessionSeed);
    sessionKeyPair.secretKey.fill(0);
    const sessionKey = addressFromPublicKey(sessionKeyPair.publicKey);
    const opened = await submitWithVault(
      connection,
      openSessionTx(owner, sessionKey, SESSION_RULES),
    );
    log(
      `Session (mode C: ${SESSION_RULES.capXrp} XRP, ${SESSION_RULES.maxPerTxXrp} per payment, ${SESSION_RULES.durationSeconds} s, ${SESSION_RULES.maxTxCount} transactions) for the ML-DSA-44 key ${sessionKey}, signed by the account key:`,
      opened,
    );
    if (opened.result !== SUCCESS) return;
    const paid = await submitSigned(
      connection,
      { mlDsaSeed: sessionSeed },
      paymentTx(owner, to, amount),
    );
    log(`Payment of ${amount} XRP signed by the session key (no Touch ID):`, paid);
  } finally {
    sessionSeed.fill(0);
  }
  log("Session key wiped from the page; the session expires on its own.");
}

function forget(): void {
  if (
    confirm(
      "Forget this account? The encrypted ML-DSA-44 seed is deleted from this browser: without it, the account is inaccessible.",
    )
  ) {
    clearVault();
    vault = undefined;
    log("Post-quantum account forgotten in this browser.");
  }
}

export function setupPqPasskeyPanel(
  connection: () => Connection | undefined,
  refresh: () => Promise<void>,
): void {
  const run = (action: (ready: Connection) => Promise<void>) =>
    guarded(
      async () => {
        const ready = connection();
        if (ready === undefined) throw new Error("node not connected");
        await action(ready);
      },
      onError,
      refresh,
    );

  ui.create.addEventListener("click", run(createAccount));
  ui.payForm.addEventListener("submit", run(pay));
  ui.session.addEventListener("click", run(openSessionAndPay));
  ui.forget.addEventListener(
    "click",
    guarded(async () => forget(), logError, refresh),
  );

  prfAvailable()
    .then((available) => {
      if (available) ui.prfStatus.textContent = "WebAuthn PRF extension available.";
      else showPrfUnsupported();
    })
    .catch(logError)
    .finally(() => void refresh().catch(logError));
}

/** What the ledger says of the account: its authority, and that it holds no passkey. */
async function showLedgerState(connection: Connection, current: PqVault): Promise<void> {
  const info = await accountInfo(connection.node, current.account);
  if (info === undefined) {
    ui.accountInfo.append(" · not found on this node");
    ui.authority.textContent = "On the ledger: account not found.";
    ui.authority.className = "error";
    return;
  }
  const balance = read(info, ["account_data", "Balance"]);
  const flags = read(info, ["account_data", "Flags"]);
  const regularKey = read(info, ["account_data", "RegularKey"]);
  const passkeyLists = await passkeyListCount(connection, current.account);
  ui.accountInfo.append(` · ${Number(balance) / DROPS_PER_XRP} XRP`);

  const masterDisabled = typeof flags === "number" && (flags & LSF_DISABLE_MASTER) !== 0;
  const authorityIsMlDsa = regularKey === current.mlDsaAddress;
  if (masterDisabled && authorityIsMlDsa && passkeyLists === 0) {
    ui.authority.textContent = AUTHORITY_VERIFIED;
    ui.authority.className = "ok";
    return;
  }
  const gaps: string[] = [];
  if (!authorityIsMlDsa) gaps.push("the regular key is not the ML-DSA-44 key");
  if (!masterDisabled) gaps.push("the master key is not disabled");
  if (passkeyLists !== 0) gaps.push(`${passkeyLists} passkey list(s) on the account`);
  ui.authority.textContent = `On the ledger: ${gaps.join("; ")}.`;
  ui.authority.className = "error";
}

export async function refreshPqPasskeyPanel(connection: Connection | undefined): Promise<void> {
  const ready = connection !== undefined;
  ui.create.disabled = !ready || !prfSupported || vault !== undefined;
  ui.forget.disabled = vault === undefined;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement)
      field.disabled = !ready || vault === undefined;
  }

  ui.authority.className = "muted";
  if (vault === undefined) {
    ui.accountInfo.textContent = "No post-quantum account in this browser.";
    ui.authority.textContent = "";
    return;
  }
  ui.accountInfo.innerHTML = "";
  ui.accountInfo.append(
    "Account ",
    explorerLink(`accounts/${vault.account}`, vault.account),
    ` · ML-DSA-44 key ${vault.mlDsaAddress}`,
  );
  if (connection === undefined) {
    ui.authority.textContent = "";
    return;
  }
  await showLedgerState(connection, vault);
}
