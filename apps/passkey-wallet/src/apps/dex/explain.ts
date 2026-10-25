// What a transaction result means for the jury, in plain English, and which guardrail it
// belongs to. Pure module.

import { TRADING_MAX_TX_COUNT, TRADING_PERMISSION_NAMES } from "./rules.ts";

export type Tone = "ok" | "ledger" | "device" | "warning" | "info";

const SUCCESS = "tesSUCCESS";
/** Shown for a Stax refusal at opening (SW 0x6986): not a ledger code. */
export const DEVICE_POLICY_CODE = "0x6986";

const EXPLANATIONS: Record<string, string> = {
  tefSESSION_TX_NOT_ALLOWED: `not an offer: this session may only send ${TRADING_PERMISSION_NAMES}, refused by every XRPL node`,
  tefSESSION_LIMIT: `the session's ${TRADING_MAX_TX_COUNT} transactions are used up (SessionMaxTxCount)`,
  tefSESSION_EXPIRED: "the session is over (SessionDuration): the bot's key is now useless",
  tefSESSION_NO_WITNESS: "the session's witness did not co-sign",
  tefBAD_AUTH: "the session is closed: this key no longer signs for the account",
  tecKILLED: "nothing to cross at that price: the order was cancelled at once",
  tecEXPIRED: "the offer's Expiration had already passed",
  tecUNFUNDED_OFFER: "the account does not hold what the offer gives",
  tecPATH_DRY: "no trust line to the issuer yet",
  [DEVICE_POLICY_CODE]: "beyond the trading profile: blocked on the Stax, nothing signed",
};

/** tes: applied; tec: applied with an error (fee taken, counted); anything else: refused. */
export function toneOfResult(result: string): Tone {
  if (result === SUCCESS) return "ok";
  if (result === DEVICE_POLICY_CODE) return "device";
  if (result.startsWith("tec")) return "warning";
  return "ledger";
}

export function explainResult(result: string): string | undefined {
  if (result === SUCCESS) return undefined;
  return EXPLANATIONS[result] ?? (result.startsWith("te") ? "refused by the ledger" : undefined);
}
