// Serves the built wallet (dist/) and a faucet that funds new accounts from the
// standalone node's genesis account. Run with Node >= 22.18 (type stripping):
//   GENESIS_SEED=… XRPLD_WS=ws://127.0.0.1:6006 node server/server.ts
// The genesis seed comes from the environment and is never committed.
// It also relays an AI agent's requests (session budget, payment above it) to the page,
// where the human decides on the Stax: in memory, never signing for the owner. The agent's
// timeline (/api/agent/events) feeds the stage demo page (demo.html).

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
import {
  AGENT_REQUESTS_PATH,
  AgentRequestStore,
  ValidationError,
  parseAgentRequest,
  parseDecision,
} from "./agent-requests.ts";
import { AGENT_EVENTS_PATH, TimelineStore, parseTimelineEvent } from "./agent-events.ts";
import { MINT_API_PREFIX, handleMint } from "./mint.ts";
import { STREAM_API_PREFIX, handleStream } from "./stream.ts";
import { handleGame } from "./game.ts";
import { GAME_API_PREFIX } from "../src/apps/game/protocol.ts";
import { handleDex } from "./dex.ts";
import { faucetCorsHeaders } from "./faucet-cors.ts";
import { DEX_API_PREFIX } from "../src/apps/dex/api.ts";

const PORT = Number(process.env["PORT"] ?? 8080);
const NODE_WS = process.env["XRPLD_WS"] ?? "ws://127.0.0.1:6006";
const GENESIS_SEED = process.env["GENESIS_SEED"];
/** WALLET_DIST serves another build (e.g. one built for a second node), ending with "/". */
const DIST_DIR = process.env["WALLET_DIST"] ?? new URL("../dist/", import.meta.url).pathname;
const FAUCET_PATH = "/api/faucet";
/** What a new account receives: enough for the reserve and a few payments. */
const FAUCET_DROPS = String(1_000 * 1_000_000);
const FAUCET_MAX_BODY_BYTES = 1_024;
/**
 * Web origins allowed to call the faucet from another site (the hosted web app), comma-separated:
 * WEB_ORIGINS. The faucet is the only cross-origin endpoint; the wallet's own pages are same-origin.
 */
const FAUCET_ORIGINS = new Set(
  (process.env["WEB_ORIGINS"] ?? "https://carbs-kappa.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== ""),
);
const AGENT_MAX_BODY_BYTES = 16 * 1_024;
/** /api/agent/requests/:id and /api/agent/requests/:id/decision */
const AGENT_RECORD_PATTERN = /^\/api\/agent\/requests\/([^/]+)(\/decision)?$/;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
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

function replyJson(res: ServerResponse, status: number, body: unknown): void {
  reply(res, status, JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new ValidationError("request body too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The JSON body of an agent endpoint; a ValidationError (400) when too large or not JSON. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req, AGENT_MAX_BODY_BYTES);
  try {
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) throw new ValidationError("the body is not valid JSON");
    throw error;
  }
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
  const parsed: unknown = JSON.parse(await readBody(req, FAUCET_MAX_BODY_BYTES));
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

const agentRequests = new AgentRequestStore();
const agentEvents = new TimelineStore();
/** The `after` query parameter of GET /api/agent/events: a sequence number (0: from the start). */
const SEQ_PATTERN = /^\d{1,15}$/;

async function handleAgentEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  if (req.method === "GET") {
    const after = new URLSearchParams(url.split("?")[1] ?? "").get("after") ?? "0";
    if (!SEQ_PATTERN.test(after)) throw new ValidationError("after must be a non-negative integer");
    replyJson(res, 200, agentEvents.after(Number(after)));
    return;
  }
  if (req.method !== "POST") {
    replyJson(res, 405, { error: "method not allowed" });
    return;
  }
  const record = agentEvents.append(parseTimelineEvent(await readJson(req)));
  replyJson(res, 201, record);
}

async function handleAgentList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    replyJson(res, 200, agentRequests.list());
    return;
  }
  if (req.method !== "POST") {
    replyJson(res, 405, { error: "method not allowed" });
    return;
  }
  const record = agentRequests.create(parseAgentRequest(await readJson(req)));
  console.log(`agent: request ${record.id} (${record.request.kind}) pending`);
  replyJson(res, 201, record);
}

async function handleAgentRecord(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  isDecision: boolean,
): Promise<void> {
  if (!isDecision) {
    if (req.method !== "GET") {
      replyJson(res, 405, { error: "method not allowed" });
      return;
    }
    const record = agentRequests.get(id);
    if (record === undefined) replyJson(res, 404, { error: "unknown request" });
    else replyJson(res, 200, record);
    return;
  }
  if (req.method !== "POST") {
    replyJson(res, 405, { error: "method not allowed" });
    return;
  }
  const outcome = agentRequests.decide(id, parseDecision(await readJson(req)));
  if (outcome.ok) {
    console.log(`agent: request ${id} ${outcome.record.status}`);
    replyJson(res, 200, outcome.record);
  } else if (outcome.reason === "not-found") {
    replyJson(res, 404, { error: "unknown request" });
  } else {
    replyJson(res, 409, { error: "the request was already decided" });
  }
}

async function handleAgent(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  path: string,
): Promise<void> {
  try {
    if (path === AGENT_EVENTS_PATH) {
      await handleAgentEvents(req, res, url);
      return;
    }
    if (path === AGENT_REQUESTS_PATH) {
      await handleAgentList(req, res);
      return;
    }
    const match = AGENT_RECORD_PATTERN.exec(path);
    const id = match?.[1];
    if (match === null || id === undefined) {
      replyJson(res, 404, { error: "not found" });
      return;
    }
    await handleAgentRecord(req, res, id, match[2] !== undefined);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    replyJson(res, 400, { error: error.message });
  }
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

/** CORS for the faucet (`faucet-cors.ts`): only the listed origins, POST with a JSON body. */
function allowFaucetOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const headers = faucetCorsHeaders(
    req.headers.origin,
    FAUCET_ORIGINS,
    req.headers["access-control-request-private-network"] === "true",
  );
  if (headers === null) return false;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  return true;
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  if (path === FAUCET_PATH) {
    const allowed = allowFaucetOrigin(req, res);
    if (req.method === "OPTIONS") return reply(res, allowed ? 204 : 403, "");
    if (req.method === "POST") return handleFaucet(req, res);
  }
  if (
    path === AGENT_EVENTS_PATH ||
    path === AGENT_REQUESTS_PATH ||
    path.startsWith(`${AGENT_REQUESTS_PATH}/`)
  )
    return handleAgent(req, res, url, path);
  if (path.startsWith(MINT_API_PREFIX)) return handleMint(req, res, path, fund);
  if (path.startsWith(STREAM_API_PREFIX))
    return handleStream(req, res, url, { nodeUrl: NODE_WS, fund });
  if (path.startsWith(GAME_API_PREFIX))
    return handleGame(req, res, path, { nodeUrl: NODE_WS, fund });
  if (path.startsWith(DEX_API_PREFIX)) return handleDex(req, res, path, { nodeUrl: NODE_WS, fund });
  return handleStatic(url, res);
}

createServer((req, res) => {
  const handler = route(req, res);
  handler.catch((error: unknown) => {
    console.error(
      `server: ${req.method} ${req.url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!res.headersSent) reply(res, 500, JSON.stringify({ error: "internal error" }));
  });
}).listen(PORT, () =>
  console.log(`passkey wallet on :${PORT}, node ${NODE_WS}, faucet from ${genesisAddress}`),
);
