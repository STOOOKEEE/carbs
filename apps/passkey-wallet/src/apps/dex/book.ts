// What the page reads of the DEX: both sides of the XRP/USD book (book_offers), the trader's own
// offers (account_offers) and whether it trusts the issuer (account_lines).

import type { Connection } from "../../account.ts";
import { read } from "../../ledger.ts";
import type { Market } from "./api.ts";
import { type BookOffer, type OfferSide, parseOffer } from "./offers.ts";

/** Offers shown per side of the book. */
const BOOK_DEPTH = 8;
const XRP_CURRENCY = { currency: "XRP" };

export interface OrderBook {
  /** Highest price first. */
  bids: BookOffer[];
  /** Lowest price first. */
  asks: BookOffer[];
}

function entries(answer: unknown, key: string): unknown[] {
  const found = read(answer, [key]);
  return Array.isArray(found) ? found : [];
}

async function bookSide(
  { node }: Connection,
  market: Market,
  side: OfferSide,
): Promise<BookOffer[]> {
  const usd = { currency: market.currency, issuer: market.issuer };
  // An ask gives XRP for USD; a bid gives USD for XRP.
  const answer = await node.request("book_offers", {
    taker_gets: side === "ask" ? XRP_CURRENCY : usd,
    taker_pays: side === "ask" ? usd : XRP_CURRENCY,
    limit: BOOK_DEPTH,
    ledger_index: "current",
  });
  return entries(answer, "offers").flatMap((offer) => {
    const parsed = parseOffer(
      market,
      read(offer, ["Account"]),
      read(offer, ["Sequence"]),
      read(offer, ["TakerGets"]),
      read(offer, ["TakerPays"]),
    );
    return parsed?.side === side ? [parsed] : [];
  });
}

export async function readOrderBook(connection: Connection, market: Market): Promise<OrderBook> {
  const [bids, asks] = await Promise.all([
    bookSide(connection, market, "bid"),
    bookSide(connection, market, "ask"),
  ]);
  return {
    bids: bids.sort((a, b) => b.priceUsd - a.priceUsd),
    asks: asks.sort((a, b) => a.priceUsd - b.priceUsd),
  };
}

/** The account's XRP/USD offers on the book, keyed by the Sequence that created them. */
export async function readOwnOffers(
  { node }: Connection,
  market: Market,
  account: string,
): Promise<Map<number, BookOffer>> {
  const answer = await node.request("account_offers", { account, ledger_index: "current" });
  const offers = new Map<number, BookOffer>();
  for (const offer of entries(answer, "offers")) {
    const parsed = parseOffer(
      market,
      account,
      read(offer, ["seq"]),
      read(offer, ["taker_gets"]),
      read(offer, ["taker_pays"]),
    );
    if (parsed !== undefined) offers.set(parsed.sequence, parsed);
  }
  return offers;
}

/** The account has a trust line to the market's issuer for its currency. */
export async function trustsIssuer(
  { node }: Connection,
  market: Market,
  account: string,
): Promise<boolean> {
  const answer = await node.request("account_lines", {
    account,
    peer: market.issuer,
    ledger_index: "current",
  });
  return entries(answer, "lines").some((line) => read(line, ["currency"]) === market.currency);
}
