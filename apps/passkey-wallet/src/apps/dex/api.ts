// The contract between the DEX page (dex.html) and its server endpoints (server/dex.ts): paths,
// the market the server sets up, and the validation of both sides. Pure module: it runs in the
// browser and under Node's type stripping (no enums, no parameter properties).

import { isValidClassicAddress } from "ripple-address-codec";

export const DEX_API_PREFIX = "/api/dex/";
/** POST: sets the market up once (issuer, counterparty, resting offers) and returns it. */
export const DEX_MARKET_PATH = "/api/dex/market";
/** POST {destination}: the issuer sends USD inventory to an account that trusts it. */
export const DEX_INVENTORY_PATH = "/api/dex/inventory";
/** POST {side}: the counterparty sends an immediate-or-cancel order against the book. */
export const DEX_TAKER_PATH = "/api/dex/taker";

/** The issued currency of the market, quoted against XRP. */
export const QUOTE_CURRENCY = "USD";
/** Where the market sits, in USD per XRP: the counterparty quotes around it, the bot near it. */
export const REFERENCE_PRICE_USD = 0.5;
/** Size of a market order of the counterparty (the page's buttons say it). */
export const TAKER_SIZE_XRP = 15;

export interface Market {
  /** Issuer of USD (DefaultRipple, so that holders trade it with each other). */
  issuer: string;
  currency: string;
  /** The other side of the book: holds USD, keeps resting offers around the reference price. */
  counterparty: string;
}

/** buy: the counterparty buys XRP (hits the asks); sell: it sells XRP (hits the bids). */
export const TAKER_SIDES = ["buy", "sell"] as const;
export type TakerSide = (typeof TAKER_SIDES)[number];

export interface InventoryReply {
  destination: string;
  usd: string;
}

export interface TakerReply {
  side: TakerSide;
  result: string;
}

/** An invalid request body: the server answers 400 with its message. */
export class DexValidationError extends Error {}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, name: string): string | undefined {
  if (!isObject(value)) return undefined;
  const found: unknown = Reflect.get(value, name);
  return typeof found === "string" ? found : undefined;
}

function isTakerSide(value: unknown): value is TakerSide {
  return TAKER_SIDES.some((side) => side === value);
}

export function parseMarket(value: unknown): Market {
  const issuer = stringField(value, "issuer");
  const counterparty = stringField(value, "counterparty");
  const currency = stringField(value, "currency");
  if (
    issuer === undefined ||
    counterparty === undefined ||
    !isValidClassicAddress(issuer) ||
    !isValidClassicAddress(counterparty) ||
    currency !== QUOTE_CURRENCY
  )
    throw new Error("the server returned an unexpected market");
  return { issuer, currency, counterparty };
}

/** The body of POST /api/dex/inventory. */
export function parseInventoryRequest(value: unknown): string {
  const destination = stringField(value, "destination");
  if (destination === undefined || !isValidClassicAddress(destination))
    throw new DexValidationError("destination must be a classic XRPL address");
  return destination;
}

/** The body of POST /api/dex/taker. */
export function parseTakerRequest(value: unknown): TakerSide {
  const side: unknown = isObject(value) ? Reflect.get(value, "side") : undefined;
  if (!isTakerSide(side)) throw new DexValidationError(`side must be ${TAKER_SIDES.join(" or ")}`);
  return side;
}

export function parseTakerReply(value: unknown): TakerReply {
  const side: unknown = isObject(value) ? Reflect.get(value, "side") : undefined;
  const result = stringField(value, "result");
  if (!isTakerSide(side) || result === undefined)
    throw new Error("the server returned an unexpected taker answer");
  return { side, result };
}
