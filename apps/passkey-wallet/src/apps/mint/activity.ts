// The activity list and the two guardrail layers of the footer: every result of the desk's key,
// every refusal in red with its code and a plain explanation, and the abuse checks
// (expected code vs the ledger's answer).

import { formatStatusWord, kSw } from "@carbs/ledger";

import { EXPLORER_BASE } from "../../config.ts";
import type { SubmittedTx } from "../../ledger.ts";
import { ui } from "./ui.ts";

const SUCCESS_CODE = "tesSUCCESS";
/** The most recent entries kept on screen. */
const MAX_ENTRIES = 40;
const FLASH_MS = 2_400;
const HASH_PREFIX_LENGTH = 10;

type Tone = "ok" | "ledger" | "device" | "info";
type Layer = "device" | "ledger";

const ICONS: Record<Tone, string> = { ok: "✓", ledger: "✕", device: "⊘", info: "·" };

/** Plain explanations of the ledger's refusals, for the jury. */
const EXPLANATIONS: Record<string, string> = {
  tefSESSION_TX_NOT_ALLOWED:
    "this session may only mint NFTs: every XRPL node refuses any other transaction",
  tefSESSION_LIMIT: "the session's transaction count is used up: the ledger refuses one more",
  tefSESSION_EXPIRED: "the session's time is over: the desk's key is now useless",
  tefSESSION_NO_WITNESS: "the session's witness did not co-sign: refused by the ledger",
  tefBAD_AUTH: "the session is closed: this key no longer signs for the account",
};

const refusals: Record<Layer, number> = { device: 0, ledger: 0 };

function countRefusal(layer: Layer): void {
  refusals[layer] += 1;
  const { box, count } = ui.layers[layer];
  count.textContent = `${refusals[layer]} refused`;
  box.classList.add("lit", "flash");
  setTimeout(() => box.classList.remove("flash"), FLASH_MS);
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function append(tone: Tone, text: string, details: Node[]): void {
  const item = document.createElement("li");
  item.className = `event event-${tone}`;
  const body = span("event-body", "");
  body.append(span("event-text", text), ...details);
  item.append(span("event-icon", ICONS[tone]), body);
  ui.activity.prepend(item);
  while (ui.activity.children.length > MAX_ENTRIES) ui.activity.lastElementChild?.remove();
}

function txLink(hash: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `${EXPLORER_BASE}/transactions/${hash}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "event-link";
  link.textContent = `${hash.slice(0, HASH_PREFIX_LENGTH)}…`;
  return link;
}

export function logInfo(text: string): void {
  append("info", text, []);
}

/**
 * A result of a session-signed transaction. A refusal lights the Ledger layer; with an expected
 * code (abuse attempt), the entry says whether the ledger answered exactly that.
 */
export function logResult(label: string, submitted: SubmittedTx, expected?: string): void {
  const refused = submitted.result !== SUCCESS_CODE;
  const details: Node[] = [span("event-code", submitted.result)];
  if (refused) {
    const explanation =
      EXPLANATIONS[submitted.result] ??
      (submitted.result.startsWith("tec")
        ? "applied without effect, the fee is charged"
        : "refused by the ledger");
    details.push(span("event-detail", explanation));
    countRefusal("ledger");
  }
  if (expected !== undefined)
    details.push(
      span(
        "event-expected",
        submitted.result === expected ? `expected ${expected} ✓` : `expected ${expected} ✗`,
      ),
    );
  details.push(txLink(submitted.hash));
  append(refused ? "ledger" : "ok", label, details);
}

/** The Stax refused to sign: nothing reached the ledger. */
export function logDeviceRefusal(label: string): void {
  append("device", label, [
    span("event-code", formatStatusWord(kSw.sessionPolicyRefused)),
    span("event-detail", "beyond the minting profile of the Stax: nothing was signed"),
  ]);
  countRefusal("device");
}
