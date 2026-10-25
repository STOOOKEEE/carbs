/**
 * Named constants of the web app. The protocol limits (spec 6.9), the `LastLedgerSequence`
 * offset and the blackhole address are those of `@carbs/sessions` (`constants.ts`), for the
 * simulation as for the live path. The flag and code values below the SIMULATION line are
 * used by the simulation only (`lib/sim`, `lib/tx-builders.ts`). The live path never reads
 * them: it takes flags, codes and field names from the `server_definitions` of the node (a
 * test enforces it).
 */

/* ---- Units ---- */
export const DROPS_PER_XRP = 1_000_000;

/* ---- SIMULATION ONLY: values the simulated node and its builders need ----
 * Source of each value in the comment. The live backend never reads them: it takes
 * every protocol code from `server_definitions` (CLAUDE.md). */
/** Spec appendix A, `tfAllTransactions`. */
export const TF_ALL_TRANSACTIONS = 0x00010000;
/** `tfFullyCanonicalSig`, which the simulated node adds to every transaction. */
export const TF_FULLY_CANONICAL_SIG = 0x80000000;
/** `AccountSet` flag `asfDisableMaster`. */
export const ASF_DISABLE_MASTER = 4;

/* ---- SIMULATED node parameters (labelled SIMULATED wherever they surface) ---- */
export const SIM_BASE_FEE_DROPS = 10;
export const SIM_RESERVE_BASE_DROPS = 1_000_000;
export const SIM_RESERVE_OWNER_DROPS = 200_000;
export const SIM_FAUCET_DROPS = 100 * DROPS_PER_XRP;
export const SIM_LEDGER_CLOSE_SEC = 3;
/** Ripple epoch second at which the simulated ledger starts (2026-10-24 00:00:00 UTC). */
export const SIM_START_CLOSE_TIME = 846_201_600;
export const SIM_START_LEDGER_INDEX = 1_000;

/* ---- UI ---- */
export const SESSION_DURATION_CHOICES_SEC = [60, 180, 300, 600] as const;
export const DEFAULT_CAP_XRP = 20;
export const DEMO_PAYMENT_XRP = 3.5;
export const SIM_TICK_MS = 3000;
export const DEFAULT_FEE_DROPS = "12";
export const SIM_SINK_SEED = "demo:sink";
export const SIM_VICTIM_SEED = "demo:victim";
