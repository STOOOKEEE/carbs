/**
 * Spike K3 (FIANSO-SPEC.md section 9), extended with the migration order of section 8.7, on the
 * public AlphaNet with fresh accounts and client-side signing. The ML-DSA-44 key is a software key
 * of @noble/post-quantum 0.7.1 standing in for the device: every ML-DSA result here is SIMULATED.
 *
 *   pnpm --filter @carbs/sessions exec tsx spikes/k3-alphanet.ts
 */

import { spawnSync } from "node:child_process";
import {
  addressFromPublicKey,
  buildPqMigration,
  bytesToHex,
  checkExposure,
  fetchCommonFields,
  generateMlDsaSeed,
  JsonRpcClient,
  kAlphaNetNetworkId,
  kAlphaNetRpcUrl,
  loadDefinitions,
  mlDsaSignerFromSeed,
  runPqMigration,
  signTransaction,
  submitAndWait,
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type NodeClient,
  type TxJson,
} from "../src/index.js";
import { explorer, freshAlphaNetAccount, line } from "./common.js";

const node = new JsonRpcClient(kAlphaNetRpcUrl);
const defs = await loadDefinitions(node, { requireSessions: false });
line("definitions hash", defs.hash ?? "none");

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

/** Derive the public key of `seed` again in a separate process (the seed goes through stdin only). */
function deriveInFreshProcess(seed: Uint8Array): Uint8Array {
  const script =
    'import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";' +
    'let s = ""; process.stdin.on("data", (c) => (s += c)); process.stdin.on("end", () => {' +
    'const { publicKey } = ml_dsa44.keygen(Uint8Array.from(Buffer.from(s.trim(), "hex")));' +
    'process.stdout.write(Buffer.from(publicKey).toString("hex")); });';
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    input: bytesToHex(seed),
    encoding: "utf8",
  });
  if (out.status !== 0) throw new Error(`fresh-process derivation failed: ${out.stderr}`);
  return Uint8Array.from(Buffer.from(out.stdout.trim(), "hex"));
}

// Part 1, account A: the order matters.
console.log("\n== K3 part 1: account A (fresh) ==");
const a = await freshAlphaNetAccount(node);
const aKey = mlDsaSignerFromSeed(generateMlDsaSeed());
line("account A", a.address);
line("ML-DSA key account (A)", addressFromPublicKey(aKey.publicKey));

const early = await send({ TransactionType: "AccountSet", Account: a.address }, aKey, node, defs);
report("ML-DSA signs before SetRegularKey", early);

const setRegularA = await send(
  {
    TransactionType: "SetRegularKey",
    Account: a.address,
    RegularKey: addressFromPublicKey(aKey.publicKey),
  },
  a.master,
  node,
  defs,
);
report("SetRegularKey (master)", setRegularA);

// Part 2, account B: the full migration, in the order of section 8.7.
console.log("\n== K3 part 2: account B (fresh), migration ==");
const b = await freshAlphaNetAccount(node);
line("account B", b.address);

const payment = await send(
  { TransactionType: "Payment", Account: a.address, Destination: b.address, Amount: "1000000" },
  aKey,
  node,
  defs,
);
report("Payment 1 XRP A→B (ML-DSA)", payment);

const needMaster = await send(
  {
    TransactionType: "AccountSet",
    Account: a.address,
    SetFlag: defs.accountSetFlag("asfDisableMaster"),
  },
  aKey,
  node,
  defs,
);
report("asfDisableMaster by ML-DSA key", needMaster);

if (!payment.validated || payment.result !== "tesSUCCESS") {
  console.log("K3: ML-DSA payment not accepted, migration not attempted");
  process.exit(1);
}

const bSeed = generateMlDsaSeed();
const bKey = mlDsaSignerFromSeed(bSeed);
const plan = buildPqMigration(b.address, bKey.publicKey, defs);
line("ML-DSA key account (B)", plan.mlDsaAddress);
const before = await checkExposure(b.address, node, defs);
line("exposure of B before", `${before.status}: ${before.reasons.join("; ")}`);

const run = await runPqMigration(plan, {
  node,
  defs,
  master: b.master,
  mlDsa: bKey,
  readiness: { networkId: kAlphaNetNetworkId, probeHash: payment.hash },
  onStep: (step, result) => report(`step ${step.index} ${step.kind} (${step.signer})`, result),
  guard: async () => {
    const reviewed = await checkExposure(b.address, node, defs);
    const surviving = reviewed.findings.filter(
      (f) => f.survivesDisableMaster && f.active && f.role !== "regular-key",
    );
    line("exposure of B at step 3", `${reviewed.status}: ${reviewed.reasons.join("; ")}`);
    line(
      "surviving authorities (rule 3)",
      surviving.length === 0 ? "none" : surviving.map((f) => f.role),
    );
    return {
      recoverability: {
        kind: "derived-twice",
        first: mlDsaSignerFromSeed(bSeed).publicKey,
        second: deriveInFreshProcess(bSeed),
        afterReinstall: true,
        source: "software",
      },
      reviewedReport: reviewed,
      authoritiesAcknowledged: surviving.length === 0,
    };
  },
});
line("migration completed", run.completed);

const masterAfter = await send(
  { TransactionType: "AccountSet", Account: b.address },
  b.master,
  node,
  defs,
);
report("master signs after migration", masterAfter);
const mlDsaAfter = await send(
  { TransactionType: "AccountSet", Account: b.address },
  bKey,
  node,
  defs,
);
report("ML-DSA signs after migration", mlDsaAfter);

const after = await checkExposure(b.address, node, defs);
line("exposure of B after", `${after.status}: ${after.reasons.join("; ")}`);
for (const f of after.findings) {
  line(`  ${f.role} ${f.address}`, `${f.status} active=${f.active} type=${f.keyType ?? "?"}`);
}
