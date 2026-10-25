// The post-quantum passkey on a roaming authenticator (amendment PasskeyMLDSA, PR #113): an
// ML-DSA-44 WebAuthn credential (COSE -48) created on the team's Ledger Stax running the modified
// Security Key app of PR #109, registered on the ledger by PasskeyListSet, then used to pay and
// to open a signing session. Every node answer is shown as the node gave it.
// Unlike the PRF account above, this passkey IS on the ledger: its 1 312-byte ML-DSA-44 key.

import {
  type Definitions,
  type PasskeyCredential,
  type PasskeySigner,
  WebSocketClient,
  addressFromPublicKey,
  browserAuthenticator,
  browserCreateMlDsaPasskey,
  bytesToHex,
  classicSignerFromSeed,
  createSessionKey,
  generateClassicSeed,
  hexToBytes,
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
  master: "clé maître",
  passkey: "passkey Stax",
  session: "clé de session",
};

interface StoredPqStax {
  rpId: string;
  /** Hex: the PasskeyID on the ledger. */
  credentialId: string;
  /** Hex of the 1 312-byte ML-DSA-44 key (the COSE AKP `pub`). */
  publicKey: string;
  account?: string;
  /** Classical master key of the account, deleted once the account is locked to the passkey. */
  masterSeed?: string;
  registered: boolean;
  locked: boolean;
}

function isStored(value: unknown): value is StoredPqStax {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "credentialId") === "string" &&
    typeof Reflect.get(value, "publicKey") === "string" &&
    typeof Reflect.get(value, "rpId") === "string" &&
    typeof Reflect.get(value, "registered") === "boolean" &&
    typeof Reflect.get(value, "locked") === "boolean"
  );
}

function load(): StoredPqStax | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  return isStored(parsed) ? parsed : undefined;
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
    throw new Error("enregistrez d'abord la passkey (PasskeyListSet)");
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
    ? `validée ${step.result.result}, ledger ${step.result.ledgerIndex ?? "?"}`
    : "jamais incluse";
  item.append(
    `${step.label} · signée par la ${SIGNER_LABEL[step.signer]} · submit ${submit.engineResult}${message} → ${outcome} · `,
    explorerLink(`transactions/${step.result.hash}`, `${step.result.hash.slice(0, 12)}…`),
  );
  ui.results.prepend(item);
  log(`Passkey PQ Stax · ${step.label} :`, {
    hash: step.result.hash,
    result: step.result.validated ? step.result.result : submit.engineResult,
  });
}

/** A refusal before anything reached the node (browser, authenticator, or the client's check). */
function showClientError(error: unknown): void {
  const item = document.createElement("li");
  item.className = "error";
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  item.textContent = `Rien n'a été envoyé au nœud · ${text}`;
  ui.results.prepend(item);
}

function onError(error: unknown): void {
  showClientError(error);
  logError(error);
}

async function createCredential(): Promise<void> {
  log(
    "Création d'une passkey ML-DSA-44 (alg -48) : branchez la Stax en USB sur l'app Security Key et validez…",
  );
  // No await before this call: the browser needs the click's user activation.
  const credential = await browserCreateMlDsaPasskey(navigator.credentials, {
    rpId: location.hostname,
    rpName: RELYING_PARTY_NAME,
    userName: `carbs PQ ${new Date().toISOString().slice(0, 16)}`,
    timeoutMs: CEREMONY_TIMEOUT_MS,
  });
  save({
    rpId: location.hostname,
    credentialId: bytesToHex(credential.credentialId),
    publicKey: bytesToHex(credential.publicKey),
    registered: false,
    locked: false,
  });
  log(
    `Passkey ML-DSA-44 créée : PasskeyID ${bytesToHex(credential.credentialId).slice(0, 16)}…, clé publique ${credential.publicKey.length} octets (COSE AKP, alg -48).`,
  );
}

async function register(): Promise<void> {
  const current = stored;
  if (current === undefined) throw new Error("créez d'abord la passkey sur la Stax");
  const { node, defs } = await connectLibrary();
  let { account, masterSeed } = current;
  if (account === undefined || masterSeed === undefined) {
    // A fresh classical account whose master key signs the PasskeyListSet; kept in this browser
    // until the account is locked to the passkey (test node only).
    masterSeed = generateClassicSeed();
    account = addressFromPublicKey(classicSignerFromSeed(masterSeed).publicKey);
    save({ ...current, account, masterSeed });
    log(`Financement du compte ${account} par le faucet…`);
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
    throw new Error("le montant doit être un nombre de XRP positif");
  }
  return BigInt(Math.round(value * DROPS_PER_XRP));
}

function destination(): string {
  const value = ui.payDestination.value.trim();
  if (value === "") throw new Error("renseignez une destination");
  return value;
}

async function pay(): Promise<void> {
  const current = requireAccount(stored);
  const to = destination();
  const amount = amountDrops();
  const { node, defs } = await connectLibrary();
  log("Paiement : validez sur la Stax (signature ML-DSA-44 du challenge WebAuthn)…");
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
    `Session (mode C : 20 XRP, 5 par paiement, 300 s) pour la clé ${sessionKey.address} : validez sur la Stax…`,
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
    "La clé de session (P-256 WebCrypto, non extractible) reste dans cette page ; la session expire d'elle-même.",
  );
}

async function lock(): Promise<void> {
  const current = requireAccount(stored);
  if (current.masterSeed === undefined)
    throw new Error("la clé maître n'est plus dans ce navigateur");
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
      "Clé maître désactivée et oubliée : seule la passkey ML-DSA-44 de la Stax signe pour ce compte.",
    );
  }
}

function forget(): void {
  if (
    confirm(
      "Oublier cette passkey post-quantique dans ce navigateur ? Le compte reste sur le ledger ; sans la clé maître, seule la Stax peut encore signer pour lui.",
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
    ui.info.textContent = "Pas de passkey post-quantique dans ce navigateur.";
    return;
  }
  ui.info.innerHTML = "";
  ui.info.append(
    `PasskeyID ${stored.credentialId.slice(0, 16)}… · clé ML-DSA-44 de ${stored.publicKey.length / 2} octets · `,
  );
  if (stored.account === undefined) {
    ui.info.append("pas encore de compte");
    return;
  }
  ui.info.append(
    "compte ",
    explorerLink(`accounts/${stored.account}`, stored.account),
    stored.locked
      ? " · passkey PQ uniquement (clé maître désactivée)"
      : stored.registered
        ? " · clé maître + passkey PQ"
        : " · PasskeyListSet pas encore accepté",
  );
}
