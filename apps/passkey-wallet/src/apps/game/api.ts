// The page's calls to the house (server/game.ts).

import { read } from "../../ledger.ts";
import {
  CLAIM_PATH,
  type ClaimAnswer,
  HOUSE_PATH,
  isClaimAnswer,
  isHouseAnswer,
} from "./protocol.ts";

async function answerOf(response: Response, path: string): Promise<unknown> {
  const body: unknown = await response.json();
  if (response.ok) return body;
  const reason = read(body, ["error"]);
  throw new Error(
    `house: ${typeof reason === "string" ? reason : `HTTP ${response.status}`} on ${path}`,
  );
}

export async function fetchHouse(): Promise<string> {
  const body = await answerOf(await fetch(HOUSE_PATH), HOUSE_PATH);
  if (!isHouseAnswer(body)) throw new Error("house: unexpected answer");
  return body.address;
}

/** Asks the house to check a validated shot and pay its reward if it hit. */
export async function claimShot(hash: string): Promise<ClaimAnswer> {
  const response = await fetch(CLAIM_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hash }),
  });
  const body = await answerOf(response, CLAIM_PATH);
  if (!isClaimAnswer(body)) throw new Error("house: unexpected claim answer");
  return body;
}
