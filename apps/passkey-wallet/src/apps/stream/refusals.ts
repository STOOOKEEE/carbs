// The guardrails at work: each refusal in red (ledger) or purple (device) with its code and a
// plain explanation, the two footer layers counting them, and the page's one-line message.

import { ui } from "./ui.ts";

export type Layer = "device" | "ledger";
export type MessageTone = "info" | "ok" | "device" | "error";

/** The status word of the Stax when an opening goes beyond the session profile. */
export const DEVICE_PROFILE_CODE = "0x6986";
/** Refusals kept on screen; older ones scroll away. */
const MAX_REFUSALS_SHOWN = 4;
const FLASH_MS = 2_400;

const EXPLANATIONS: Record<string, string> = {
  tefSESSION_LIMIT:
    "beyond a session limit (per payment, cap or tx count): refused by every XRPL node",
  tefSESSION_EXPIRED: "the 10-minute session is over: the key is useless",
  tefSESSION_TX_NOT_ALLOWED: "a streaming session only pays XRP: refused by the ledger",
  tefBAD_AUTH: "session closed: this key no longer signs for the account",
  [DEVICE_PROFILE_CODE]: "beyond the streaming profile: blocked on the Stax, nothing signed",
};

const counts: Record<Layer, number> = { device: 0, ledger: 0 };

export function showMessage(text: string, tone: MessageTone): void {
  ui.message.hidden = false;
  ui.message.textContent = text;
  ui.message.className = `stax-message message-${tone}`;
}

function line(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

/** Records a refusal: what was attempted, the code, and why it was refused. */
export function addRefusal(layer: Layer, code: string, attempt: string): void {
  const item = document.createElement("li");
  item.className = `refusal refusal-${layer}`;
  item.append(
    line("refusal-code", code),
    line("refusal-attempt", attempt),
    line("refusal-why", EXPLANATIONS[code] ?? "refused by the ledger"),
  );
  ui.refusals.prepend(item);
  while (ui.refusals.children.length > MAX_REFUSALS_SHOWN) ui.refusals.lastElementChild?.remove();

  counts[layer] += 1;
  const { box, count } = ui.layers[layer];
  count.textContent = `${counts[layer]} refused`;
  box.classList.add("lit", "flash");
  setTimeout(() => box.classList.remove("flash"), FLASH_MS);
}
