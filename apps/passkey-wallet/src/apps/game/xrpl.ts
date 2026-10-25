// Node calls the game needs beyond src/ledger.ts, shared by the page and the house: submit
// without waiting for validation (a game fires faster than the ledger closes, one every 3 s),
// and read a validated ledger's hash and transaction results in one request.

import { type XrplDefinitions, encode } from "ripple-binary-codec";

import { type SubmittedTx, type TxJson, read } from "../../ledger.ts";
import type { NodeClient, RpcResult } from "../../rpc.ts";

/** queued: held by the node's queue, it still takes its Sequence. */
const QUEUED = "terQUEUED";

/** Submits a signed transaction; `result` is the node's preliminary engine result. */
export async function submitOnly(
  node: NodeClient,
  defs: XrplDefinitions,
  signedTx: TxJson,
): Promise<SubmittedTx> {
  const answer = await node.request("submit", { tx_blob: encode(signedTx, defs) });
  const result = String(read(answer, ["engine_result"]));
  const hash = read(answer, ["tx_json", "hash"]);
  if (typeof hash !== "string") throw new Error(`submit returned no hash (${result})`);
  return { hash, result };
}

/** In the open ledger (tes, tec) or queued: the transaction took its Sequence and may validate. */
export function isAccepted(result: string): boolean {
  return result.startsWith("tes") || result.startsWith("tec") || result === QUEUED;
}

export interface ValidatedLedger {
  index: number;
  hash: string;
  /** Final result of every transaction of the ledger, by hash. */
  results: Map<string, string>;
}

/** A validated ledger with its transactions (API v1 or v2 answer shapes). */
export async function validatedLedger(
  node: NodeClient,
  index: number | "validated",
): Promise<ValidatedLedger> {
  const answer: RpcResult = await node.request("ledger", {
    ledger_index: index,
    transactions: true,
    expand: true,
  });
  const ledgerIndex = Number(
    read(answer, ["ledger_index"]) ?? read(answer, ["ledger", "ledger_index"]),
  );
  const hash = read(answer, ["ledger_hash"]) ?? read(answer, ["ledger", "ledger_hash"]);
  if (
    read(answer, ["validated"]) !== true ||
    typeof hash !== "string" ||
    !Number.isInteger(ledgerIndex)
  )
    throw new Error(`ledger ${index} is not a validated ledger`);
  const results = new Map<string, string>();
  const transactions = read(answer, ["ledger", "transactions"]);
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const txHash = read(tx, ["hash"]);
    const result =
      read(tx, ["metaData", "TransactionResult"]) ?? read(tx, ["meta", "TransactionResult"]);
    if (typeof txHash === "string" && typeof result === "string") results.set(txHash, result);
  }
  return { index: ledgerIndex, hash, results };
}
