// The post-quantum passkey on a roaming authenticator (amendment PasskeyMLDSA, PR #113): an
// ML-DSA-44 WebAuthn credential (COSE -48) created on the team's Ledger Stax running the modified
// Security Key app of PR #109, registered on the ledger by PasskeyListSet, then used to pay and
// to open a signing session. Every node answer is shown as the node gave it.
// Unlike the PRF account above, this passkey IS on the ledger: its 1 312-byte ML-DSA-44 key.
//
// Test node only: the account's classical master seed stays in this browser's localStorage, in
// clear, until the account is locked to the passkey. The panel refuses to create one unless the
// node is local or listed in VITE_TEST_NODE_HOSTS.

import {
  type Definitions,
  type PasskeyCredential,
  type PasskeySigner,
  EncodeError,
  KeyError,
  SessionParamsError,
  SessionSignError,
  WebSocketClient,
  addressFromPublicKey,
  browserAuthenticator,
  browserCreateMlDsaPasskey,
  bytesToHex,
  classicSignerFromSeed,
  createSessionKey,
  generateClassicSeed,
  hexToBytes,
  isClassicAddress,
  loadDefinitions,
} from "@carbs/sessions";

import { requestFunding } from "./account.ts";
import { NODE_URL } from "./config.ts";
import { element, guarded } from "./dom.ts";
import { explorerLink, log, logError } from "./log.ts";
import {
  type PqStep,
  accepted,
  lockToPqPasskey,
  openSessionWithPqPasskey,
  payWithPqPasskey,
  payWithSession,
  registerPqPasskey,
} from "./pq-webauthn.ts";

const STORAGE_KEY = "carbs.pq-stax-passkey.v1";
const DROPS_PER_XRP = 1_000_000;
const RELYING_PARTY_NAME = "carbs";
/** An ML-DSA-44 key generation or signature on the Stax takes seconds; leave a generous timeout. */
const CEREMONY_TIMEOUT_MS = 120_000;
/** The Stax's Security Key app offers -48 over USB (CTAPHID) only (PR #109). */
const STAX_TRANSPORTS: AuthenticatorTransport[] = ["usb"];
const SESSION_RULES = {
  capDrops: 20n * BigInt(DROPS_PER_XRP),
  maxPerTxDrops: 5n * BigInt(DROPS_PER_XRP),
  durationSec: 300,
};
const SIGNER_LABEL: Record<PqStep["signer"], string> = {
  master: "master key",
  passkey: "Stax passkey",
  session: "session key",
};
/** Nodes this panel accepts to keep a master seed in clear for: the local ones, plus the list. */
const LOCAL_NODE_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const TEST_NODE_HOSTS = [
  ...LOCAL_NODE_HOSTS,
  ...String(import.meta.env["VITE_TEST_NODE_HOSTS"] ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== ""),
];
/** WebAuthn errors a browser or an authenticator gives when it does not do -48 (or the user stops). */
const UNSUPPORTED_CEREMONY_ERRORS = new Set(["NotSupportedError", "NotAllowedError"]);
const HEX_PATTERN = /^[0-9A-Fa-f]+$/;

/** A refusal of the page itself (a missing input, a wrong node): nothing was sent. */
class InputError extends Error {
  override readonly name = "InputError";
}

interface StoredPqStax {
  rpId: string;
  /** Hex: the PasskeyID on the ledger. */
  credentialId: string;
  /** Hex of the 1 312-byte ML-DSA-44 key (the COSE AKP `pub`). */
  publicKey: string;
  account?: string;
  /** Classical master seed of the account, IN CLEAR, deleted once the account is locked. */
  masterSeed?: string;
  registered: boolean;
  locked: boolean;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isStored(value: unknown): value is StoredPqStax {
  if (typeof value !== "object" || value === null) return false;
  const get = (name: string): unknown => Reflect.get(value, name);
  const credentialId = get("credentialId");
  const publicKey = get("publicKey");
  const account = get("account");
  return (
    typeof credentialId === "string" &&
    HEX_PATTERN.test(credentialId) &&
    typeof publicKey === "string" &&
    HEX_PATTERN.test(publicKey) &&
    typeof get("rpId") === "string" &&
    typeof get("registered") === "boolean" &&
    typeof get("locked") === "boolean" &&
    optionalString(account) &&
    (account === undefined || isClassicAddress(String(account))) &&
    optionalString(get("masterSeed"))
  );
}

function load(): StoredPqStax | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logError(new Error(`${STORAGE_KEY}: unreadable content in this browser, ignored`));
    return undefined;
  }
  if (!isStored(parsed)) {
    logError(new Error(`${STORAGE_KEY}: unexpected content in this browser, ignored`));
    return undefined;
  }
  return parsed;
}

function save(next: StoredPqStax | undefined): void {
  stored = next;
  if (next === undefined) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

const ui = {
  info: element("pq-stax-info", HTMLElement),
  create: element("pq-stax-create", HTMLButtonElement),
  register: element("pq-stax-register", HTMLButtonElement),
  forget: element("pq-stax-forget", HTMLButtonElement),
  payForm: element("pq-stax-pay-form", HTMLFormElement),
  payDestination: element("pq-stax-destination", HTMLInputElement),
  payAmount: element("pq-stax-amount", HTMLInputElement),
  session: element("pq-stax-session", HTMLButtonElement),
  lock: element("pq-stax-lock", HTMLButtonElement),
  results: element("pq-stax-results", HTMLOListElement),
};

let stored: StoredPqStax | undefined = load();

/** The library's own connection (codes from server_definitions), opened on first use. */
let library: Promise<{ node: WebSocketClient; defs: Definitions }> | undefined;
function connectLibrary(): Promise<{ node: WebSocketClient; defs: Definitions }> {
  library ??= (async () => {
    const node = new WebSocketClient(NODE_URL);
    return { node, defs: await loadDefinitions(node) };
  })().catch((error: unknown) => {
    library = undefined;
    throw error;
  });
  return library;
}

function isTestNode(url: string): boolean {
  return TEST_NODE_HOSTS.includes(new URL(url).hostname);
}

function credentialOf(current: StoredPqStax): PasskeyCredential {
  return {
    credentialId: hexToBytes(current.credentialId),
    publicKey: hexToBytes(current.publicKey),
  };
}

function signerOf(current: StoredPqStax): PasskeySigner {
  return {
    credential: credentialOf(current),
    authenticator: browserAuthenticator(navigator.credentials, {
      transports: STAX_TRANSPORTS,
      timeoutMs: CEREMONY_TIMEOUT_MS,
    }),
    rpId: current.rpId,
  };
}

function requireAccount(current: StoredPqStax | undefined): StoredPqStax & { account: string } {
  if (current?.account === undefined || !current.registered) {
    throw new InputError("register the passkey first (PasskeyListSet)");
  }
  return { ...current, account: current.account };
}

/** One line per node answer: submit's engine_result and message, then the validated result. */
function showStep(step: PqStep): void {
  const submit = step.result.submit;
  const item = document.createElement("li");
  item.className = accepted(step.result) ? "ok" : "error";
  const message = submit.engineResultMessage === "" ? "" : ` (${submit.engineResultMessage})`;
  const outcome = step.result.validated
    ? `validated ${step.result.result}, ledger ${step.result.ledgerIndex ?? "?"}`
    : "never included";
  item.append(
    `${step.label} · signed by the ${SIGNER_LABEL[step.signer]} · submit ${submit.engineResult}${message} → ${outcome} · `,
    explorerLink(`transactions/${step.result.hash}`, `${step.result.hash.slice(0, 12)}…`),
  );
  ui.results.prepend(item);
  log(`PQ Stax passkey · ${step.label}:`, {
    hash: step.result.hash,
    result: step.result.validated ? step.result.result : submit.engineResult,
  });
}

/**
 * Errors thrown before the failing step's transaction was submitted: the page's own checks, the
 * browser or the authenticator (a DOMException from WebAuthn or WebCrypto), and the library's
 * checks before signing or before submitting (KeyError, EncodeError, the session builders).
 * Anything else (the faucet, the connection, submitAndWait while it polls) may come after the
 * node received something.
 */
function thrownBeforeSubmit(error: unknown): boolean {
  return (
    error instanceof InputError ||
    error instanceof DOMException ||
    error instanceof KeyError ||
    error instanceof EncodeError ||
    error instanceof SessionParamsError ||
    error instanceof SessionSignError
  );
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && UNSUPPORTED_CEREMONY_ERRORS.has(error.name)) {
    return `-48 not supported by this browser or authenticator, or the ceremony was cancelled or timed out (${error.name}: ${error.message})`;
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function showError(error: unknown): void {
  const item = document.createElement("li");
  item.className = "error";
  item.textContent = thrownBeforeSubmit(error)
    ? `This step sent nothing to the node · ${describeError(error)}`
    : `Unknown state: the node may have received this step, check the hash or the account on the node · ${describeError(error)}`;
  ui.results.prepend(item);
}

function onError(error: unknown): void {
  showError(error);
  logError(error);
}

async function createCredential(): Promise<void> {
  log(
    "Creating an ML-DSA-44 passkey (alg -48): plug the Stax in over USB, open the Security Key app and approve…",
  );
  // No await before this call: the browser needs the click's user activation.
  const credential = await browserCreateMlDsaPasskey(navigator.credentials, {
    rpId: location.hostname,
    rpName: RELYING_PARTY_NAME,
    userName: `carbs PQ ${new Date().toISOString().slice(0, 16)}`,
    timeoutMs: CEREMONY_TIMEOUT_MS,
    excludeCredentialIds: stored === undefined ? [] : [hexToBytes(stored.credentialId)],
  });
  save({
    rpId: location.hostname,
    credentialId: bytesToHex(credential.credentialId),
    publicKey: bytesToHex(credential.publicKey),
    registered: false,
    locked: false,
  });
  log(
    `ML-DSA-44 passkey created: PasskeyID ${bytesToHex(credential.credentialId).slice(0, 16)}…, public key ${credential.publicKey.length} bytes (COSE AKP, alg -48).`,
  );
}

async function register(): Promise<void> {
  const current = stored;
  if (current === undefined) throw new InputError("create the passkey on the Stax first");
  if (!isTestNode(NODE_URL)) {
    throw new InputError(
      `node ${new URL(NODE_URL).host} refused: the master key seed would be kept in plaintext in this browser, which is only acceptable on a test node (local, or listed in VITE_TEST_NODE_HOSTS)`,
    );
  }
  const { node, defs } = await connectLibrary();
  let { account, masterSeed } = current;
  if (account === undefined || masterSeed === undefined) {
    // A fresh classical account whose master key signs the PasskeyListSet; kept in clear in this
    // browser until the account is locked to the passkey (test node only, checked above).
    masterSeed = generateClassicSeed();
    account = addressFromPublicKey(classicSignerFromSeed(masterSeed).publicKey);
    save({ ...current, account, masterSeed });
    log(`Funding account ${account} from the faucet…`);
    await requestFunding(account);
  }
  const withAccount = { ...current, account, masterSeed };
  const master = classicSignerFromSeed(masterSeed);
  const step = await registerPqPasskey(node, defs, account, master, signerOf(withAccount));
  showStep(step);
  if (accepted(step.result)) save({ ...withAccount, registered: true });
}

function amountDrops(): bigint {
  const value = Number(ui.payAmount.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new InputError("the amount must be a positive number of XRP");
  }
  return BigInt(Math.round(value * DROPS_PER_XRP));
}

function destination(): string {
  const value = ui.payDestination.value.trim();
  if (!isClassicAddress(value)) throw new InputError("the destination is not an r… address");
  return value;
}

async function pay(): Promise<void> {
  const current = requireAccount(stored);
  const to = destination();
  const amount = amountDrops();
  const { node, defs } = await connectLibrary();
  log("Payment: approve on the Stax (ML-DSA-44 signature of the WebAuthn challenge)…");
  showStep(await payWithPqPasskey(node, defs, current.account, signerOf(current), to, amount));
}

/** Opens a mode C session signed by the Stax, then pays once with the session key alone. */
async function openSessionAndPay(): Promise<void> {
  const current = requireAccount(stored);
  const to = destination();
  const amount = amountDrops();
  const { node, defs } = await connectLibrary();
  const sessionKey = await createSessionKey();
  log(
    `Session (mode C: 20 XRP, 5 per payment, 300 s) for key ${sessionKey.address}: approve on the Stax…`,
  );
  const opened = await openSessionWithPqPasskey(
    node,
    defs,
    current.account,
    signerOf(current),
    sessionKey,
    SESSION_RULES,
  );
  showStep(opened);
  if (!accepted(opened.result)) return;
  showStep(await payWithSession(node, defs, current.account, sessionKey, to, amount));
  log(
    "The session key (P-256 WebCrypto, non-extractable) stays in this page; the session expires on its own.",
  );
}

async function lock(): Promise<void> {
  const current = requireAccount(stored);
  if (current.masterSeed === undefined) {
    throw new InputError("the master key is no longer in this browser");
  }
  if (
    !confirm(
      "Disable the master key? Afterwards only the Stax's ML-DSA-44 passkey signs for this account, and the passkey list can be neither replaced nor deleted: losing the Stax (or its 24 words) makes the account inaccessible.",
    )
  ) {
    return;
  }
  const { node, defs } = await connectLibrary();
  const steps = await lockToPqPasskey(
    node,
    defs,
    current.account,
    classicSignerFromSeed(current.masterSeed),
  );
  for (const step of steps) showStep(step);
  if (steps.length === 2 && steps.every((s) => accepted(s.result))) {
    const { masterSeed: _discarded, ...rest } = current;
    save({ ...rest, locked: true });
    log(
      "Master key disabled and forgotten: only the Stax's ML-DSA-44 passkey signs for this account.",
    );
  }
}

function forget(): void {
  const current = stored;
  if (current === undefined) return;
  const seedWarning =
    current.masterSeed === undefined
      ? ""
      : " WARNING: the account is not locked and its master key only exists in this browser: the seed will be lost, and only the Stax passkey (if registered) will still be able to sign.";
  if (
    confirm(
      `Forget this post-quantum passkey in this browser? The account stays on the ledger; its PasskeyID and key can be read back from account_objects (type passkey_list).${seedWarning}`,
    )
  ) {
    save(undefined);
  }
}

export function setupPqStaxPanel(refresh: () => Promise<void>): void {
  const run = (action: () => Promise<void>) => guarded(action, onError, refresh);
  ui.create.addEventListener("click", run(createCredential));
  ui.register.addEventListener("click", run(register));
  ui.payForm.addEventListener("submit", run(pay));
  ui.session.addEventListener("click", run(openSessionAndPay));
  ui.lock.addEventListener("click", run(lock));
  ui.forget.addEventListener(
    "click",
    guarded(async () => forget(), logError, refresh),
  );
  // Connect now, so no network wait sits between a click and its WebAuthn ceremony.
  connectLibrary().catch(logError);
}

export function refreshPqStaxPanel(nodeReady: boolean): void {
  const registered = stored?.registered === true && stored.account !== undefined;
  ui.create.disabled = !nodeReady || stored !== undefined;
  ui.register.disabled = !nodeReady || stored === undefined || stored.registered;
  ui.forget.disabled = stored === undefined;
  ui.lock.disabled =
    !nodeReady || !registered || stored?.locked === true || stored?.masterSeed === undefined;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement) {
      field.disabled = !nodeReady || !registered;
    }
  }
  if (stored === undefined) {
    ui.info.textContent = "No post-quantum passkey in this browser.";
    return;
  }
  ui.info.innerHTML = "";
  ui.info.append(
    `PasskeyID ${stored.credentialId.slice(0, 16)}… · ${stored.publicKey.length / 2}-byte ML-DSA-44 key · `,
  );
  if (stored.account === undefined) {
    ui.info.append("no account yet");
    return;
  }
  ui.info.append(
    "account ",
    explorerLink(`accounts/${stored.account}`, stored.account),
    stored.locked
      ? " · PQ passkey only (master key disabled)"
      : stored.registered
        ? " · master key + PQ passkey (master key seed in plaintext in this browser)"
        : " · PasskeyListSet not accepted yet",
  );
}
