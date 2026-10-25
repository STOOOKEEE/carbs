// The refusals, in red with their code and a plain explanation, and the two guardrail layers of
// the footer: the Stax (its "game" profile, at opening) and the ledger (every shot).

import type { GameSessionState } from "./session-entry.ts";
import { ui } from "./ui.ts";

export type Layer = "device" | "ledger";

/** The code shown for a refusal by the Stax's session policy (status word 0x6986). */
export const DEVICE_POLICY_CODE = "0x6986";
const LIMIT_CODE = "tefSESSION_LIMIT";
const MAX_REFUSALS_SHOWN = 5;
const FLASH_MS = 2_400;

const EXPLANATIONS: Record<string, string> = {
  tefSESSION_EXPIRED: "the session is over: the game key is useless now",
  tefSESSION_TX_NOT_ALLOWED: "a game session only sends plain XRP payments",
  tefBAD_AUTH: "session closed: this key no longer signs for the player",
  [DEVICE_POLICY_CODE]: "beyond the Stax game profile: blocked on the device, nothing signed",
};

const refused: Record<Layer, number> = { device: 0, ledger: 0 };

/**
 * Why the ledger refused. tefSESSION_LIMIT covers three limits: which one is read from the
 * session entry as the ledger holds it right after the refusal.
 */
export function explainRefusal(
  code: string,
  amountXrp: number | undefined,
  state: GameSessionState | undefined,
): string {
  if (code !== LIMIT_CODE) return EXPLANATIONS[code] ?? "refused by every XRPL node";
  if (state === undefined) return "beyond the session's limits";
  if (state.maxTxCount !== undefined && state.txCount >= state.maxTxCount)
    return `tx count used up: ${state.txCount} / ${state.maxTxCount} session transactions, the next one is refused`;
  if (amountXrp !== undefined && state.maxPerTxXrp !== undefined && amountXrp > state.maxPerTxXrp)
    return `${amountXrp} XRP is above the ${state.maxPerTxXrp} XRP per payment of the session`;
  return `the ${state.capXrp ?? "?"} XRP cap would be exceeded (${state.spentXrp} XRP spent)`;
}

export function showRefusal(layer: Layer, code: string, explanation: string): void {
  refused[layer] += 1;
  const { box, count } = ui.layers[layer];
  count.textContent = `${refused[layer]} refused`;
  box.classList.add("lit", "flash");
  setTimeout(() => box.classList.remove("flash"), FLASH_MS);

  const item = document.createElement("li");
  item.className = `refusal refusal-${layer}`;
  const codeLine = document.createElement("span");
  codeLine.className = "refusal-code";
  codeLine.textContent = `${layer === "device" ? "Stax" : "Ledger"} · ${code}`;
  const text = document.createElement("span");
  text.className = "refusal-text";
  text.textContent = explanation;
  item.append(codeLine, text);
  ui.refusals.prepend(item);
  while (ui.refusals.children.length > MAX_REFUSALS_SHOWN) ui.refusals.lastElementChild?.remove();
}
