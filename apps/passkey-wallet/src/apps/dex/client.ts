// The page's calls to its server endpoints (server/dex.ts).

import {
  DEX_INVENTORY_PATH,
  DEX_MARKET_PATH,
  DEX_TAKER_PATH,
  type Market,
  type TakerReply,
  type TakerSide,
  parseMarket,
  parseTakerReply,
} from "./api.ts";

async function post(path: string, body: unknown): Promise<unknown> {
  const answer = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!answer.ok) throw new Error(`${path}: ${answer.status} ${await answer.text()}`);
  return answer.json();
}

/** The market (issuer, counterparty): created by the server on the first call. */
export async function fetchMarket(): Promise<Market> {
  return parseMarket(await post(DEX_MARKET_PATH, {}));
}

/** USD inventory from the issuer, once the trader trusts it. */
export async function requestInventory(destination: string): Promise<void> {
  await post(DEX_INVENTORY_PATH, { destination });
}

/** A market order of the counterparty against the book. */
export async function sendTakerOrder(side: TakerSide): Promise<TakerReply> {
  return parseTakerReply(await post(DEX_TAKER_PATH, { side }));
}
