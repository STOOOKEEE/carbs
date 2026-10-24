/**
 * The dev faucet of `pnpm demo`: the one place that holds the genesis key. The web app asks
 * it, on the loopback, to fund a fresh address; the browser never sees the seed. The payment
 * is signed here, with the definitions the node serves, and submitted to the node's public
 * port. Only the page's own origins may call it.
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
const MAX_BODY_BYTES = 4096;

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

export function createFaucetServer(
  options: FaucetOptions,
  allowedOrigins: readonly string[],
): Server {
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
