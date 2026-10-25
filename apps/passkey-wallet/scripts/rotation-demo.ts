// Key rotation on every payment, on a live carbs node. The account's master key is disabled and
// each payment is an all-or-nothing Batch signed by the current RegularKey K_n, carrying
// [Payment, SetRegularKey -> AccountID of K_{n+1}]. The inner transactions carry no signature, so a
// payment reveals only K_n, the key it retires; the ledger knows K_{n+1} only by its AccountID (a
// hash), and the public key of the key in force is never on the ledger.
//
// Keys: one secret (ROTATION_SECRET, 32 random bytes per run by default) and, for each index n,
// the secp256k1 family seed whose 16 bytes of entropy are the first 16 bytes of
// SHA-512("carbs-rotation" | secret | n). Index 0 is the account's master key, 1… are K_1, K_2…
// Anyone holding the secret can rebuild every key; the ledger links none of them to it.
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:16006 node scripts/rotation-demo.ts

import { createHash, randomBytes } from "node:crypto";

import { deriveAddress, deriveKeypair, generateSeed } from "ripple-keypairs";

import { batchInnerResults } from "../src/batch-results.ts";
import { TF_ALL_OR_NOTHING, batchTx } from "../src/batch.ts";
import {
  type SubmittedTx,
  type TxJson,
  accountInfo,
  addressOfSeed,
  autofill,
  loadDefinitions,
  read,
  signWithSeed,
  submitAndWait,
} from "../src/ledger.ts";
import { NodeClient } from "../src/rpc.ts";
import { paymentTx } from "../src/session.ts";

const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:16006";
const GENESIS_SEED_ENV = process.env["GENESIS_SEED"];
if (GENESIS_SEED_ENV === undefined) throw new Error("GENESIS_SEED is not set");
const genesisSeed: string = GENESIS_SEED_ENV;

const SECRET_BYTES = 32;
const SEED_ENTROPY_BYTES = 16;
const DERIVATION_TAG = "carbs-rotation";
const MASTER_INDEX = 0;
const ROTATIONS = 5;
const ACCOUNT_FUNDING_XRP = 1_000;
const RECIPIENT_FUNDING_XRP = 100;
const PAYMENT_XRP = 1;
/** AccountSet flag asfDisableMaster. */
const ASF_DISABLE_MASTER = 4;
/** AccountRoot flag lsfDisableMaster. */
const LSF_DISABLE_MASTER = 0x00100000;
/** Shown length of a public key: enough to tell keys apart, not the whole key. */
const KEY_PREFIX_LENGTH = 16;
const ACCOUNT_TX_PAGE = 200;

const secretHex = process.env["ROTATION_SECRET"] ?? randomBytes(SECRET_BYTES).toString("hex");
if (!/^[0-9a-fA-F]{64}$/.test(secretHex))
  throw new Error(`ROTATION_SECRET must be ${SECRET_BYTES} bytes in hex`);
const secret = Buffer.from(secretHex, "hex");

interface Key {
  index: number;
  seed: string;
  publicKey: string;
  address: string;
}

function deriveKey(index: number): Key {
  const digest = createHash("sha512")
    .update(DERIVATION_TAG)
    .update(secret)
    .update(String(index))
    .digest();
  const seed = generateSeed({
    entropy: digest.subarray(0, SEED_ENTROPY_BYTES),
    algorithm: "ecdsa-secp256k1",
  });
  const { publicKey } = deriveKeypair(seed);
  return { index, seed, publicKey, address: deriveAddress(publicKey) };
}

const node = await NodeClient.connect(NODE_WS);
const defs = await loadDefinitions(node);

function prefix(publicKey: string): string {
  return `${publicKey.slice(0, KEY_PREFIX_LENGTH)}…`;
}

async function submit(label: string, tx: TxJson, seed: string, expected: string) {
  const signed = signWithSeed(defs, await autofill(node, defs, tx), seed);
  const submitted = await submitAndWait(node, defs, signed);
  const ok = submitted.result === expected;
  console.log(
    `${ok ? "OK " : "!! "} ${label.padEnd(52)} ${submitted.result.padEnd(20)} ${submitted.hash}`,
  );
  if (!ok) throw new Error(`${label}: expected ${expected}, got ${submitted.result}`);
  return submitted;
}

async function accountRoot(address: string): Promise<unknown> {
  const info = await accountInfo(node, address);
  if (info === undefined) throw new Error(`${address} does not exist`);
  return read(info, ["account_data"]);
}

async function regularKeyOf(address: string): Promise<string | undefined> {
  const key = read(await accountRoot(address), ["RegularKey"]);
  return typeof key === "string" ? key : undefined;
}

/** Checks that both inner transactions of a rotation were applied, and prints them. */
async function expectInnerApplied(outer: SubmittedTx): Promise<void> {
  for (const inner of await batchInnerResults(node, outer.hash)) {
    const result = inner.applied?.result ?? "not applied";
    const ok = result === "tesSUCCESS";
    console.log(
      `${ok ? "OK " : "!! "}   inner ${inner.transactionType.padEnd(44)} ${result.padEnd(20)} ${inner.applied?.hash ?? ""}`,
    );
    if (!ok) throw new Error(`inner ${inner.transactionType}: expected tesSUCCESS, got ${result}`);
  }
}

/** Every validated transaction of `address`, oldest first, as the node returns them. */
async function accountHistory(address: string): Promise<unknown[]> {
  const all: unknown[] = [];
  let marker: unknown;
  do {
    const page = await node.request("account_tx", {
      account: address,
      forward: true,
      limit: ACCOUNT_TX_PAGE,
      ...(marker === undefined ? {} : { marker }),
    });
    const list = read(page, ["transactions"]);
    if (!Array.isArray(list)) throw new Error("unexpected node answer: account_tx");
    all.push(...list);
    marker = read(page, ["marker"]);
  } while (marker !== undefined);
  return all;
}

/** The RegularKey a rotation Batch installs, read from its SetRegularKey inner transaction. */
function installedKey(batch: unknown): string | undefined {
  const raws = read(batch, ["RawTransactions"]);
  if (!Array.isArray(raws)) return undefined;
  for (const wrapper of raws) {
    const raw = read(wrapper, ["RawTransaction"]);
    if (read(raw, ["TransactionType"]) === "SetRegularKey") {
      const key = read(raw, ["RegularKey"]);
      return typeof key === "string" ? key : undefined;
    }
  }
  return undefined;
}

/**
 * Scans the account's history: each rotation key's public key appears exactly once, in the Batch
 * that replaces it, and the key in force has never appeared.
 */
async function auditHistory(account: string, master: Key, keys: readonly Key[]): Promise<void> {
  const revealed = new Map<string, { count: number; installs: string | undefined }>();
  for (const entry of await accountHistory(account)) {
    // API v2 (`tx_json`) or v1 (`tx`) shape.
    const tx = read(entry, ["tx_json"]) ?? read(entry, ["tx"]);
    const signer = read(tx, ["SigningPubKey"]);
    // Inner Batch transactions have no signer; the funding payment is signed by genesis.
    if (read(tx, ["Account"]) !== account || typeof signer !== "string" || signer === "") continue;
    const seen = revealed.get(signer);
    revealed.set(signer, { count: (seen?.count ?? 0) + 1, installs: installedKey(tx) });
  }

  console.log(`\n— History of ${account}: ${revealed.size} public keys revealed`);
  const masterSeen = revealed.get(master.publicKey)?.count ?? 0;
  console.log(
    `    master ${prefix(master.publicKey)} revealed by the ${masterSeen} setup transactions, then disabled`,
  );
  const current = await regularKeyOf(account);
  for (const [i, key] of keys.entries()) {
    const seen = revealed.get(key.publicKey);
    const inForce = key.address === current;
    // A retired key is revealed once, by the Batch that installs the next key in its place.
    const ok = inForce
      ? seen === undefined
      : seen?.count === 1 && seen.installs === keys[i + 1]?.address;
    const what = inForce
      ? "never revealed, RegularKey in force"
      : `revealed ${seen?.count ?? 0}×, by the Batch installing ${seen?.installs ?? "nothing"}`;
    console.log(`${ok ? "OK " : "!! "} K${key.index} ${prefix(key.publicKey)} ${what}`);
    if (!ok) throw new Error(`K${key.index}: unexpected history`);
  }
  const unexpected = [...revealed.keys()].filter(
    (publicKey) =>
      publicKey !== master.publicKey && !keys.some((key) => key.publicKey === publicKey),
  );
  if (unexpected.length > 0) throw new Error(`unknown signers: ${unexpected.join(", ")}`);
}

try {
  const master = deriveKey(MASTER_INDEX);
  const keys = Array.from({ length: ROTATIONS + 1 }, (_, i) => deriveKey(i + 1));
  const account = master.address;
  const bobSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const bob = addressOfSeed(bobSeed);
  const genesis = addressOfSeed(genesisSeed);
  const first = keys[0];
  const last = keys[ROTATIONS];
  if (first === undefined || last === undefined) throw new Error("no rotation keys");

  console.log(`— Setup on ${NODE_WS}: account ${account}, recipient ${bob}`);
  await submit(
    `fund the account (${ACCOUNT_FUNDING_XRP} XRP)`,
    paymentTx(genesis, account, ACCOUNT_FUNDING_XRP),
    genesisSeed,
    "tesSUCCESS",
  );
  await submit(
    `fund the recipient (${RECIPIENT_FUNDING_XRP} XRP)`,
    paymentTx(genesis, bob, RECIPIENT_FUNDING_XRP),
    genesisSeed,
    "tesSUCCESS",
  );
  await submit(
    `SetRegularKey -> K1 ${first.address}`,
    { TransactionType: "SetRegularKey", Account: account, RegularKey: first.address },
    master.seed,
    "tesSUCCESS",
  );
  await submit(
    "disable the master key",
    { TransactionType: "AccountSet", Account: account, SetFlag: ASF_DISABLE_MASTER },
    master.seed,
    "tesSUCCESS",
  );
  const flags = Number(read(await accountRoot(account), ["Flags"]));
  if ((flags & LSF_DISABLE_MASTER) === 0) throw new Error("the master key is not disabled");

  for (let n = 0; n < ROTATIONS; n++) {
    const current = keys[n];
    const next = keys[n + 1];
    if (current === undefined || next === undefined) throw new Error("missing rotation key");
    console.log(`\n— Payment ${n + 1}: signed by K${current.index}, rotates to K${next.index}`);
    const outer = await submit(
      `Batch [Payment ${PAYMENT_XRP} XRP, SetRegularKey]`,
      batchTx(
        account,
        [
          paymentTx(account, bob, PAYMENT_XRP),
          { TransactionType: "SetRegularKey", Account: account, RegularKey: next.address },
        ],
        TF_ALL_OR_NOTHING,
      ),
      current.seed,
      "tesSUCCESS",
    );
    await expectInnerApplied(outer);
    const regularKey = await regularKeyOf(account);
    console.log(`    revealed public key: K${current.index} ${prefix(current.publicKey)}`);
    console.log(`    new RegularKey:      ${regularKey} (K${next.index}, public key unrevealed)`);
    if (regularKey !== next.address) throw new Error(`RegularKey is ${regularKey}`);
  }

  console.log("\n— Retired keys and the master key are refused");
  for (const retired of keys.slice(0, ROTATIONS)) {
    await submit(
      `Payment signed by the retired K${retired.index}`,
      paymentTx(account, bob, PAYMENT_XRP),
      retired.seed,
      "tefBAD_AUTH",
    );
  }
  await submit(
    "Payment signed by the master key",
    paymentTx(account, bob, PAYMENT_XRP),
    master.seed,
    "tefMASTER_DISABLED",
  );

  await auditHistory(account, master, keys);
  console.log(`\nDone: ${ROTATIONS} payments, ${ROTATIONS} keys retired, K${last.index} in force.`);
} finally {
  node.close();
}
