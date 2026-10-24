/**
 * Spike K1 (FIANSO-SPEC.md section 9) on the public AlphaNet, fresh accounts, client-side signing:
 * does a WebCrypto P-256 key set as `RegularKey` sign a `Payment` (raw ECDSA, low-S, strict DER)?
 * Then the passkey wallet (`buildPasskeyWallet`) with a software WebAuthn authenticator: every
 * passkey result here is SIMULATED, and the AlphaNet has no `fixPasskeyChallenge` (P5), so a
 * WebAuthn refusal there says nothing about our node. The session part needs the SigningSessions
 * node and is in `k1-local.ts`.
 *
 *   pnpm --filter @carbs/sessions exec tsx spikes/k1-alphanet.ts
 */

import {
  buildPasskeyWallet,
  createSessionKey,
  fetchCommonFields,
  isCanonicalP256Der,
  hexToBytes,
  JsonRpcClient,
  kAlphaNetRpcUrl,
  loadDefinitions,
  runPasskeyWallet,
  signTransaction,
  submitAndWait,
  SoftwareAuthenticator,
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type NodeClient,
  type TxJson,
} from "../src/index.js";
import { explorer, freshAlphaNetAccount, line } from "./common.js";

const node = new JsonRpcClient(kAlphaNetRpcUrl);
const defs = await loadDefinitions(node, { requireSessions: false });

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
  line(label, `${result.result} validated=${result.validated} ${result.hash}`);
  if (result.validated) line("", explorer(result.hash));
  else line("", `submit: ${result.submit.engineResult} "${result.submit.engineResultMessage}"`);
}

console.log("== K1: WebCrypto P-256 regular key ==");
const a = await freshAlphaNetAccount(node);
const b = await freshAlphaNetAccount(node);
line("account A", a.address);
const key = await createSessionKey();
line(
  "P-256 key (non-extractible)",
  `${key.address} extractable=${key.keyPair.privateKey.extractable}`,
);
report(
  "SetRegularKey to the P-256 key",
  await send(
    { TransactionType: "SetRegularKey", Account: a.address, RegularKey: key.address },
    a.master,
    node,
    defs,
  ),
);
const common = await fetchCommonFields(node, a.address);
const payment = await signTransaction(
  {
    TransactionType: "Payment",
    Account: a.address,
    Destination: b.address,
    Amount: "1000000",
    ...common,
  },
  key,
  defs,
);
line(
  "TxnSignature low-S strict DER",
  isCanonicalP256Der(hexToBytes(String(payment.tx["TxnSignature"]))),
);
report(
  "Payment 1 XRP signed by P-256",
  await submitAndWait(node, payment.blob, payment.hash, common.LastLedgerSequence),
);

console.log("\n== Passkey wallet on the AlphaNet (SIMULATED authenticator, no P5 fix) ==");
line("account B", b.address);
const authenticator = new SoftwareAuthenticator("https://localhost");
const plan = buildPasskeyWallet(b.address, [authenticator.credential], defs);
const run = await runPasskeyWallet(plan, {
  node,
  defs,
  master: b.master,
  passkey: { credential: authenticator.credential, authenticator, rpId: "localhost" },
  onStep: (step, result) => report(`step ${step.index} ${step.kind} (${step.signer})`, result),
});
line("passkey wallet completed", run.completed);
report(
  "raw P-256 by the passkey key",
  await send(
    { TransactionType: "AccountSet", Account: b.address },
    authenticator.rawSigner(),
    node,
    defs,
  ),
);
