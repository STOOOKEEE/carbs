// The x402-style payment protocol shared by the mock merchant and the agent: what a 402
// answer offers, and how a payment is tied to its invoice. A mode C session payment may only
// carry Destination, DestinationTag and Amount (rippled SigningSession.cpp,
// isSessionCapPayment), so the invoice travels as a DestinationTag, not as an InvoiceID.

import { read } from "../../src/ledger.ts";

export const X402_VERSION = 1;
export const X402_SCHEME = "exact";
export const X402_NETWORK = "xrpl-carbs-standalone";
/** Request header of the retry: the hash of the validated payment. */
export const PAYMENT_HEADER = "x-payment";
export const HTTP_PAYMENT_REQUIRED = 402;
/** Bytes of a random invoice id (hex encoded). */
export const INVOICE_ID_BYTES = 32;
/** DestinationTag is a uint32: the first 4 bytes of the invoice id. */
const TAG_HEX_LENGTH = 8;
const HEX_RADIX = 16;

export interface PaymentRequirement {
  scheme: string;
  network: string;
  /** The paid resource: path and query string. */
  resource: string;
  description: string;
  payTo: string;
  amountDrops: string;
  invoiceId: string;
  /** What the Payment must carry as DestinationTag. */
  destinationTag: number;
  /** Unix time in seconds after which the invoice is refused. */
  expiresAt: number;
}

export interface PaymentRequired {
  x402Version: number;
  error: string;
  accepts: PaymentRequirement[];
}

export interface ApiEntry {
  path: string;
  params: string;
  priceXrp: number;
  description: string;
}

export interface Catalogue {
  payTo: string;
  apis: ApiEntry[];
}

export function destinationTagOf(invoiceId: string): number {
  return Number.parseInt(invoiceId.slice(0, TAG_HEX_LENGTH), HEX_RADIX);
}

function isPaymentRequirement(value: unknown): value is PaymentRequirement {
  return (
    typeof read(value, ["scheme"]) === "string" &&
    typeof read(value, ["network"]) === "string" &&
    typeof read(value, ["resource"]) === "string" &&
    typeof read(value, ["description"]) === "string" &&
    typeof read(value, ["payTo"]) === "string" &&
    typeof read(value, ["amountDrops"]) === "string" &&
    typeof read(value, ["invoiceId"]) === "string" &&
    typeof read(value, ["destinationTag"]) === "number" &&
    typeof read(value, ["expiresAt"]) === "number"
  );
}

export function isPaymentRequired(value: unknown): value is PaymentRequired {
  const accepts = read(value, ["accepts"]);
  return (
    typeof read(value, ["x402Version"]) === "number" &&
    typeof read(value, ["error"]) === "string" &&
    Array.isArray(accepts) &&
    accepts.every(isPaymentRequirement)
  );
}

function isApiEntry(value: unknown): value is ApiEntry {
  return (
    typeof read(value, ["path"]) === "string" &&
    typeof read(value, ["params"]) === "string" &&
    typeof read(value, ["priceXrp"]) === "number" &&
    typeof read(value, ["description"]) === "string"
  );
}

export function isCatalogue(value: unknown): value is Catalogue {
  const apis = read(value, ["apis"]);
  return (
    typeof read(value, ["payTo"]) === "string" && Array.isArray(apis) && apis.every(isApiEntry)
  );
}
