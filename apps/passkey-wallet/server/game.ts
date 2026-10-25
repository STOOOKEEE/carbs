// The house of Hash Blaster (game.html): an account created and funded by the faucet on first
// use, that receives the shots and pays a reward for each hit. A claim is checked on the
// ledger (validated shot to the house, at the target's price) and paid once; the roll uses
// the validating ledger's hash (src/apps/game/rules.ts), so the page cannot pick the outcome.
// House payments are serialized (one account, one Sequence) and not waited for.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { XrplDefinitions } from "ripple-binary-codec";
import { generateSeed } from "ripple-keypairs";

import {
  type TxJson,
  addressOfSeed,
  autofill,
  loadDefinitions,
  read,
  signWithSeed,
} from "../src/ledger.ts";
import { NodeClient, RpcError } from "../src/rpc.ts";
import {
  CLAIM_PATH,
  type ClaimAnswer,
  HOUSE_PATH,
  type HouseAnswer,
} from "../src/apps/game/protocol.ts";
import { isHit, targetOfTag, xrpToDrops } from "../src/apps/game/rules.ts";
import { isAccepted, submitOnly, validatedLedger } from "../src/apps/game/xrpl.ts";

export interface GameConfig {
  nodeUrl: string;
  /** The server's faucet (genesis): funds an address, throws unless tesSUCCESS. */
  fund: (destination: string) => Promise<string>;
}

const CLAIM_MAX_BODY_BYTES = 1_024;
/** A node answer slower than this counts as a lost connection (the next call reconnects). */
const NODE_TIMEOUT_MS = 15_000;
const TX_HASH_PATTERN = /^[0-9A-F]{64}$/;
const SUCCESS = "tesSUCCESS";

interface Connection {
  node: NodeClient;
  defs: XrplDefinitions;
}

interface House {
  seed: string;
  address: string;
}

/** A refused claim: answered 400 with its reason. */
class ClaimError extends Error {}

let connecting: Promise<Connection> | undefined;
let houseReady: Promise<House> | undefined;
/** One answer per shot hash: a second claim of the same shot gets the first answer. */
const claims = new Map<string, Promise<ClaimAnswer>>();
/** The tail of the house's payment queue. */
let housePayments: Promise<unknown> = Promise.resolve();

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const { promise: timedOut, reject } = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => reject(new Error(`no answer from the node after ${NODE_TIMEOUT_MS / 1_000} s`)),
    NODE_TIMEOUT_MS,
  );
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timer));
}

/** The shared node connection; dropped after any failure so that the next call reconnects. */
async function onNode<T>(
  config: GameConfig,
  action: (connection: Connection) => Promise<T>,
): Promise<T> {
  connecting ??= NodeClient.connect(config.nodeUrl).then(async (node) => ({
    node,
    defs: await loadDefinitions(node),
  }));
  const pending = connecting;
  try {
    return await withTimeout(pending.then(action));
  } catch (error) {
    if (connecting === pending && !(error instanceof ClaimError)) {
      connecting = undefined;
      // A connection that never opened has nothing to close: its error is the one thrown below.
      pending.then(
        ({ node }) => node.close(),
        () => undefined,
      );
    }
    throw error;
  }
}

async function createHouse(config: GameConfig): Promise<House> {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const address = addressOfSeed(seed);
  const hash = await config.fund(address);
  console.log(`game: house ${address} funded by the faucet (${hash})`);
  return { seed, address };
}

function house(config: GameConfig): Promise<House> {
  houseReady ??= createHouse(config).catch((error: unknown) => {
    houseReady = undefined;
    throw error;
  });
  return houseReady;
}

/** A payment of the house, after the previous ones: autofill reads the open ledger's Sequence. */
function payFromHouse(config: GameConfig, from: House, tx: TxJson): Promise<string> {
  const payment = housePayments.then(() =>
    onNode(config, async ({ node, defs }) => {
      const filled = await autofill(node, defs, { ...tx, Account: from.address });
      const { hash, result } = await submitOnly(node, defs, signWithSeed(defs, filled, from.seed));
      if (!isAccepted(result)) throw new Error(`house payment refused: ${result}`);
      return hash;
    }),
  );
  // The queue goes on after a failed payment; its error still reaches this payment's caller.
  housePayments = payment.catch(() => undefined);
  return payment;
}

/** The shot as the ledger validated it; a ClaimError when it is not a paid shot at the house. */
async function checkClaim(config: GameConfig, from: House, hash: string): Promise<ClaimAnswer> {
  const shot = await onNode(config, async ({ node }) => {
    try {
      return await node.request("tx", { transaction: hash });
    } catch (error) {
      if (error instanceof RpcError && error.code === "txnNotFound")
        throw new ClaimError("unknown transaction");
      throw error;
    }
  });
  // API v1 puts the fields at the top, v2 under tx_json.
  const field = (name: string): unknown => read(shot, [name]) ?? read(shot, ["tx_json", name]);
  if (read(shot, ["validated"]) !== true) throw new ClaimError("the shot is not validated yet");
  if (read(shot, ["meta", "TransactionResult"]) !== SUCCESS)
    throw new ClaimError("the shot did not succeed");
  const player = field("Account");
  const tag = field("DestinationTag");
  const ledgerIndex = read(shot, ["ledger_index"]);
  const target = typeof tag === "number" ? targetOfTag(tag) : undefined;
  if (field("TransactionType") !== "Payment" || field("Destination") !== from.address)
    throw new ClaimError("not a payment to the house");
  if (target === undefined) throw new ClaimError("no target for this DestinationTag");
  if (read(shot, ["meta", "delivered_amount"]) !== xrpToDrops(target.priceXrp))
    throw new ClaimError(`a ${target.label} shot costs ${target.priceXrp} XRP`);
  if (typeof player !== "string" || typeof ledgerIndex !== "number")
    throw new ClaimError("unexpected transaction shape");

  const ledger = await onNode(config, ({ node }) => validatedLedger(node, ledgerIndex));
  if (!(await isHit(hash, ledger.hash, target))) return { hit: false };
  const rewardHash = await payFromHouse(config, from, {
    TransactionType: "Payment",
    Destination: player,
    Amount: xrpToDrops(target.rewardXrp),
  });
  console.log(`game: ${target.label} hit by ${player}, ${target.rewardXrp} XRP (${rewardHash})`);
  return { hit: true, rewardXrp: target.rewardXrp, rewardHash };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > CLAIM_MAX_BODY_BYTES) throw new ClaimError("request body too large");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new ClaimError("the body is not valid JSON");
    throw error;
  }
}

async function claim(config: GameConfig, req: IncomingMessage): Promise<ClaimAnswer> {
  const body = await readJson(req);
  const hash = typeof body === "object" && body !== null ? Reflect.get(body, "hash") : undefined;
  if (typeof hash !== "string" || !TX_HASH_PATTERN.test(hash))
    throw new ClaimError("hash must be a transaction hash (64 upper-case hex)");
  const known = claims.get(hash);
  if (known !== undefined) return known;
  const checking = house(config).then((from) => checkClaim(config, from, hash));
  claims.set(hash, checking);
  // A refused or failed check may be claimed again (e.g. not validated yet).
  checking.catch(() => claims.delete(hash));
  return checking;
}

function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function handleGame(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  config: GameConfig,
): Promise<void> {
  try {
    if (req.method === "GET" && path === HOUSE_PATH) {
      const answer: HouseAnswer = { address: (await house(config)).address };
      replyJson(res, 200, answer);
    } else if (req.method === "POST" && path === CLAIM_PATH) {
      replyJson(res, 200, await claim(config, req));
    } else {
      replyJson(res, 404, { error: "not found" });
    }
  } catch (error) {
    if (!(error instanceof ClaimError)) throw error;
    replyJson(res, 400, { error: error.message });
  }
}
