// The streaming provider's HTTP contract, shared by the page and the server (server/stream.ts):
// where the provider lives, and what it answers once it has read the viewer's payments on the
// ledger. Plain TypeScript only: the server runs it with Node's type stripping.

export const STREAM_API_PREFIX = "/api/stream/";
/** GET: the provider's XRPL address (created and funded from genesis on first use). */
export const STREAM_PROVIDER_PATH = `${STREAM_API_PREFIX}provider`;
/** GET ?payer=<address>&since=<ledger index>: 200 while the stream is paid for, 402 otherwise. */
export const STREAM_ACCESS_PATH = `${STREAM_API_PREFIX}access`;

/** The provider cuts the stream after this many validated ledgers without a payment (~3 s each). */
export const GRACE_LEDGERS = 3;

export interface ProviderInfo {
  address: string;
}

/** What the provider found on the validated ledgers since `since`, for one payer. */
export interface AccessAnswer {
  granted: boolean;
  payments: number;
  paidDrops: number;
  /** Ledger of the payer's last validated payment; null before the first one. */
  lastPaidLedger: number | null;
  /** The last validated ledger the provider read. */
  validatedLedger: number;
}

export function isProviderInfo(value: unknown): value is ProviderInfo {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "address") === "string"
  );
}

export function isAccessAnswer(value: unknown): value is AccessAnswer {
  if (typeof value !== "object" || value === null) return false;
  const lastPaidLedger: unknown = Reflect.get(value, "lastPaidLedger");
  return (
    typeof Reflect.get(value, "granted") === "boolean" &&
    typeof Reflect.get(value, "payments") === "number" &&
    typeof Reflect.get(value, "paidDrops") === "number" &&
    (lastPaidLedger === null || typeof lastPaidLedger === "number") &&
    typeof Reflect.get(value, "validatedLedger") === "number"
  );
}
