/**
 * The dev faucet of `pnpm demo`: the one place that holds the genesis key. The web app asks
 * it, on the loopback, to fund a fresh address; the browser never sees the seed. The payment
 * is signed here, with the definitions the node serves, and submitted to the node's public
 * port. Only the page's own origins may call it, and each of them funds at most
 * `FAUCET_PER_WINDOW` accounts per `FAUCET_WINDOW_MS`: the Origin header is only a browser
 * convention, so any local process can claim the page's origin, and the cap bounds what it can
 * drain from the genesis account.
 */
import {
  addressFromPublicKey,
  fetchCommonFields,
  loadDefinitions,
  signTransaction,
  submitBlob,
  type BytesSigner,
  type NodeClient,
} from "@carbs/sessions";
import { createServer, type Server } from "node:http";

export const FAUCET_DROPS = 100_000_000n;
export const FAUCET_PER_WINDOW = 10;
export const FAUCET_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 4096;
const MS_PER_SECOND = 1000;

export interface FaucetOptions {
  client: NodeClient;
  genesis: BytesSigner;
  amountDrops?: bigint;
}

export interface Funded {
  hash: string | undefined;
  result: string;
}

/** Fund `destination` from the genesis account. */
export async function fund(options: FaucetOptions, destination: string): Promise<Funded> {
  const defs = await loadDefinitions(options.client, { requireSessions: false });
  const account = addressFromPublicKey(options.genesis.publicKey);
  const common = await fetchCommonFields(options.client, account);
  const signed = await signTransaction(
    {
      TransactionType: "Payment",
      Account: account,
      Destination: destination,
      Amount: (options.amountDrops ?? FAUCET_DROPS).toString(),
      ...common,
    },
    options.genesis,
    defs,
  );
  const submitted = await submitBlob(options.client, signed.blob);
  return { hash: submitted.hash ?? signed.hash, result: submitted.engineResult };
}

const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function parseDestination(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const destination = (parsed as Record<string, unknown>)["destination"];
    return typeof destination === "string" && ADDRESS.test(destination) ? destination : undefined;
  } catch {
    return undefined;
  }
}

export interface FaucetLimits {
  /** Accounts one origin may fund per window. */
  perWindow: number;
  windowMs: number;
  now: () => number;
}

const DEFAULT_LIMITS: FaucetLimits = {
  perWindow: FAUCET_PER_WINDOW,
  windowMs: FAUCET_WINDOW_MS,
  now: () => Date.now(),
};

export function createFaucetServer(
  options: FaucetOptions,
  allowedOrigins: readonly string[],
  limits: FaucetLimits = DEFAULT_LIMITS,
): Server {
  /** When each origin was last granted a funding, within the current window. */
  const granted = new Map<string, number[]>();
  const admit = (origin: string): boolean => {
    const now = limits.now();
    const recent = (granted.get(origin) ?? []).filter((at) => now - at < limits.windowMs);
    if (recent.length >= limits.perWindow) {
      granted.set(origin, recent);
      return false;
    }
    recent.push(now);
    granted.set(origin, recent);
    return true;
  };
  return createServer((request, response) => {
    const origin = request.headers.origin;
    const allowed = origin !== undefined && allowedOrigins.includes(origin);
    if (allowed) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("access-control-allow-methods", "POST, OPTIONS");
      response.setHeader("vary", "origin");
    }
    const reply = (status: number, body: unknown): void => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };
    if (request.method === "OPTIONS") return reply(allowed ? 204 : 403, {});
    if (!allowed) return reply(403, { error: "origin not allowed" });
    if (request.method !== "POST" || request.url !== "/accounts")
      return reply(404, { error: "not found" });

    let body = "";
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const destination = size > MAX_BODY_BYTES ? undefined : parseDestination(body);
      if (destination === undefined) return reply(400, { error: 'send {"destination": "r…"}' });
      if (!admit(origin)) {
        response.setHeader("retry-after", String(Math.ceil(limits.windowMs / MS_PER_SECOND)));
        return reply(429, { error: "too many accounts funded from this origin, try again later" });
      }
      fund(options, destination).then(
        (funded) =>
          reply(
            funded.result === "tesSUCCESS" || funded.result.startsWith("ter") ? 200 : 502,
            funded,
          ),
        (error: unknown) =>
          reply(502, { error: error instanceof Error ? error.message : String(error) }),
      );
    });
  });
}
