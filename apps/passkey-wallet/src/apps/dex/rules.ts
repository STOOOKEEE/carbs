// The trading session's rules: mode P with offers only, the longest duration, a transaction
// count of about one quote per ledger, and the Stax profile "trading" (Memo carbs-profile).

import type { SessionRules } from "../../session.ts";

/** OfferCreate (7 + 1) and OfferCancel (8 + 1): PermissionValue = transaction type + 1. */
export const TRADING_PERMISSIONS: readonly number[] = [8, 9];
export const TRADING_PERMISSION_NAMES = "OfferCreate · OfferCancel";
/** Ten minutes: the longest SessionDuration, and the trading profile's maximum. */
export const TRADING_SESSION_SECONDS = 600;
/** About one quote per ledger for the whole session (3 s ledgers over 600 s). */
export const TRADING_MAX_TX_COUNT = 200;
/** Payment (0 + 1): outside the trading profile, to show the device layer. */
export const PAYMENT_PERMISSION = 1;

export function tradingRules(permissions: readonly number[] = TRADING_PERMISSIONS): SessionRules {
  return {
    mode: "permissions",
    permissions: [...permissions],
    durationSeconds: TRADING_SESSION_SECONDS,
    maxTxCount: TRADING_MAX_TX_COUNT,
    profile: "trading",
  };
}
