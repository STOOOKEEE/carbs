// The minting session: opened once by the owner (mode P, NFTokenMint only, profile "minting"),
// then the session key, kept in this page's memory, signs every mint alone. It also counts the
// fees the session paid: the only XRP minting spends.

import { generateSeed } from "ripple-keypairs";

import type { Connection } from "../../account.ts";
import {
  type SubmittedTx,
  type TxJson,
  addressOfSeed,
  autofill,
  signWithSeed,
  submitAndWait,
} from "../../ledger.ts";
import { type SessionRules, closeSessionTx, openSessionTx } from "../../session.ts";
import type { Owner } from "./owner.ts";

/** PermissionValue = transaction type + 1: NFTokenMint is type 25. */
export const NFTOKEN_MINT_PERMISSION = 26;
export const SESSION_DURATION_SECONDS = 600;
/** The ledger refuses the 51st session-signed transaction (tefSESSION_LIMIT). */
export const SESSION_MAX_TX_COUNT = 50;
/** What the "minting" profile of the Stax allows at most: asking for more is refused on the device. */
export const PROFILE_MAX_TX_COUNT = 100;

export const MINT_RULES: SessionRules = {
  mode: "permissions",
  permissions: [NFTOKEN_MINT_PERMISSION],
  durationSeconds: SESSION_DURATION_SECONDS,
  maxTxCount: SESSION_MAX_TX_COUNT,
  profile: "minting",
};

export interface MintSession {
  owner: string;
  keySeed: string;
  keyAddress: string;
  /** Fees of the session's transactions that reached a ledger (tes or tec): what the owner paid. */
  feesPaidDrops: number;
}

/** The opening's result and, when the ledger accepted it, the desk's session. */
export interface OpenedSession {
  submitted: SubmittedTx;
  /** Undefined when the ledger refused the opening. */
  session: MintSession | undefined;
}

/** Opens a session for a fresh key, signed by the owner. */
export async function openSession(owner: Owner, rules: SessionRules): Promise<OpenedSession> {
  const keySeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const keyAddress = addressOfSeed(keySeed);
  const submitted = await owner.signAndSubmit(openSessionTx(owner.address, keyAddress, rules));
  const session =
    submitted.result === "tesSUCCESS"
      ? { owner: owner.address, keySeed, keyAddress, feesPaidDrops: 0 }
      : undefined;
  return { submitted, session };
}

async function submitSigned(
  connection: Connection,
  session: MintSession,
  signed: TxJson,
): Promise<SubmittedTx> {
  const submitted = await submitAndWait(connection.node, connection.defs, signed);
  // A tes or tec result consumed the fee; a tef or tem never reached a ledger.
  const fee = signed["Fee"];
  if (typeof fee !== "string") throw new Error("the transaction has no Fee");
  if (submitted.result.startsWith("tes") || submitted.result.startsWith("tec"))
    session.feesPaidDrops += Number(fee);
  return submitted;
}

/** A transaction of the owner, signed by the session key alone: no prompt anywhere. */
export async function submitWithSessionKey(
  connection: Connection,
  session: MintSession,
  tx: TxJson,
): Promise<SubmittedTx> {
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: session.owner,
  });
  return submitSigned(connection, session, signWithSeed(connection.defs, filled, session.keySeed));
}

/**
 * Several transactions in one go: consecutive Sequences, all submitted at once (in order, on
 * the same socket), then awaited together. Every one must be accepted: a refused one would
 * leave the next ones waiting for its Sequence until they expire.
 */
export async function submitBurstWithSessionKey(
  connection: Connection,
  session: MintSession,
  txs: readonly TxJson[],
): Promise<SubmittedTx[]> {
  const [first] = txs;
  if (first === undefined) return [];
  const template = await autofill(connection.node, connection.defs, {
    ...first,
    Account: session.owner,
  });
  const { Sequence: sequence, Fee: fee, LastLedgerSequence: lastLedger } = template;
  if (typeof sequence !== "number" || typeof fee !== "string" || typeof lastLedger !== "number")
    throw new Error("autofill gave no Sequence, Fee or LastLedgerSequence");
  const signed = txs.map((tx, index) =>
    signWithSeed(
      connection.defs,
      {
        ...tx,
        Account: session.owner,
        Sequence: sequence + index,
        Fee: fee,
        LastLedgerSequence: lastLedger,
      },
      session.keySeed,
    ),
  );
  // submitAndWait sends its submit before its first await: the node receives them in order.
  return Promise.all(signed.map((tx) => submitSigned(connection, session, tx)));
}

/** The own close: the session key deletes its session (no Owner field, no prompt). */
export function closeSession(connection: Connection, session: MintSession): Promise<SubmittedTx> {
  return submitWithSessionKey(
    connection,
    session,
    closeSessionTx(session.owner, session.keyAddress),
  );
}
