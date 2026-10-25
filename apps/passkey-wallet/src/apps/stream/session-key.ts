// The session key of the page: generated here, kept in memory, it signs the owner's payments
// alone (no prompt). Also reads the session's ledger entry: spent, cap, tx count, expiry.

import { encode } from "ripple-binary-codec";
import { generateSeed } from "ripple-keypairs";

import type { Connection } from "../../account.ts";
import {
  type SubmittedTx,
  type TxJson,
  addressOfSeed,
  autofill,
  read,
  signWithSeed,
  submitAndWait,
} from "../../ledger.ts";
import { RpcError } from "../../rpc.ts";

/** What signs with the session key: the owner's account and the key's seed. */
export interface SessionSigner {
  owner: string;
  keySeed: string;
}

export interface StreamSession extends SessionSigner {
  keyAddress: string;
  /** Ledger current when the session was opened: the provider counts payments from there. */
  sinceLedger: number;
}

/** The SigningSession entry as the last validated ledger holds it. */
export interface SessionEntry {
  spentDrops: number;
  capDrops: number | undefined;
  maxPerTxDrops: number | undefined;
  txCount: number;
  maxTxCount: number | undefined;
  /** Seconds since the XRPL epoch. */
  expiration: number | undefined;
}

export function newSessionKey(): { keySeed: string; keyAddress: string } {
  const keySeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  return { keySeed, keyAddress: addressOfSeed(keySeed) };
}

export async function currentLedger(connection: Connection): Promise<number> {
  const index = read(await connection.node.request("ledger_current"), ["ledger_current_index"]);
  if (typeof index !== "number") throw new Error("ledger_current returned no index");
  return index;
}

async function signWithSessionKey(
  connection: Connection,
  signer: SessionSigner,
  tx: TxJson,
): Promise<TxJson> {
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: signer.owner,
  });
  return signWithSeed(connection.defs, filled, signer.keySeed);
}

/**
 * Signs with the session key and submits without waiting for validation: the engine result
 * (tesSUCCESS applied to the open ledger, or the tef refusal) is the answer. The meter pays
 * once per ledger this way; what was validated, the provider reads on the ledger.
 */
export async function sendNow(
  connection: Connection,
  signer: SessionSigner,
  tx: TxJson,
): Promise<SubmittedTx> {
  const signed = await signWithSessionKey(connection, signer, tx);
  const answer = await connection.node.request("submit", {
    tx_blob: encode(signed, connection.defs),
  });
  const result = read(answer, ["engine_result"]);
  const hash = read(answer, ["tx_json", "hash"]);
  if (typeof result !== "string" || typeof hash !== "string")
    throw new Error("submit returned no engine result");
  return { hash, result };
}

/** Signs with the session key, submits and waits for a validated ledger. */
export async function sendAndWait(
  connection: Connection,
  signer: SessionSigner,
  tx: TxJson,
): Promise<SubmittedTx> {
  const signed = await signWithSessionKey(connection, signer, tx);
  return submitAndWait(connection.node, connection.defs, signed);
}

function dropsAt(node: unknown, field: string): number | undefined {
  const value = read(node, [field]);
  return typeof value === "string" ? Number(value) : undefined;
}

function numberAt(node: unknown, field: string): number | undefined {
  const value = read(node, [field]);
  return typeof value === "number" ? value : undefined;
}

/** The session's entry on the validated ledger; undefined once it is gone (closed). */
export async function readSessionEntry(
  connection: Connection,
  owner: string,
  keyAddress: string,
): Promise<SessionEntry | undefined> {
  let answer: unknown;
  try {
    answer = await connection.node.request("ledger_entry", {
      signing_session: { account: owner, session_key: keyAddress },
      ledger_index: "validated",
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const node = read(answer, ["node"]);
  if (node === undefined) return undefined;
  return {
    spentDrops: dropsAt(node, "SessionSpent") ?? 0,
    capDrops: dropsAt(node, "SessionCap"),
    maxPerTxDrops: dropsAt(node, "SessionMaxPerTx"),
    txCount: numberAt(node, "SessionTxCount") ?? 0,
    maxTxCount: numberAt(node, "SessionMaxTxCount"),
    expiration: numberAt(node, "Expiration"),
  };
}
