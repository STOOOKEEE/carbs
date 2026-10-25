// The streaming provider of stream.html: an XRPL account funded by the faucet on first use,
// and a meter that reads the viewer's payments to it on the validated ledgers.
// The stream is granted while a payment landed in the last GRACE_LEDGERS ledgers, cut otherwise.
// Registered by one route in server.ts; contract shared with the page (src/apps/stream/).

import type { IncomingMessage, ServerResponse } from "node:http";

import { isValidClassicAddress } from "ripple-address-codec";
import { generateSeed } from "ripple-keypairs";

import {
  type AccessAnswer,
  GRACE_LEDGERS,
  STREAM_ACCESS_PATH,
  STREAM_PROVIDER_PATH,
} from "../src/apps/stream/contract.ts";
import { addressOfSeed, read } from "../src/ledger.ts";
import { NodeClient } from "../src/rpc.ts";

export { STREAM_API_PREFIX } from "../src/apps/stream/contract.ts";

const ACCOUNT_TX_PAGE_SIZE = 200;
/** One session is at most 600 payments: 10 pages are more than enough. */
const ACCOUNT_TX_MAX_PAGES = 10;
const LEDGER_INDEX_PATTERN = /^\d{1,10}$/;
const XRP_DROPS_PATTERN = /^\d+$/;

export interface StreamDeps {
  nodeUrl: string;
  /** The server's faucet (genesis payment); resolves with the transaction hash. */
  fund: (destination: string) => Promise<string>;
}

interface StreamPayment {
  drops: number;
  ledger: number;
}

let provider: Promise<string> | undefined;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function withNode<T>(nodeUrl: string, use: (node: NodeClient) => Promise<T>): Promise<T> {
  const node = await NodeClient.connect(nodeUrl);
  try {
    return await use(node);
  } finally {
    node.close();
  }
}

/** A fresh account that only receives: its seed is not kept. */
async function createProvider({ fund }: StreamDeps): Promise<string> {
  const address = addressOfSeed(generateSeed({ algorithm: "ecdsa-secp256k1" }));
  await fund(address);
  console.log(`stream: provider ${address} funded by the faucet`);
  return address;
}

function providerAddress(deps: StreamDeps): Promise<string> {
  provider ??= createProvider(deps).catch((error: unknown) => {
    provider = undefined;
    throw error;
  });
  return provider;
}

/** A validated, successful XRP payment from `payer` to `providerAddr` in an account_tx entry. */
function streamPayment(
  entry: unknown,
  payer: string,
  providerAddr: string,
): StreamPayment | undefined {
  // API v2 names the transaction tx_json and puts ledger_index beside it; v1 puts it inside tx.
  const tx = read(entry, ["tx_json"]) ?? read(entry, ["tx"]);
  const ledger = read(entry, ["ledger_index"]) ?? read(tx, ["ledger_index"]);
  const delivered = read(entry, ["meta", "delivered_amount"]);
  if (
    read(entry, ["validated"]) !== true ||
    read(entry, ["meta", "TransactionResult"]) !== "tesSUCCESS" ||
    read(tx, ["TransactionType"]) !== "Payment" ||
    read(tx, ["Account"]) !== payer ||
    read(tx, ["Destination"]) !== providerAddr ||
    typeof ledger !== "number" ||
    typeof delivered !== "string" ||
    !XRP_DROPS_PATTERN.test(delivered)
  )
    return undefined;
  return { drops: Number(delivered), ledger };
}

/** The payer's payments to the provider on the validated ledgers from `since` on. */
async function readAccess(
  node: NodeClient,
  providerAddr: string,
  payer: string,
  since: number,
): Promise<AccessAnswer> {
  let payments = 0;
  let paidDrops = 0;
  let lastPaidLedger: number | null = null;
  let validatedLedger = 0;
  let marker: unknown;
  for (let page = 0; page < ACCOUNT_TX_MAX_PAGES; page++) {
    const answer = await node.request("account_tx", {
      account: providerAddr,
      ledger_index_min: since,
      ledger_index_max: -1,
      forward: false,
      limit: ACCOUNT_TX_PAGE_SIZE,
      ...(marker === undefined ? {} : { marker }),
    });
    const maxLedger = read(answer, ["ledger_index_max"]);
    const transactions = read(answer, ["transactions"]);
    if (typeof maxLedger !== "number" || !Array.isArray(transactions))
      throw new Error("unexpected account_tx answer");
    validatedLedger = Math.max(validatedLedger, maxLedger);
    for (const entry of transactions) {
      const payment = streamPayment(entry, payer, providerAddr);
      if (payment === undefined) continue;
      payments += 1;
      paidDrops += payment.drops;
      lastPaidLedger = Math.max(lastPaidLedger ?? 0, payment.ledger);
    }
    marker = read(answer, ["marker"]);
    if (marker === undefined) break;
  }
  const granted = lastPaidLedger !== null && validatedLedger - lastPaidLedger < GRACE_LEDGERS;
  return { granted, payments, paidDrops, lastPaidLedger, validatedLedger };
}

async function handleAccess(res: ServerResponse, url: string, deps: StreamDeps): Promise<void> {
  const query = new URLSearchParams(url.split("?")[1] ?? "");
  const payer = query.get("payer") ?? "";
  const since = query.get("since") ?? "";
  if (!isValidClassicAddress(payer) || !LEDGER_INDEX_PATTERN.test(since)) {
    sendJson(res, 400, { error: "payer must be a classic address and since a ledger index" });
    return;
  }
  const providerAddr = await providerAddress(deps);
  const access = await withNode(deps.nodeUrl, (node) =>
    readAccess(node, providerAddr, payer, Number(since)),
  );
  // 402 Payment Required: the provider holds the stream until a payment lands.
  sendJson(res, access.granted ? 200 : 402, access);
}

export async function handleStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  deps: StreamDeps,
): Promise<void> {
  const path = url.split("?")[0] ?? "";
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  if (path === STREAM_PROVIDER_PATH) {
    sendJson(res, 200, { address: await providerAddress(deps) });
    return;
  }
  if (path === STREAM_ACCESS_PATH) {
    await handleAccess(res, url, deps);
    return;
  }
  sendJson(res, 404, { error: "not found" });
}
