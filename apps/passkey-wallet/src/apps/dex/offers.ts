// XRP/USD offers: the amounts of a bid or an ask at a price, the OfferCreate and OfferCancel that
// carry them, and the price of an offer read back from the ledger. Pure module, shared by the
// page's grid bot and the server's counterparty (Node type stripping: no enums).

import type { JsonValue, TxJson } from "../../ledger.ts";
import type { Market } from "./api.ts";

const DROPS_PER_XRP = 1_000_000;
/** Digits kept on a USD value: well inside the 15 significant digits of an issued amount. */
const USD_DECIMALS = 6;
/** OfferCreate flags. */
export const TF_IMMEDIATE_OR_CANCEL = 0x00040000;
export const TF_SELL = 0x00080000;

/** bid: the offer buys XRP and pays USD; ask: it sells XRP for USD. */
export type OfferSide = "bid" | "ask";

/** A price in USD per XRP and a size in XRP. */
export interface Quote {
  side: OfferSide;
  priceUsd: number;
  sizeXrp: number;
}

/** An offer on the book, as read from book_offers or account_offers. */
export interface BookOffer extends Quote {
  account: string;
  sequence: number;
}

export function xrpDrops(xrp: number): string {
  return String(Math.round(xrp * DROPS_PER_XRP));
}

export function usdAmount(market: Market, usd: number): TxJson {
  return { currency: market.currency, issuer: market.issuer, value: usd.toFixed(USD_DECIMALS) };
}

/**
 * The amounts of a quote: TakerGets is what the offer's owner gives, TakerPays what it receives.
 * A bid gives USD for XRP; an ask gives XRP for USD.
 */
function quoteAmounts(
  market: Market,
  quote: Quote,
): { TakerGets: JsonValue; TakerPays: JsonValue } {
  const xrp = xrpDrops(quote.sizeXrp);
  const usd = usdAmount(market, quote.sizeXrp * quote.priceUsd);
  return quote.side === "bid"
    ? { TakerGets: usd, TakerPays: xrp }
    : { TakerGets: xrp, TakerPays: usd };
}

export interface OfferOptions {
  /** Sequence of an offer of the same account to cancel in the same transaction (a re-quote). */
  replaces?: number;
  /** Ripple-epoch seconds after which the offer is dead on the ledger. */
  expiration?: number;
  flags?: number;
}

export function offerCreateTx(
  account: string,
  market: Market,
  quote: Quote,
  options: OfferOptions = {},
): TxJson {
  return {
    TransactionType: "OfferCreate",
    Account: account,
    ...quoteAmounts(market, quote),
    ...(options.replaces === undefined ? {} : { OfferSequence: options.replaces }),
    ...(options.expiration === undefined ? {} : { Expiration: options.expiration }),
    ...(options.flags === undefined ? {} : { Flags: options.flags }),
  };
}

export function offerCancelTx(account: string, sequence: number): TxJson {
  return { TransactionType: "OfferCancel", Account: account, OfferSequence: sequence };
}

/** XRP of an amount (drops as a string); undefined for an issued amount. */
function xrpOf(amount: unknown): number | undefined {
  return typeof amount === "string" && /^\d+$/.test(amount)
    ? Number(amount) / DROPS_PER_XRP
    : undefined;
}

/** USD of an issued amount of this market; undefined for XRP or another currency. */
function usdOf(market: Market, amount: unknown): number | undefined {
  if (typeof amount !== "object" || amount === null) return undefined;
  const currency: unknown = Reflect.get(amount, "currency");
  const issuer: unknown = Reflect.get(amount, "issuer");
  const value: unknown = Reflect.get(amount, "value");
  if (currency !== market.currency || issuer !== market.issuer || typeof value !== "string")
    return undefined;
  const usd = Number(value);
  return Number.isFinite(usd) ? usd : undefined;
}

/** An Offer entry (book_offers) or an account_offers line read as a quote of this market. */
export function parseOffer(
  market: Market,
  account: unknown,
  sequence: unknown,
  takerGets: unknown,
  takerPays: unknown,
): BookOffer | undefined {
  if (typeof account !== "string" || typeof sequence !== "number") return undefined;
  const bidXrp = xrpOf(takerPays);
  const bidUsd = usdOf(market, takerGets);
  if (bidXrp !== undefined && bidUsd !== undefined && bidXrp > 0)
    return { account, sequence, side: "bid", sizeXrp: bidXrp, priceUsd: bidUsd / bidXrp };
  const askXrp = xrpOf(takerGets);
  const askUsd = usdOf(market, takerPays);
  if (askXrp !== undefined && askUsd !== undefined && askXrp > 0)
    return { account, sequence, side: "ask", sizeXrp: askXrp, priceUsd: askUsd / askXrp };
  return undefined;
}
