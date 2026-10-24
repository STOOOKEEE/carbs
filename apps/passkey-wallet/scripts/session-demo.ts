// End-to-end test of signing sessions on the carbs node (mode C, cap per transaction, witness).
// Every line prints the node's own result; the script stops with an error at the first surprise.
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 node scripts/session-demo.ts

import { generateSeed } from "ripple-keypairs";

import {
  type TxJson,
  addressOfSeed,
  autofill,
  loadDefinitions,
  read,
  signWithSeed,
  submitAndWait,
} from "../src/ledger.ts";
import { NodeClient } from "../src/rpc.ts";
import { closeSessionTx, openSessionTx, paymentTx, witnessSign } from "../src/session.ts";

const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED_ENV = process.env["GENESIS_SEED"];
if (GENESIS_SEED_ENV === undefined) throw new Error("GENESIS_SEED is not set");
const genesisSeed: string = GENESIS_SEED_ENV;

const node = await NodeClient.connect(NODE_WS);
const defs = await loadDefinitions(node);

async function submit(
  label: string,
  tx: TxJson,
  seed: string,
  expected: string,
  witnessSeed?: string,
): Promise<void> {
  const filled = await autofill(node, defs, tx);
  const signed = signWithSeed(defs, filled, seed);
  const { hash, result } = await submitAndWait(
    node,
    defs,
    witnessSeed ? witnessSign(defs, signed, witnessSeed) : signed,
  );
  const verdict = result === expected ? "OK " : "!! ";
  console.log(`${verdict} ${label.padEnd(58)} ${result.padEnd(26)} ${hash.slice(0, 16)}…`);
  if (result !== expected) throw new Error(`${label}: expected ${expected}, got ${result}`);
}

async function newFundedAccount(xrp: number): Promise<{ seed: string; address: string }> {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const address = addressOfSeed(seed);
  await submit(
    `fund ${address}`,
    paymentTx(addressOfSeed(genesisSeed), address, xrp),
    genesisSeed,
    "tesSUCCESS",
  );
  return { seed, address };
}

async function spent(owner: string, sessionKey: string): Promise<string> {
  const objects = await node.request("account_objects", {
    account: owner,
    type: "signing_session",
  });
  const list = read(objects, ["account_objects"]);
  const entry = Array.isArray(list)
    ? list.find((object) => read(object, ["SessionKey"]) === sessionKey)
    : undefined;
  const value = read(entry, ["SessionSpent"]);
  return typeof value === "string" ? `${Number(value) / 1_000_000} XRP` : "none";
}

try {
  const owner = await newFundedAccount(1_000);
  const bob = await newFundedAccount(100);
  const sessionSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const sessionKey = addressOfSeed(sessionSeed);

  console.log("\n— Session 1: 50 XRP total, 20 XRP per payment, 120 s");
  await submit(
    "open the session (master key)",
    openSessionTx(owner.address, sessionKey, { durationSeconds: 120, capXrp: 50, maxPerTxXrp: 20 }),
    owner.seed,
    "tesSUCCESS",
  );
  await submit(
    "pay 10 XRP, signed by the session key",
    paymentTx(owner.address, bob.address, 10),
    sessionSeed,
    "tesSUCCESS",
  );
  await submit(
    "pay 20 XRP, signed by the session key",
    paymentTx(owner.address, bob.address, 20),
    sessionSeed,
    "tesSUCCESS",
  );
  console.log(`    SessionSpent: ${await spent(owner.address, sessionKey)}`);
  await submit(
    "pay 25 XRP (over the 20 XRP per payment)",
    paymentTx(owner.address, bob.address, 25),
    sessionSeed,
    "tefSESSION_LIMIT",
  );
  await submit(
    "pay 20 XRP (over what is left of 50)",
    paymentTx(owner.address, bob.address, 20),
    sessionSeed,
    "tefSESSION_LIMIT",
  );
  await submit(
    "stolen key changes the regular key",
    { TransactionType: "SetRegularKey", Account: owner.address, RegularKey: sessionKey },
    sessionSeed,
    "tefSESSION_TX_NOT_ALLOWED",
  );
  await submit(
    "stolen key changes account settings",
    { TransactionType: "AccountSet", Account: owner.address, SetFlag: 8 },
    sessionSeed,
    "tefSESSION_TX_NOT_ALLOWED",
  );
  await submit(
    "the session key closes its own session",
    closeSessionTx(owner.address, sessionKey),
    sessionSeed,
    "tesSUCCESS",
  );
  await submit(
    "pay 1 XRP after the close",
    paymentTx(owner.address, bob.address, 1),
    sessionSeed,
    "tefBAD_AUTH",
  );

  console.log("\n— Session 2: with a witness that must co-sign");
  const witness = await newFundedAccount(50);
  const mallory = await newFundedAccount(50);
  const session2Seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const session2Key = addressOfSeed(session2Seed);
  await submit(
    "open the session with a witness",
    openSessionTx(owner.address, session2Key, {
      durationSeconds: 120,
      capXrp: 50,
      witness: witness.address,
    }),
    owner.seed,
    "tesSUCCESS",
  );
  await submit(
    "pay 5 XRP without the witness",
    paymentTx(owner.address, bob.address, 5),
    session2Seed,
    "tefSESSION_NO_WITNESS",
  );
  await submit(
    "pay 5 XRP co-signed by another account",
    paymentTx(owner.address, bob.address, 5),
    session2Seed,
    "tefSESSION_NO_WITNESS",
    mallory.seed,
  );
  await submit(
    "pay 5 XRP co-signed by the witness",
    paymentTx(owner.address, bob.address, 5),
    session2Seed,
    "tesSUCCESS",
    witness.seed,
  );

  console.log("\nAll session checks behaved as expected.");
} finally {
  node.close();
}
