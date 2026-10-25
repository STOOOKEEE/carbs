// The page journal: every step and every transaction result, with its explorer link.

import { describeLedgerError } from "@carbs/ledger";

import type { InnerResult } from "./batch-results.ts";
import { EXPLORER_BASE } from "./config.ts";
import type { SubmittedTx } from "./ledger.ts";

function journal(): HTMLOListElement {
  const found = document.getElementById("log");
  if (!(found instanceof HTMLOListElement)) throw new Error("missing element #log");
  return found;
}

export function explorerLink(path: string, text: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `${EXPLORER_BASE}/${path}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  return link;
}

export function log(message: string, tx?: SubmittedTx): void {
  if (tx !== undefined) {
    logOutcome(message, tx, tx.result === "tesSUCCESS");
    return;
  }
  const item = document.createElement("li");
  item.textContent = message;
  journal().prepend(item);
}

/** A transaction line, green when its result is the one the demo expects (even a refusal). */
export function logOutcome(message: string, tx: SubmittedTx, expected: boolean): void {
  const item = document.createElement("li");
  item.textContent = message;
  item.className = expected ? "ok" : "error";
  item.append(explorerLink(`transactions/${tx.hash}`, ` ${tx.result} · ${tx.hash.slice(0, 12)}…`));
  journal().prepend(item);
}

/** One line per inner transaction of a Batch: its own result, or that the node discarded it. */
export function logInnerResults(inner: readonly InnerResult[]): void {
  for (const [index, tx] of inner.entries()) {
    const label = `  ↳ inner ${index + 1}/${inner.length}: ${tx.transactionType} (sequence ${tx.sequence})`;
    if (tx.applied === undefined) {
      const item = document.createElement("li");
      item.className = "error";
      item.textContent = `${label}: not applied, discarded by the node`;
      journal().prepend(item);
    } else {
      log(`${label}:`, tx.applied);
    }
  }
}

export function logError(error: unknown): void {
  const item = document.createElement("li");
  item.className = "error";
  // The Device Management Kit rejects with plain objects (`_tag`, `errorCode`), not Errors.
  item.textContent = error instanceof Error ? error.message : describeLedgerError(error);
  journal().prepend(item);
}
