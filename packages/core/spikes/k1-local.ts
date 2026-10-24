/**
 * Step 6 on the local standalone node with the SigningSessions amendment (task N9's config and
 * closer must run): the passkey wallet, a `SigningSessionSet` signed by the passkey (W2), a
 * session-signed `Payment` (K1 against our node), the refusals with the node's own codes, and a
 * Ledger account (ML-DSA-44 regular key and session key, D13 / D14). Passkeys come from a software
 * WebAuthn authenticator and the ML-DSA keys are software keys: those results are SIMULATED.
 *
 *   CARBS_GENESIS_SEED=<seed of the standalone genesis account> \
 *   CARBS_NODE_WS=ws://127.0.0.1:6006 pnpm --filter @carbs/sessions exec tsx spikes/k1-local.ts
 *
 * The genesis seed comes from the environment and is never written anywhere.
 */

import {
  addressFromPublicKey,
  buildPasskeyWallet,
  buildPqMigration,
  buildSessionDelete,
  buildSessionSet,
  classicSignerFromSeed,
  createMlDsaSessionKey,
  createSessionKey,
  fetchCommonFields,
  generateClassicSeed,
  generateMlDsaSeed,
  getLedgerEntry,
  kLastLedgerSequenceOffset,
  loadDefinitions,
  mlDsaSignerFromSeed,
  runPasskeyWallet,
  signingSessionIndex,
  signTransaction,
  signWithSessionKey,
  submitAndWait,
  submitWithPasskey,
  SoftwareAuthenticator,
  WebSocketClient,
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type NodeClient,
  type SessionMode,
  type TxJson,
} from "../src/index.js";
import { simulatedSessionServerDefinitions } from "../src/testing/simulated-definitions.js";
import { line } from "./common.js";

const genesisSeed = process.env["CARBS_GENESIS_SEED"];
if (!genesisSeed) {
  console.log("set CARBS_GENESIS_SEED to the standalone genesis seed");
  process.exit(2);
}
const node = new WebSocketClient(process.env["CARBS_NODE_WS"] ?? "ws://127.0.0.1:6006");
const defs = await loadDefinitions(node);
line("definitions hash", defs.hash ?? "none");

// The SIMULATED definitions the library was tested with, against the node's own answer.
const simulated = simulatedSessionServerDefinitions();
const mismatches: string[] = [];
for (const name of ["SigningSessionSet", "SigningSessionDelete"]) {
  if (simulated.TRANSACTION_TYPES[name] !== defs.raw.TRANSACTION_TYPES[name]) mismatches.push(name);
}
for (const name of ["SessionKey", "SessionCap", "SessionSpent", "SessionDuration"]) {
  const a = simulated.FIELDS.find(([n]) => n === name)?.[1];
  const b = defs.raw.FIELDS.find(([n]) => n === name)?.[1];
  const same =
    a !== undefined &&
    b !== undefined &&
    a.nth === b.nth &&
    a.type === b.type &&
    a.isVLEncoded === b.isVLEncoded &&
    a.isSerialized === b.isSerialized &&
    a.isSigningField === b.isSigningField;
  if (!same) mismatches.push(`${name} ${JSON.stringify(b)}`);
}
for (const name of ["tefSESSION_EXPIRED", "tefSESSION_LIMIT", "tefSESSION_TX_NOT_ALLOWED"]) {
  if (simulated.TRANSACTION_RESULTS[name] !== defs.raw.TRANSACTION_RESULTS[name]) {
    mismatches.push(`${name} ${defs.raw.TRANSACTION_RESULTS[name]}`);
  }
}
if (
  simulated.LEDGER_ENTRY_TYPES["SigningSession"] !== defs.raw.LEDGER_ENTRY_TYPES["SigningSession"]
) {
  mismatches.push("SigningSession entry");
}
line("SIMULATED vs node definitions", mismatches.length === 0 ? "identical codes" : mismatches);

const genesis = classicSignerFromSeed(genesisSeed);
const genesisAddress = addressFromPublicKey(genesis.publicKey);

async function send(
  tx: TxJson,
  signer: BytesSigner,
  n: NodeClient,
  d: Definitions,
): Promise<FinalResult> {
  const common = await fetchCommonFields(n, tx.Account);
  const signed = await signTransaction({ ...tx, ...common }, signer, d);
  return submitAndWait(n, signed.blob, signed.hash, common.LastLedgerSequence);
}

function report(label: string, result: FinalResult): void {
  line(
    label,
    `${result.result}${result.validated ? "" : ` (${result.submit.engineResultMessage})`} ${result.hash}`,
  );
}

async function fresh(): Promise<{ address: string; master: BytesSigner }> {
  const master = classicSignerFromSeed(generateClassicSeed());
  const address = addressFromPublicKey(master.publicKey);
  const funded = await send(
    {
      TransactionType: "Payment",
      Account: genesisAddress,
      Destination: address,
      Amount: "1000000000",
    },
    genesis,
    node,
    defs,
  );
  if (funded.result !== "tesSUCCESS") throw new Error(`funding ${address}: ${funded.result}`);
  return { address, master };
}

async function sessionTx(tx: TxJson, key: BytesSigner): Promise<FinalResult> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signWithSessionKey(
    { ...tx, ...common },
    key,
    defs,
    common.LastLedgerSequence - kLastLedgerSequenceOffset,
  );
  return submitAndWait(node, signed.blob, signed.hash, common.LastLedgerSequence);
}

console.log("\n== Passkey wallet (SIMULATED authenticator) ==");
const w = await fresh();
const dest = await fresh();
line("account", w.address);
const authenticator = new SoftwareAuthenticator("https://localhost");
const passkey = { credential: authenticator.credential, authenticator, rpId: "localhost" };
const wallet = await runPasskeyWallet(
  buildPasskeyWallet(w.address, [authenticator.credential], defs),
  {
    node,
    defs,
    master: w.master,
    passkey,
    onStep: (step, result) => report(`step ${step.index} ${step.kind} (${step.signer})`, result),
  },
);
line("passkey wallet completed", wallet.completed);
report(
  "master signs afterwards",
  await send({ TransactionType: "AccountSet", Account: w.address }, w.master, node, defs),
);

console.log("\n== Session opened by the passkey (W2), mode C, 20 XRP, 600 s ==");
const sessionKey = await createSessionKey();
const mode: SessionMode = { kind: "cap", capDrops: 20_000_000n };
const openCommon = await fetchCommonFields(node, w.address);
const open = await submitWithPasskey(
  buildSessionSet(
    {
      account: w.address,
      sessionKey: sessionKey.address,
      durationSec: 600,
      mode,
      common: openCommon,
    },
    defs,
  ),
  passkey,
  node,
  defs,
);
report("SigningSessionSet by passkey", open.result);
const entry = await getLedgerEntry(node, signingSessionIndex(w.address, sessionKey.address));
line(
  "session entry",
  entry
    ? {
        SessionCap: entry["SessionCap"],
        SessionSpent: entry["SessionSpent"],
        Expiration: entry["Expiration"],
      }
    : "missing",
);

report(
  "Payment 1 XRP, session key",
  await sessionTx(
    {
      TransactionType: "Payment",
      Account: w.address,
      Destination: dest.address,
      Amount: "1000000",
    },
    sessionKey,
  ),
);
const after = await getLedgerEntry(node, signingSessionIndex(w.address, sessionKey.address));
line("SessionSpent after", after?.["SessionSpent"]);
report(
  "SetRegularKey, session key",
  await sessionTx(
    { TransactionType: "SetRegularKey", Account: w.address, RegularKey: dest.address },
    sessionKey,
  ),
);
report(
  "PasskeyListSet, session key",
  await sessionTx(buildPasskeyListSetFor(w.address), sessionKey),
);
report(
  "Payment 25 XRP over the cap",
  await sessionTx(
    {
      TransactionType: "Payment",
      Account: w.address,
      Destination: dest.address,
      Amount: "25000000",
    },
    sessionKey,
  ),
);
report(
  "own close, session key",
  await sessionTx(
    buildSessionDelete({ account: w.address, sessionKey: sessionKey.address, common: openCommon }),
    sessionKey,
  ),
);

function buildPasskeyListSetFor(account: string): TxJson {
  const other = new SoftwareAuthenticator("https://localhost");
  return {
    TransactionType: "PasskeyListSet",
    Account: account,
    Passkeys: [
      {
        Passkey: {
          PasskeyID: "01",
          PublicKey: Buffer.from(other.credential.publicKey).toString("hex").toUpperCase(),
        },
      },
    ],
  };
}

console.log(
  "\n== Ledger account: ML-DSA-44 regular key, ML-DSA-44 session key (D13, D14; SIMULATED keys) ==",
);
const l = await fresh();
const rootSeed = generateMlDsaSeed();
const root = mlDsaSignerFromSeed(rootSeed);
const plan = buildPqMigration(l.address, root.publicKey, defs);
report("SetRegularKey (master)", await send(plan.steps[0].tx, l.master, node, defs));
report("proof (ML-DSA root)", await send(plan.steps[1].tx, root, node, defs));
report("asfDisableMaster (master)", await send(plan.steps[2].tx, l.master, node, defs));
const mlSession = createMlDsaSessionKey();
const lCommon = await fetchCommonFields(node, l.address);
const lOpen = await signTransaction(
  buildSessionSet(
    {
      account: l.address,
      sessionKey: mlSession.address,
      durationSec: 600,
      mode: { kind: "all" },
      common: lCommon,
    },
    defs,
  ),
  root,
  defs,
);
report(
  "SigningSessionSet by ML-DSA root",
  await submitAndWait(node, lOpen.blob, lOpen.hash, lCommon.LastLedgerSequence),
);
report(
  "Payment, ML-DSA session key",
  await sessionTx(
    {
      TransactionType: "Payment",
      Account: l.address,
      Destination: dest.address,
      Amount: "1000000",
    },
    mlSession,
  ),
);
report(
  "master after migration",
  await send({ TransactionType: "AccountSet", Account: l.address }, l.master, node, defs),
);
node.close();
