// XRPL Batch (amendment BatchV1_1): one outer transaction of the account, signed once, carrying
// 2 to 8 inner transactions of the same account (rippled Batch.cpp). Shared by the app and the
// demo script. The outer answers tesSUCCESS as soon as it is valid: read each inner result
// (batch-results.ts), an all-or-nothing Batch may have discarded every inner transaction.

import type { TxJson } from "./ledger.ts";

export const BATCH_TRANSACTION_TYPE = "Batch";

/** Fewest inner transactions the node accepts (Batch::preflight). */
export const MIN_BATCH_TX_COUNT = 2;
/** Most inner transactions the node accepts (kMaxBatchTxCount, Protocol.h). */
export const MAX_BATCH_TX_COUNT = 8;

/** Flags of the outer Batch: exactly one, how the node applies the inner transactions. */
export const TF_ALL_OR_NOTHING = 0x00010000;
export const TF_ONLY_ONE = 0x00020000;
export const TF_UNTIL_FAILURE = 0x00040000;
export const TF_INDEPENDENT = 0x00080000;
export type BatchModeFlag =
  typeof TF_ALL_OR_NOTHING | typeof TF_ONLY_ONE | typeof TF_UNTIL_FAILURE | typeof TF_INDEPENDENT;

/** Universal flag every inner transaction must carry. */
const TF_INNER_BATCH_TXN = 0x40000000;
/** An inner transaction pays nothing: the outer pays for all. */
const INNER_FEE = "0";
/** An inner transaction carries no signature, so no signing key either. */
const INNER_SIGNING_PUB_KEY = "";
/** Base fees of a single-signed Batch beyond its inner ones: batch processing and the outer itself. */
const OUTER_BASE_FEE_UNITS = 2;

function flagsOf(tx: TxJson): number {
  const flags = tx["Flags"] ?? 0;
  if (typeof flags !== "number" || !Number.isInteger(flags) || flags < 0)
    throw new Error(`invalid Flags on ${String(tx["TransactionType"])}`);
  return flags;
}

/**
 * The outer Batch of `account`. Each inner transaction gets tfInnerBatchTxn, Fee "0" and an empty
 * SigningPubKey; its Sequence (outer + 1 + index) and the outer Fee are set by autofill.
 */
export function batchTx(account: string, inner: readonly TxJson[], mode: BatchModeFlag): TxJson {
  if (inner.length < MIN_BATCH_TX_COUNT || inner.length > MAX_BATCH_TX_COUNT)
    throw new Error(
      `a Batch carries ${MIN_BATCH_TX_COUNT} to ${MAX_BATCH_TX_COUNT} inner transactions, not ${inner.length}`,
    );
  const wrapped = inner.map((tx) => {
    if (tx["Account"] !== account)
      throw new Error("every inner transaction must be of the Batch's account");
    if (tx["TransactionType"] === BATCH_TRANSACTION_TYPE)
      throw new Error("a Batch cannot carry a Batch");
    const raw: TxJson = {
      ...tx,
      // `>>> 0`: the bitwise OR of a high bit is negative in JavaScript.
      Flags: (flagsOf(tx) | TF_INNER_BATCH_TXN) >>> 0,
      Fee: INNER_FEE,
      SigningPubKey: INNER_SIGNING_PUB_KEY,
    };
    return { RawTransaction: raw };
  });
  return {
    TransactionType: BATCH_TRANSACTION_TYPE,
    Account: account,
    Flags: mode,
    RawTransactions: wrapped,
  };
}

export function isBatch(tx: TxJson): boolean {
  return tx["TransactionType"] === BATCH_TRANSACTION_TYPE;
}

function rawTransactions(batch: TxJson): TxJson[] {
  const list = batch["RawTransactions"];
  if (!Array.isArray(list)) throw new Error("the Batch has no RawTransactions");
  return list.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error("malformed RawTransactions entry");
    const raw = entry["RawTransaction"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("malformed RawTransaction");
    return raw;
  });
}

/** The Batch with inner transaction `i` at Sequence `outerSequence + 1 + i`. */
export function withInnerSequences(batch: TxJson, outerSequence: number): TxJson {
  return {
    ...batch,
    RawTransactions: rawTransactions(batch).map((raw, index) => ({
      RawTransaction: { ...raw, Sequence: outerSequence + 1 + index },
    })),
  };
}

/**
 * The fee of a single-signed Batch whose inner transactions each cost one base fee, as
 * Batch::calculateBaseFee adds it up: one base fee for the batch, the outer's own base fee, and
 * the inner base fees (no BatchSigners here). `feePerBaseDrops` is the base fee, or the open
 * ledger fee to pay the same fee level as a plain transaction under load.
 */
export function batchFee(batch: TxJson, feePerBaseDrops: number): number {
  return (OUTER_BASE_FEE_UNITS + rawTransactions(batch).length) * feePerBaseDrops;
}

/** Splits `items` into Batches of at most MAX_BATCH_TX_COUNT, as even as possible (so none has 1 when there are several). */
export function batchGroups<T>(items: readonly T[]): T[][] {
  const groupCount = Math.ceil(items.length / MAX_BATCH_TX_COUNT);
  const groups: T[][] = [];
  let start = 0;
  for (let group = 0; group < groupCount; group++) {
    const size = Math.ceil((items.length - start) / (groupCount - group));
    groups.push(items.slice(start, start + size));
    start += size;
  }
  return groups;
}
