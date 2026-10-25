// The numbers of the streaming use case: the meter's price, the session the owner opens once
// (profile "streaming" on the Stax, enforced again by the ledger), and the abuse attempts.

import type { CapRules, SessionRules } from "../../session.ts";

export const DROPS_PER_XRP = 1_000_000;

/** The meter: one payment of PRICE_XRP every PAY_INTERVAL_MS while playing (one per ledger). */
export const PRICE_XRP = 0.005;
export const PAY_INTERVAL_MS = 3_000;

export const CAP_XRP = 1;
export const MAX_PER_PAYMENT_XRP = 0.01;
export const MAX_TX_COUNT = 600;
export const DURATION_SECONDS = 600;

export const STREAM_RULES: SessionRules & CapRules = {
  mode: "cap",
  capXrp: CAP_XRP,
  maxPerTxXrp: MAX_PER_PAYMENT_XRP,
  durationSeconds: DURATION_SECONDS,
  maxTxCount: MAX_TX_COUNT,
  profile: "streaming",
};

/** Abuse 1: one payment far above the per-payment limit (ledger: tefSESSION_LIMIT). */
export const ABUSE_PAYMENT_XRP = 0.5;
/** Abuse 3: ask the Stax for a streaming session worth more than a coffee (device: 0x6986). */
export const DEVICE_ABUSE_CAP_XRP = 20;
