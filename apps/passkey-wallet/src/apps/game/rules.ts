// Hash Blaster's rules, shared by the page and the house (server/game.ts): what a shot costs,
// what a hit pays, the session the owner opens for the game, and the roll that decides a hit.
// The roll uses the hash of the ledger that validated the shot: unknown when the shot is
// signed, so the player cannot grind a winning transaction.

import { hexToBytes } from "../../hex.ts";
import type { CapRules, SessionProfile } from "../../session.ts";

export interface Target {
  kind: "duck" | "golden";
  label: string;
  /** The shot's DestinationTag: the house reads which target was shot from it. */
  tag: number;
  priceXrp: number;
  rewardXrp: number;
  /** Probability that a validated shot hits (house edge: hitChance * reward < price). */
  hitChance: number;
}

export const DUCK: Target = {
  kind: "duck",
  label: "Duck",
  tag: 1,
  priceXrp: 0.01,
  rewardXrp: 0.03,
  hitChance: 0.3,
};

export const GOLDEN_DUCK: Target = {
  kind: "golden",
  label: "Golden duck",
  tag: 2,
  priceXrp: 0.05,
  rewardXrp: 0.2,
  hitChance: 0.2,
};

export const TARGETS: readonly Target[] = [DUCK, GOLDEN_DUCK];

/** The "Try to abuse" bet: above the session's 0.1 XRP per payment. */
export const ABUSE_BET_XRP = 1;

/** A game session: mode C with a per-payment limit, a tx count, a duration and the Stax profile. */
export type GameSessionRules = CapRules & {
  maxPerTxXrp: number;
  durationSeconds: number;
  maxTxCount: number;
  profile: SessionProfile;
};

/** Device profile "game": many transactions, a tiny cap (docs/device-contract.md). */
export const GAME_SESSION: GameSessionRules = {
  mode: "cap",
  capXrp: 5,
  maxPerTxXrp: 0.1,
  maxTxCount: 300,
  durationSeconds: 600,
  profile: "game",
};

/** The same opening with a cap far beyond the Stax "game" profile (at most 5 XRP). */
export const GREEDY_GAME_SESSION: GameSessionRules = { ...GAME_SESSION, capXrp: 50 };

const DROPS_PER_XRP = 1_000_000;
const ROLL_BYTES_RANGE = 0x1_0000;

export function xrpToDrops(xrp: number): string {
  return String(Math.round(xrp * DROPS_PER_XRP));
}

export function dropsToXrp(drops: string): number {
  return Number(drops) / DROPS_PER_XRP;
}

export function targetOfTag(tag: number): Target | undefined {
  return TARGETS.find((target) => target.tag === tag);
}

/** SHA-256(ledger hash ‖ shot hash): its first two bytes, as a share of 1, against the chance. */
export async function isHit(
  shotHash: string,
  ledgerHash: string,
  target: Target,
): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", hexToBytes(ledgerHash + shotHash));
  return new DataView(digest).getUint16(0) / ROLL_BYTES_RANGE < target.hitChance;
}
