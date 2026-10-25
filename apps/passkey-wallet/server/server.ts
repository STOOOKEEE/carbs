// Serves the built wallet (dist/) and a faucet that funds new accounts from the
// standalone node's genesis account. Run with Node >= 22.18 (type stripping):
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 node server/server.ts
// The genesis seed comes from the environment and is never committed.

import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

import { isValidClassicAddress } from "ripple-address-codec";

import {
  addressOfSeed,
  autofill,
  loadDefinitions,
  signWithSeed,
  submitAndWait,
} from "../src/ledger.ts";
import { NodeClient } from "../src/rpc.ts";

const PORT = Number(process.env["PORT"] ?? 8080);
const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED = process.env["GENESIS_SEED"];
const DIST_DIR = new URL("../dist/", import.meta.url).pathname;
const FAUCET_PATH = "/api/faucet";
/** What a new account receives: enough for the reserve and a few payments. */
const FAUCET_DROPS = String(1_000 * 1_000_000);
const MAX_BODY_BYTES = 1_024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

if (GENESIS_SEED === undefined) throw new Error("GENESIS_SEED is not set");
const genesisSeed = GENESIS_SEED;
const genesisAddress = addressOfSeed(genesisSeed);

function reply(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  type = "application/json",
): void {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY_BYTES) throw new Error("request body too large");
  }
  return body;
}

async function fund(destination: string): Promise<string> {
  const node = await NodeClient.connect(NODE_WS);
  try {
    const defs = await loadDefinitions(node);
    const tx = await autofill(node, defs, {
      TransactionType: "Payment",
      Account: genesisAddress,
      Destination: destination,
      Amount: FAUCET_DROPS,
    });
    const { hash, result } = await submitAndWait(node, defs, signWithSeed(defs, tx, genesisSeed));
    if (result !== "tesSUCCESS") throw new Error(`funding failed: ${result}`);
    return hash;
  } finally {
    node.close();
  }
}

async function handleFaucet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed: unknown = JSON.parse(await readBody(req));
  const destination =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "destination") : undefined;
  if (typeof destination !== "string" || !isValidClassicAddress(destination)) {
    reply(res, 400, JSON.stringify({ error: "destination must be a classic XRPL address" }));
    return;
  }
  const hash = await fund(destination);
  console.log(`faucet: funded ${destination} (${hash})`);
  reply(res, 200, JSON.stringify({ destination, hash }));
}

async function handleStatic(url: string, res: ServerResponse): Promise<void> {
  const path = normalize(decodeURIComponent(url.split("?")[0] ?? "/"));
  const file = join(DIST_DIR, path === "/" ? "index.html" : path);
  if (!file.startsWith(DIST_DIR)) {
    reply(res, 403, "forbidden", "text/plain");
    return;
  }
  try {
    reply(
      res,
      200,
      await readFile(file),
      CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    );
  } catch (error) {
    if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) throw error;
    reply(res, 404, "not found", "text/plain");
  }
}

createServer((req, res) => {
  const handler =
    req.method === "POST" && req.url === FAUCET_PATH
      ? handleFaucet(req, res)
      : handleStatic(req.url ?? "/", res);
  handler.catch((error: unknown) => {
    console.error(
      `server: ${req.method} ${req.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!res.headersSent) reply(res, 500, JSON.stringify({ error: "internal error" }));
  });
}).listen(PORT, () =>
  console.log(`passkey wallet on :${PORT}, node ${NODE_WS}, faucet from ${genesisAddress}`),
);
