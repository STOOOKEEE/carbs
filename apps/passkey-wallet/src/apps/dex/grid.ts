// The grid bot's strategy, without any I/O: a simulated reference price that drifts a little
// every ledger, a ladder of bids and asks around it, and the one re-quote to do next.

import { REFERENCE_PRICE_USD } from "./api.ts";
import type { OfferSide, Quote } from "./offers.ts";

/** Size of every quote of the ladder. */
export const GRID_QUOTE_XRP = 10;
/** Distance of each rung from the reference price, on both sides. */
const RUNG_OFFSETS = [0.004, 0.008];
/** Largest move of the reference price between two ledgers (relative). */
const DRIFT_STEP = 0.001;
/**
 * The reference price stays within this band around REFERENCE_PRICE_USD: the ladder (1.2 % at
 * most) never reaches the counterparty's resting offers (2 % away).
 */
const DRIFT_BAND = 0.004;
/** A rung is re-quoted once its live price is this far (relative) from its target. */
const REQUOTE_THRESHOLD = 0.0005;
/** Decimals of a quoted price: the book shows it, and the re-quote compares it. */
const PRICE_DECIMALS = 4;

export interface Rung {
  id: string;
  side: OfferSide;
  offset: number;
}

export const RUNGS: readonly Rung[] = RUNG_OFFSETS.flatMap((offset, index): Rung[] => [
  { id: `bid-${index + 1}`, side: "bid", offset },
  { id: `ask-${index + 1}`, side: "ask", offset },
]);

/** An offer of the bot still on the book: the Sequence that created it, its price, what is left. */
export interface LiveRung {
  sequence: number;
  priceUsd: number;
  sizeXrp: number;
}

export interface Requote {
  rung: Rung;
  quote: Quote;
  /** The offer this one replaces, cancelled in the same OfferCreate (OfferSequence). */
  replaces: number | undefined;
}

/** The next reference price: a bounded random walk (`random` in [0, 1)). */
export function driftReference(current: number, random: number): number {
  const moved = current * (1 + (2 * random - 1) * DRIFT_STEP);
  const low = REFERENCE_PRICE_USD * (1 - DRIFT_BAND);
  const high = REFERENCE_PRICE_USD * (1 + DRIFT_BAND);
  return Math.min(high, Math.max(low, moved));
}

function targetPrice(rung: Rung, reference: number): number {
  const factor = rung.side === "bid" ? 1 - rung.offset : 1 + rung.offset;
  return Number((reference * factor).toFixed(PRICE_DECIMALS));
}

/**
 * The rung to quote now: a missing one first (never placed, filled, expired, or partly filled:
 * topped back up to GRID_QUOTE_XRP), otherwise the one furthest from its target, if past the
 * threshold. Undefined: the ladder is up to date.
 */
export function nextRequote(
  reference: number,
  live: ReadonlyMap<string, LiveRung>,
): Requote | undefined {
  let best: { rung: Rung; distance: number } | undefined;
  for (const rung of RUNGS) {
    const current = live.get(rung.id);
    const target = targetPrice(rung, reference);
    const distance =
      current === undefined || current.sizeXrp < GRID_QUOTE_XRP
        ? Number.POSITIVE_INFINITY
        : Math.abs(current.priceUsd - target) / target;
    if (distance >= REQUOTE_THRESHOLD && (best === undefined || distance > best.distance))
      best = { rung, distance };
  }
  if (best === undefined) return undefined;
  return {
    rung: best.rung,
    quote: {
      side: best.rung.side,
      priceUsd: targetPrice(best.rung, reference),
      sizeXrp: GRID_QUOTE_XRP,
    },
    replaces: live.get(best.rung.id)?.sequence,
  };
}
