import { isIncluded, resultCategory, type FinalResult } from "@carbs/sessions";
import type { NodeResult, ResultFamily, TxJson } from "../ports";

/** A node answer in the shape of the port. */
export function toNodeResult(final: FinalResult): NodeResult {
  const family = (resultCategory(final.result) ?? "tef") as ResultFamily;
  return {
    code: final.result,
    family,
    // A preliminary tes or tec that never validated is not the node's last word.
    final: final.validated || !isIncluded(final.result),
    success: final.validated && final.result === "tesSUCCESS",
    feeClaimed: final.validated && isIncluded(final.result),
    hash: final.hash,
    ledgerIndex: final.ledgerIndex ?? 0,
  };
}

/** A transaction of `@carbs/sessions` in the app's shape (the envelope always carries a fee). */
export function fromCoreTx(
  tx: { TransactionType: string; Account: string } & Record<string, unknown>,
): TxJson {
  return { ...tx, Fee: String(tx["Fee"] ?? "") };
}
