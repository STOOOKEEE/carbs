// How the stage demo shows an agent event: its tone (colour), icon, and a plain-English line
// for the jury explaining a refusal code. Pure module.

import { DEVICE_POLICY_CODE, type TimelineEvent } from "../../server/agent-events.ts";

/** paid: green; ledger: red; device: purple; waiting: amber; the rest stays quiet. */
export type Tone = "paid" | "ledger" | "device" | "waiting" | "injection" | "expiry" | "quiet";

/** Which guardrail refused something, for the footer. */
export type Layer = "device" | "ledger";

const SUCCESS_CODE = "tesSUCCESS";

export const TONE_ICONS: Record<Tone, string> = {
  paid: "✓",
  ledger: "✕",
  device: "⊘",
  waiting: "◷",
  injection: "!",
  expiry: "◴",
  quiet: "·",
};

const EXPLANATIONS: Record<string, string> = {
  tefSESSION_LIMIT: "over the budget: refused by every XRPL node",
  tefSESSION_EXPIRED: "session expired: the agent's key is now useless",
  tefSESSION_TX_NOT_ALLOWED: "not a payment this session allows: refused by the ledger",
  tefSESSION_NO_WITNESS: "the session's witness did not co-sign: refused by the ledger",
  tefBAD_AUTH: "session closed: this key no longer signs for the account",
  tefBAD_SIGNATURE: "a co-signature where none is needed: refused by the ledger",
  [DEVICE_POLICY_CODE]: "beyond your session policy: blocked on the Stax, nothing signed",
};

export function toneOf(event: TimelineEvent): Tone {
  switch (event.type) {
    case "purchase":
      return "paid";
    case "refused":
      return event.code === DEVICE_POLICY_CODE ? "device" : "ledger";
    case "request":
    case "escalation":
      return "waiting";
    case "decision":
      return event.code === SUCCESS_CODE ? "paid" : "quiet";
    case "injection":
      return "injection";
    case "expiry":
      return "expiry";
    case "thought":
    case "info":
      return "quiet";
  }
}

/** The layer that refused the event, if it is a refusal. */
export function refusingLayer(event: TimelineEvent): Layer | undefined {
  if (event.type !== "refused") return undefined;
  return event.code === DEVICE_POLICY_CODE ? "device" : "ledger";
}

/** A plain explanation of a refusal code; undefined for other codes. */
export function explainCode(code: string): string | undefined {
  if (code === SUCCESS_CODE) return undefined;
  return EXPLANATIONS[code] ?? (code.startsWith("te") ? "refused by the ledger" : undefined);
}
