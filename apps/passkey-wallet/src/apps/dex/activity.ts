// The activity list (newest first): every quote, abuse attempt and setup step with its result,
// refusals in red with their code and a plain explanation; and the footer's two guardrail
// layers, each counting what it refused.

import { describeLedgerError } from "@carbs/ledger";

import { explorerLink } from "../../log.ts";
import { type Tone, explainResult, toneOfResult } from "./explain.ts";
import { ui } from "./ui.ts";

/** Older entries are dropped beyond this. */
const MAX_ENTRIES = 80;
const HASH_PREFIX_LENGTH = 10;
/** How long a layer flashes after a refusal. */
const FLASH_MS = 2_400;

type Layer = "device" | "ledger";

const refusals: Record<Layer, number> = { device: 0, ledger: 0 };

function countRefusal(layer: Layer): void {
  refusals[layer] += 1;
  const { box, count } = ui.layers[layer];
  count.textContent = `${refusals[layer]} refused`;
  box.classList.add("lit", "flash");
  setTimeout(() => box.classList.remove("flash"), FLASH_MS);
}

function append(tone: Tone, text: string, detail: string | undefined, hash?: string): void {
  const item = document.createElement("li");
  item.className = `activity activity-${tone}`;
  const line = document.createElement("span");
  line.className = "activity-text";
  line.textContent = text;
  item.append(line);
  if (detail !== undefined) {
    const explanation = document.createElement("span");
    explanation.className = "activity-detail";
    explanation.textContent = detail;
    item.append(explanation);
  }
  if (hash !== undefined)
    item.append(explorerLink(`transactions/${hash}`, `${hash.slice(0, HASH_PREFIX_LENGTH)}…`));
  ui.controls.activity.prepend(item);
  while (ui.controls.activity.childElementCount > MAX_ENTRIES)
    ui.controls.activity.lastElementChild?.remove();
}

export function note(text: string, tone: Tone = "info"): void {
  append(tone, text, undefined);
}

/** A transaction and its result; a refusal by the ledger counts on the footer. */
export function logResult(what: string, result: string, hash?: string): void {
  const tone = toneOfResult(result);
  append(tone, `${what} → ${result}`, explainResult(result), hash);
  if (tone === "ledger") countRefusal("ledger");
}

/** The Stax refused the opening under its trading profile. */
export function logDeviceRefusal(what: string, code: string): void {
  append("device", `${what} → ${code}`, explainResult(code));
  countRefusal("device");
}

export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : describeLedgerError(error);
  return message.trim() === "" ? "unknown error" : message;
}

export function logError(error: unknown): void {
  append("ledger", errorText(error), undefined);
}
