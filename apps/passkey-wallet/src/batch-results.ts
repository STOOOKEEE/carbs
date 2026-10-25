// What a validated Batch really did. The outer answers tesSUCCESS as soon as it is valid; each
// applied inner transaction is a transaction of the same ledger whose metadata names the outer
// as ParentBatchID. An inner transaction absent from that ledger was discarded.

import { read } from "./ledger.ts";
import type { NodeClient } from "./rpc.ts";

export interface InnerResult {
  transactionType: string;
  sequence: number;
  /** Hash and result of the inner transaction; undefined when the node discarded it. */
  applied: { hash: string; result: string } | undefined;
}

/** A transaction of a `tx` or `ledger` answer, in API v1 (fields at the top) or v2 (`tx_json`) shape. */
function txFields(entry: unknown): unknown {
  return read(entry, ["tx_json"]) ?? entry;
}

function metaOf(entry: unknown): unknown {
  return read(entry, ["meta"]) ?? read(entry, ["metaData"]);
}

function arrayAt(value: unknown, path: string[]): unknown[] {
  const found = read(value, path);
  if (!Array.isArray(found))
    throw new Error(`unexpected node answer: ${path.join(".")} is missing`);
  return found;
}

/** The inner transactions of a validated Batch, in order, each with its own result. */
export async function batchInnerResults(
  node: NodeClient,
  outerHash: string,
): Promise<InnerResult[]> {
  const outer = await node.request("tx", { transaction: outerHash });
  const ledgerIndex = read(outer, ["ledger_index"]);
  if (typeof ledgerIndex !== "number") throw new Error(`Batch ${outerHash} is not in a ledger`);
  const ledger = await node.request("ledger", {
    ledger_index: ledgerIndex,
    transactions: true,
    expand: true,
  });
  const children = arrayAt(ledger, ["ledger", "transactions"]).filter(
    (entry) => read(metaOf(entry), ["ParentBatchID"]) === outerHash,
  );

  return arrayAt(txFields(outer), ["RawTransactions"]).map((wrapper) => {
    const raw = read(wrapper, ["RawTransaction"]);
    const account = read(raw, ["Account"]);
    const sequence = read(raw, ["Sequence"]);
    const transactionType = read(raw, ["TransactionType"]);
    if (typeof sequence !== "number" || typeof transactionType !== "string")
      throw new Error("malformed inner transaction in the Batch");
    const child = children.find(
      (entry) =>
        read(txFields(entry), ["Account"]) === account &&
        read(txFields(entry), ["Sequence"]) === sequence,
    );
    const hash = read(child, ["hash"]) ?? read(txFields(child), ["hash"]);
    const result = read(metaOf(child), ["TransactionResult"]);
    return {
      transactionType,
      sequence,
      applied:
        typeof hash === "string" && typeof result === "string" ? { hash, result } : undefined,
    };
  });
}
