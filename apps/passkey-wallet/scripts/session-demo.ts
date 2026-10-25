// End-to-end test of signing sessions on the carbs node (mode C, cap per transaction, witness,
// mode A, mode P).
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

/** AccountSet flag asfDefaultRipple: an account setting no session may change. */
const ASF_DEFAULT_RIPPLE = 8;
/** PermissionValue of Payment (transaction type 0, plus one). */
const PAYMENT_PERMISSION = 1;

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
): Promise<void> {
  const filled = await autofill(node, defs, tx);
  const signed = signWithSeed(defs, filled, seed);
  const { hash, result } = await submitAndWait(
    node,
    defs,
    witnessSeed ? witnessSign(defs, signed, witnessSeed) : signed,
  );
  const accepted = typeof expected === "string" ? result === expected : expected.accepts(result);
  const verdict = accepted ? "OK " : "!! ";
  console.log(`${verdict} ${label.padEnd(58)} ${result.padEnd(26)} ${hash.slice(0, 16)}…`);
  if (!accepted) {
    const wanted = typeof expected === "string" ? expected : expected.label;
    throw new Error(`${label}: expected ${wanted}, got ${result}`);
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

  console.log("\nAll session checks behaved as expected.");
} finally {
  node.close();
}
