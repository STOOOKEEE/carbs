// The order book column: asks above (lowest next to the reference), bids below (highest first),
// the bot's offers highlighted against the counterparty's.

import type { Market } from "./api.ts";
import type { OrderBook } from "./book.ts";
import type { BookOffer } from "./offers.ts";
import { ui } from "./ui.ts";

const PRICE_DECIMALS = 4;
const SIZE_DECIMALS = 2;
const ADDRESS_PREFIX_LENGTH = 8;

function who(offer: BookOffer, market: Market, owner: string | undefined): string {
  if (offer.account === owner) return "your bot";
  if (offer.account === market.counterparty) return "counterparty";
  return `${offer.account.slice(0, ADDRESS_PREFIX_LENGTH)}…`;
}

function row(offer: BookOffer, market: Market, owner: string | undefined): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `book-row book-${offer.side}${offer.account === owner ? " book-own" : ""}`;
  for (const text of [
    offer.priceUsd.toFixed(PRICE_DECIMALS),
    offer.sizeXrp.toFixed(SIZE_DECIMALS),
    who(offer, market, owner),
  ]) {
    const cell = document.createElement("span");
    cell.textContent = text;
    item.append(cell);
  }
  return item;
}

export function renderBook(
  book: OrderBook,
  market: Market,
  owner: string | undefined,
  referencePrice: number,
): void {
  ui.book.asks.replaceChildren(...book.asks.toReversed().map((offer) => row(offer, market, owner)));
  ui.book.bids.replaceChildren(...book.bids.map((offer) => row(offer, market, owner)));
  ui.book.reference.textContent = `Reference ${referencePrice.toFixed(PRICE_DECIMALS)} USD (simulated feed)`;
}
