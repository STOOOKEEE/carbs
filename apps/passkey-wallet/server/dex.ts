// The market behind the DEX page (dex.html), funded by the faucet: a USD issuer
// (DefaultRipple), a counterparty holding USD with resting offers around the reference price,
// the USD inventory of the trader once its trust line exists, and the counterparty's market
// orders that fill the trader's quotes. Never signs for the trader: its seeds stay here.

import type { IncomingMessage, ServerResponse } from "node:http";

import { generateSeed } from "ripple-keypairs";

import {
  type TxJson,
  accountInfo,
  addressOfSeed,
  autofill,
  loadDefinitions,
  signWithSeed,
  submitAndWait,
} from "../src/ledger.ts";
import { NodeClient } from "../src/rpc.ts";
import type { Connection } from "../src/account.ts";
import {
  DEX_INVENTORY_PATH,
  DEX_MARKET_PATH,
  DEX_TAKER_PATH,
  DexValidationError,
  type InventoryReply,
  type Market,
  QUOTE_CURRENCY,
  REFERENCE_PRICE_USD,
  TAKER_SIZE_XRP,
  type TakerReply,
  type TakerSide,
  parseInventoryRequest,
  parseTakerRequest,
} from "../src/apps/dex/api.ts";
import {
  type Quote,
  TF_IMMEDIATE_OR_CANCEL,
  TF_SELL,
  offerCreateTx,
  usdAmount,
} from "../src/apps/dex/offers.ts";

/** AccountSet flag asfDefaultRipple: holders of USD can trade it with each other. */
const ASF_DEFAULT_RIPPLE = 8;
const COUNTERPARTY_TRUST_LIMIT_USD = 1_000_000;
const COUNTERPARTY_USD = 10_000;
/** The counterparty's resting quotes: this far from the reference price, on both sides. */
const COUNTERPARTY_SPREADS = [0.02, 0.03, 0.04];
const COUNTERPARTY_QUOTE_XRP = 50;
/** What the trader receives to quote its asks with. */
const TRADER_INVENTORY_USD = 200;
/**
 * A market order of the counterparty reaches this far from the reference price: past the bot's
 * quotes (at most 1.2 % away), short of the counterparty's own resting offers (2 % away).
 */
const TAKER_REACH = 0.016;
const MAX_BODY_BYTES = 1_024;
const SUCCESS = "tesSUCCESS";

export interface DexContext {
  nodeUrl: string;
  /** The faucet: funds a new account from the genesis account, returns the hash. */
  fund: (destination: string) => Promise<string>;
}

interface Wallet {
  seed: string;
  address: string;
}

interface MarketState {
  market: Market;
  issuer: Wallet;
  counterparty: Wallet;
}

function newWallet(): Wallet {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  return { seed, address: addressOfSeed(seed) };
}

async function withConnection<T>(
  context: DexContext,
  job: (connection: Connection) => Promise<T>,
): Promise<T> {
  const node = await NodeClient.connect(context.nodeUrl);
  try {
    return await job({ node, defs: await loadDefinitions(node) });
  } finally {
    node.close();
  }
}

/**
 * Signs transactions of one account with consecutive Sequences, submits them in that order and
 * waits for all of them: one validation for the lot. Returns their results, in order.
 */
async function submitAll(
  { node, defs }: Connection,
  signer: Wallet,
  txs: readonly TxJson[],
): Promise<string[]> {
  const signed: TxJson[] = [];
  for (const [index, tx] of txs.entries()) {
    const filled = await autofill(node, defs, { ...tx, Account: signer.address });
    const sequence = filled["Sequence"];
    if (typeof sequence !== "number") throw new Error("autofill returned no Sequence");
    signed.push(signWithSeed(defs, { ...filled, Sequence: sequence + index }, signer.seed));
  }
  const submitted = await Promise.all(signed.map((tx) => submitAndWait(node, defs, tx)));
  return submitted.map(({ result }) => result);
}

async function submitAllOrThrow(
  connection: Connection,
  signer: Wallet,
  txs: readonly TxJson[],
  step: string,
): Promise<void> {
  const results = await submitAll(connection, signer, txs);
  const failed = results.find((result) => result !== SUCCESS);
  if (failed !== undefined) throw new Error(`dex market: ${step} failed (${failed})`);
}

function counterpartyQuotes(): Quote[] {
  return COUNTERPARTY_SPREADS.flatMap((spread): Quote[] => [
    { side: "bid", priceUsd: REFERENCE_PRICE_USD * (1 - spread), sizeXrp: COUNTERPARTY_QUOTE_XRP },
    { side: "ask", priceUsd: REFERENCE_PRICE_USD * (1 + spread), sizeXrp: COUNTERPARTY_QUOTE_XRP },
  ]);
}

async function createMarket(connection: Connection, context: DexContext): Promise<MarketState> {
  const issuer = newWallet();
  const counterparty = newWallet();
  const market: Market = {
    issuer: issuer.address,
    currency: QUOTE_CURRENCY,
    counterparty: counterparty.address,
  };
  // One after the other: both payments come from the genesis account's Sequence.
  await context.fund(issuer.address);
  await context.fund(counterparty.address);
  // DefaultRipple before any trust line: a line created later inherits it on the issuer's side.
  await submitAllOrThrow(
    connection,
    issuer,
    [{ TransactionType: "AccountSet", SetFlag: ASF_DEFAULT_RIPPLE }],
    "DefaultRipple",
  );
  await submitAllOrThrow(
    connection,
    counterparty,
    [{ TransactionType: "TrustSet", LimitAmount: usdAmount(market, COUNTERPARTY_TRUST_LIMIT_USD) }],
    "counterparty trust line",
  );
  await submitAllOrThrow(
    connection,
    issuer,
    [
      {
        TransactionType: "Payment",
        Destination: counterparty.address,
        Amount: usdAmount(market, COUNTERPARTY_USD),
      },
    ],
    "counterparty USD",
  );
  await submitAllOrThrow(
    connection,
    counterparty,
    counterpartyQuotes().map((quote) => offerCreateTx(counterparty.address, market, quote)),
    "counterparty offers",
  );
  console.log(`dex: market ready, ${QUOTE_CURRENCY} issued by ${issuer.address}`);
  return { market, issuer, counterparty };
}

export class DexMarket {
  private readonly context: DexContext;
  private state: MarketState | undefined;
  /** One market operation at a time: they share the accounts' Sequences. */
  private queue: Promise<void> = Promise.resolve();

  constructor(context: DexContext) {
    this.context = context;
  }

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    // The next job waits for this one whatever its outcome; its caller gets the error via `run`.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** The market, created on the first call and again when the node was reset. */
  private async ready(connection: Connection): Promise<MarketState> {
    const current = this.state;
    if (
      current !== undefined &&
      (await accountInfo(connection.node, current.issuer.address)) !== undefined
    )
      return current;
    this.state = await createMarket(connection, this.context);
    return this.state;
  }

  market(): Promise<Market> {
    return this.serialized(() =>
      withConnection(this.context, async (connection) => (await this.ready(connection)).market),
    );
  }

  /** The issuer sends USD inventory; tecPATH_DRY while the destination has no trust line. */
  inventory(destination: string): Promise<string> {
    return this.serialized(() =>
      withConnection(this.context, async (connection) => {
        const { market, issuer } = await this.ready(connection);
        const [result] = await submitAll(connection, issuer, [
          {
            TransactionType: "Payment",
            Destination: destination,
            Amount: usdAmount(market, TRADER_INVENTORY_USD),
          },
        ]);
        return result ?? "no result";
      }),
    );
  }

  /**
   * A market order of the counterparty: immediate or cancel, so it never rests on the book.
   * Both sides carry tfSell (spend all of TakerGets): without it, a fully funded IOC bid is
   * killed by the legacy offer crossing of a node without FlowCross/fixFillOrKill, even when the
   * bot's asks cross it. A buy may thus receive slightly more than TAKER_SIZE_XRP.
   */
  take(side: TakerSide): Promise<string> {
    return this.serialized(() =>
      withConnection(this.context, async (connection) => {
        const { market, counterparty } = await this.ready(connection);
        const order =
          side === "buy"
            ? offerCreateTx(
                counterparty.address,
                market,
                {
                  side: "bid",
                  priceUsd: REFERENCE_PRICE_USD * (1 + TAKER_REACH),
                  sizeXrp: TAKER_SIZE_XRP,
                },
                { flags: TF_IMMEDIATE_OR_CANCEL | TF_SELL },
              )
            : offerCreateTx(
                counterparty.address,
                market,
                {
                  side: "ask",
                  priceUsd: REFERENCE_PRICE_USD * (1 - TAKER_REACH),
                  sizeXrp: TAKER_SIZE_XRP,
                },
                { flags: TF_IMMEDIATE_OR_CANCEL | TF_SELL },
              );
        const [result] = await submitAll(connection, counterparty, [order]);
        return result ?? "no result";
      }),
    );
  }
}

function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new DexValidationError("request body too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new DexValidationError("the body is not valid JSON");
    throw error;
  }
}

async function route(
  dex: DexMarket,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<void> {
  switch (path) {
    case DEX_MARKET_PATH:
      replyJson(res, 200, await dex.market());
      return;
    case DEX_INVENTORY_PATH: {
      const destination = parseInventoryRequest(await readJson(req));
      const result = await dex.inventory(destination);
      if (result !== SUCCESS) {
        replyJson(res, 409, { error: `the issuer could not pay ${destination}: ${result}` });
        return;
      }
      const body: InventoryReply = { destination, usd: String(TRADER_INVENTORY_USD) };
      replyJson(res, 200, body);
      return;
    }
    case DEX_TAKER_PATH: {
      const side = parseTakerRequest(await readJson(req));
      const body: TakerReply = { side, result: await dex.take(side) };
      replyJson(res, 200, body);
      return;
    }
    default:
      replyJson(res, 404, { error: "not found" });
  }
}

let shared: DexMarket | undefined;

/** Every /api/dex/ request (server.ts routes the prefix here). */
export async function handleDex(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  context: DexContext,
): Promise<void> {
  if (req.method !== "POST") {
    replyJson(res, 405, { error: "method not allowed" });
    return;
  }
  shared ??= new DexMarket(context);
  try {
    await route(shared, req, res, path);
  } catch (error) {
    if (!(error instanceof DexValidationError)) throw error;
    replyJson(res, 400, { error: error.message });
  }
}
