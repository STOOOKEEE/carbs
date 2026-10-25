// The house's endpoints (server/game.ts) and their answers, shared by the server and the page.

export const GAME_API_PREFIX = "/api/game/";
/** GET: the house account (created and funded from genesis on the first call). */
export const HOUSE_PATH = `${GAME_API_PREFIX}house`;
/** POST {hash}: the house checks a validated shot and pays the reward on a hit. */
export const CLAIM_PATH = `${GAME_API_PREFIX}claim`;

export interface HouseAnswer {
  address: string;
}

export type ClaimAnswer = { hit: false } | { hit: true; rewardXrp: number; rewardHash: string };

export function isHouseAnswer(value: unknown): value is HouseAnswer {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "address") === "string"
  );
}

export function isClaimAnswer(value: unknown): value is ClaimAnswer {
  if (typeof value !== "object" || value === null) return false;
  const hit: unknown = Reflect.get(value, "hit");
  if (hit === false) return true;
  return (
    hit === true &&
    typeof Reflect.get(value, "rewardXrp") === "number" &&
    typeof Reflect.get(value, "rewardHash") === "string"
  );
}
