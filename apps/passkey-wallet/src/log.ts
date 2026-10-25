// The page journal: every step and every transaction result, with its explorer link.

import { describeLedgerError } from "@carbs/ledger";

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
  const item = document.createElement("li");
  item.textContent = message;
  if (tx !== undefined) {
    item.className = tx.result === "tesSUCCESS" ? "ok" : "error";
    item.append(
      explorerLink(`transactions/${tx.hash}`, ` ${tx.result} · ${tx.hash.slice(0, 12)}…`),
    );
  }
  journal().prepend(item);
}

export function logError(error: unknown): void {
  const item = document.createElement("li");
  item.className = "error";
  // The Device Management Kit rejects with plain objects (`_tag`, `errorCode`), not Errors.
  item.textContent = error instanceof Error ? error.message : describeLedgerError(error);
  journal().prepend(item);
}
