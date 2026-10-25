// End-to-end test of signing sessions on the carbs node (mode C, cap per transaction, witness,
// mode A, mode P, Batch).
// Every line prints the node's own result; the script stops with an error at the first surprise.
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 node scripts/session-demo.ts

import { generateSeed } from "ripple-keypairs";

import { batchInnerResults } from "../src/batch-results.ts";
import { TF_ALL_OR_NOTHING, TF_INDEPENDENT, batchGroups, batchTx } from "../src/batch.ts";
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
import { closeSessionTx, openSessionTx, paymentTx, witnessSign } from "../src/session.ts";

const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED_ENV = process.env["GENESIS_SEED"];
if (GENESIS_SEED_ENV === undefined) throw new Error("GENESIS_SEED is not set");
const genesisSeed: string = GENESIS_SEED_ENV;

/** AccountSet flag asfDefaultRipple: an account setting no session may change. */
const ASF_DEFAULT_RIPPLE = 8;
/** PermissionValue of Payment (transaction type 0, plus one). */
const PAYMENT_PERMISSION = 1;
/** AccountSet flag asfDisableMaster: needs the master key's own signature, which an inner transaction lacks. */
const ASF_DISABLE_MASTER = 4;
const BATCH_INNER_NOT_APPLIED = "not applied";

const node = await NodeClient.connect(NODE_WS);
const defs = await loadDefinitions(node);

/** A result the check accepts other than one exact code. */
interface Expectation {
  label: string;
  accepts: (result: string) => boolean;
}

/** Allowed by the session: the node may still refuse it later (tec, tem…), just not as a session. */
const NOT_REFUSED_BY_SESSION: Expectation = {
  label: "any non-tef result",
  accepts: (result) => !result.startsWith("tef"),
};

async function submit(
  label: string,
  tx: TxJson,
  seed: string,
  expected: string | Expectation,
  witnessSeed?: string,
): Promise<SubmittedTx> {
  const filled = await autofill(node, defs, tx);
  const signed = signWithSeed(defs, filled, seed);
  const submitted = await submitAndWait(
    node,
    defs,
    witnessSeed ? witnessSign(defs, signed, witnessSeed) : signed,
  );
  const { hash, result } = submitted;
  const accepted = typeof expected === "string" ? result === expected : expected.accepts(result);
  const verdict = accepted ? "OK " : "!! ";
  console.log(`${verdict} ${label.padEnd(58)} ${result.padEnd(26)} ${hash.slice(0, 16)}…`);
  if (!accepted) {
    const wanted = typeof expected === "string" ? expected : expected.label;
    throw new Error(`${label}: expected ${wanted}, got ${result}`);
  }
  return submitted;
}

/**
 * Prints and checks each inner transaction of a validated Batch: the outer tesSUCCESS says nothing
 * about them. "not applied": no inner transaction may have succeeded.
 */
async function expectInner(
  outer: SubmittedTx,
  expected: "tesSUCCESS" | typeof BATCH_INNER_NOT_APPLIED,
): Promise<void> {
  for (const tx of await batchInnerResults(node, outer.hash)) {
    const result = tx.applied?.result ?? BATCH_INNER_NOT_APPLIED;
    const accepted =
      expected === BATCH_INNER_NOT_APPLIED ? result !== "tesSUCCESS" : result === expected;
    const label = `  inner ${tx.transactionType} (sequence ${tx.sequence})`;
    const hash = tx.applied === undefined ? "" : `${tx.applied.hash.slice(0, 16)}…`;
    console.log(`${accepted ? "OK " : "!! "} ${label.padEnd(58)} ${result.padEnd(26)} ${hash}`);
    if (!accepted) throw new Error(`${label}: expected ${expected}, got ${result}`);
  }
}

function offerCreateTx(owner: string): TxJson {
  return {
    TransactionType: "OfferCreate",
    Account: owner,
    TakerGets: "1000000",
    TakerPays: { currency: "USD", issuer: owner, value: "1" },
  };
}

function newSessionKey(): { seed: string; address: string } {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  return { seed, address: addressOfSeed(seed) };
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

async function sessionObjects(owner: string): Promise<unknown[]> {
  const objects = await node.request("account_objects", {
    account: owner,
    type: "signing_session",
    ledger_index: "current",
  });
  const list = read(objects, ["account_objects"]);
  if (!Array.isArray(list)) throw new Error("unexpected node answer: account_objects");
  return list;
}

async function spent(owner: string, sessionKey: string): Promise<string> {
  const entry = (await sessionObjects(owner)).find(
    (object) => read(object, ["SessionKey"]) === sessionKey,
  );
  const value = read(entry, ["SessionSpent"]);
  return typeof value === "string" ? `${Number(value) / 1_000_000} XRP` : "none";
}

async function sessionKeysOf(owner: string): Promise<string[]> {
  return (await sessionObjects(owner)).flatMap((object) => {
    const key = read(object, ["SessionKey"]);
    return typeof key === "string" ? [key] : [];
  });
}

try {
  const owner = await newFundedAccount(1_000);
  const bob = await newFundedAccount(100);
  const sessionSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const sessionKey = addressOfSeed(sessionSeed);

  console.log("\n— Session 1: 50 XRP total, 20 XRP per payment, 120 s");
  await submit(
    "open the session (master key)",
    openSessionTx(owner.address, sessionKey, {
      mode: "cap",
      durationSeconds: 120,
      capXrp: 50,
      maxPerTxXrp: 20,
    }),
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
    { TransactionType: "AccountSet", Account: owner.address, SetFlag: ASF_DEFAULT_RIPPLE },
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
      mode: "cap",
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

  console.log("\n— Session 3: mode A, every delegable transaction, no cap");
  const session3 = newSessionKey();
  await submit(
    "open the session in mode A",
    openSessionTx(owner.address, session3.address, { mode: "all", durationSeconds: 120 }),
    owner.seed,
    "tesSUCCESS",
  );
  await submit(
    "pay 5 XRP, signed by the session key",
    paymentTx(owner.address, bob.address, 5),
    session3.seed,
    "tesSUCCESS",
  );
  await submit(
    "create an offer, signed by the session key",
    offerCreateTx(owner.address),
    session3.seed,
    NOT_REFUSED_BY_SESSION,
  );
  await submit(
    "stolen key changes the regular key",
    { TransactionType: "SetRegularKey", Account: owner.address, RegularKey: session3.address },
    session3.seed,
    "tefSESSION_TX_NOT_ALLOWED",
  );
  await submit(
    "stolen key changes account settings",
    { TransactionType: "AccountSet", Account: owner.address, SetFlag: ASF_DEFAULT_RIPPLE },
    session3.seed,
    "tefSESSION_TX_NOT_ALLOWED",
  );

  console.log("\n— Session 4: mode P, Payment only");
  const session4 = newSessionKey();
  await submit(
    "open the session in mode P (Payment)",
    openSessionTx(owner.address, session4.address, {
      mode: "permissions",
      durationSeconds: 120,
      permissions: [PAYMENT_PERMISSION],
    }),
    owner.seed,
    "tesSUCCESS",
  );
  await submit(
    "pay 5 XRP, signed by the session key",
    paymentTx(owner.address, bob.address, 5),
    session4.seed,
    "tesSUCCESS",
  );
  await submit(
    "create an offer (not in the permissions)",
    offerCreateTx(owner.address),
    session4.seed,
    "tefSESSION_TX_NOT_ALLOWED",
  );

  console.log("\n— Session 5: Batch, one owner signature for several transactions");
  const session5 = newSessionKey();
  const openAndPay = await submit(
    "open a session and pay 5 XRP in one Batch (all or nothing)",
    batchTx(
      owner.address,
      [
        openSessionTx(owner.address, session5.address, {
          mode: "cap",
          durationSeconds: 120,
          capXrp: 50,
        }),
        paymentTx(owner.address, bob.address, 5),
      ],
      TF_ALL_OR_NOTHING,
    ),
    owner.seed,
    "tesSUCCESS",
  );
  await expectInner(openAndPay, "tesSUCCESS");
  await submit(
    "pay 5 XRP, signed by the session the Batch opened",
    paymentTx(owner.address, bob.address, 5),
    session5.seed,
    "tesSUCCESS",
  );
  await submit(
    "the session key signs a Batch of the account",
    batchTx(
      owner.address,
      [paymentTx(owner.address, bob.address, 1), paymentTx(owner.address, bob.address, 1)],
      TF_ALL_OR_NOTHING,
    ),
    session5.seed,
    "tefSESSION_TX_NOT_ALLOWED",
  );

  const openKeys = await sessionKeysOf(owner.address);
  console.log(`    sessions still on the ledger: ${openKeys.length}`);
  for (const group of batchGroups(openKeys)) {
    const deletes = group.map((key) => closeSessionTx(owner.address, key));
    const [single] = deletes;
    if (deletes.length === 1 && single !== undefined) {
      await submit("revoke the last session (owner)", single, owner.seed, "tesSUCCESS");
    } else {
      const revoke = await submit(
        `revoke ${deletes.length} sessions in one Batch (independent)`,
        batchTx(owner.address, deletes, TF_INDEPENDENT),
        owner.seed,
        "tesSUCCESS",
      );
      await expectInner(revoke, "tesSUCCESS");
    }
  }
  const left = await sessionKeysOf(owner.address);
  if (left.length !== 0) throw new Error(`${left.length} session(s) left after the revocation`);
  console.log("    sessions left on the ledger: 0");

  const migrationKey = newSessionKey();
  const migration = await submit(
    "key migration in one Batch: SetRegularKey + disable master",
    batchTx(
      owner.address,
      [
        {
          TransactionType: "SetRegularKey",
          Account: owner.address,
          RegularKey: migrationKey.address,
        },
        { TransactionType: "AccountSet", Account: owner.address, SetFlag: ASF_DISABLE_MASTER },
      ],
      TF_ALL_OR_NOTHING,
    ),
    owner.seed,
    "tesSUCCESS",
  );
  await expectInner(migration, BATCH_INNER_NOT_APPLIED);
  const regularKey = read(await accountInfo(node, owner.address), ["account_data", "RegularKey"]);
  if (regularKey !== undefined)
    throw new Error(`the migration Batch applied: RegularKey is ${String(regularKey)}`);
  console.log("    RegularKey absent: the outer tesSUCCESS applied nothing");

  console.log("\nAll session checks behaved as expected.");
} finally {
  node.close();
}
