// Transactions on the carbs node: binary encoding with the node's own definitions,
// autofill, submit, and waiting for validation. Shared by the browser and the faucet.

import { XrplDefinitions, encode, encodeForSigning } from "ripple-binary-codec";
import type { DefinitionsData } from "ripple-binary-codec/dist/enums/xrpl-definitions-base";
import { deriveAddress, deriveKeypair, sign } from "ripple-keypairs";

import { type NodeClient, RpcError, type RpcResult } from "./rpc.ts";

/** How many ledgers a transaction may wait before it expires (LastLedgerSequence). */
const LEDGER_WINDOW = 20;
/** Interval between two `tx` lookups while waiting for validation. */
const POLL_INTERVAL_MS = 1_000;
/** Give up waiting after this long: the closer closes a ledger every 3 s. */
const VALIDATION_TIMEOUT_MS = 60_000;
const DEFINITIONS_SECTIONS = [
  "TYPES",
  "FIELDS",
  "LEDGER_ENTRY_TYPES",
  "TRANSACTION_RESULTS",
  "TRANSACTION_TYPES",
];

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type TxJson = { [key: string]: JsonValue };

export interface SubmittedTx {
  hash: string;
  result: string;
}

/** Reads a nested member of a node answer; undefined when any step is missing. */
export function read(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Reflect.get(current, key);
  }
  return current;
}

function readNumber(value: unknown, path: string[]): number {
  const found = read(value, path);
  if (typeof found === "number") return found;
  if (typeof found === "string" && /^\d+$/.test(found)) return Number(found);
  throw new Error(`unexpected node answer: ${path.join(".")} is missing`);
}

function isDefinitionsData(value: unknown): value is DefinitionsData {
  return DEFINITIONS_SECTIONS.every((section) => typeof read(value, [section]) === "object");
}

export async function loadDefinitions(node: NodeClient): Promise<XrplDefinitions> {
  const answer = await node.request("server_definitions");
  if (!isDefinitionsData(answer)) throw new Error("server_definitions answer is incomplete");
  return new XrplDefinitions(answer);
}

/** account_info of the current ledger; undefined only when the account does not exist yet. */
export async function accountInfo(
  node: NodeClient,
  address: string,
): Promise<RpcResult | undefined> {
  try {
    return await node.request("account_info", { account: address, ledger_index: "current" });
  } catch (error) {
    if (error instanceof RpcError && error.code === "actNotFound") return undefined;
    throw error;
  }
}

/** Sequence, Fee (the open ledger fee) and LastLedgerSequence. */
export async function autofill(
  node: NodeClient,
  defs: XrplDefinitions,
  tx: TxJson,
): Promise<TxJson> {
  const account = tx["Account"];
  if (typeof account !== "string") throw new Error("the transaction has no Account");
  const info = await node.request("account_info", { account, ledger_index: "current" });
  const current = await node.request("ledger_current");
  const filled: TxJson = {
    ...tx,
    Sequence: readNumber(info, ["account_data", "Sequence"]),
    LastLedgerSequence: readNumber(current, ["ledger_current_index"]) + LEDGER_WINDOW,
  };
  const fee = await node.request("fee", { tx_blob: encode(filled, defs) });
  return { ...filled, Fee: String(readNumber(fee, ["drops", "open_ledger_fee"])) };
}

/** Signs with a classical key derived from a family seed (the account's master key). */
export function signWithSeed(defs: XrplDefinitions, tx: TxJson, seed: string): TxJson {
  const keys = deriveKeypair(seed);
  const unsigned: TxJson = { ...tx, SigningPubKey: keys.publicKey };
  return { ...unsigned, TxnSignature: sign(encodeForSigning(unsigned, defs), keys.privateKey) };
}

export function addressOfSeed(seed: string): string {
  return deriveAddress(deriveKeypair(seed).publicKey);
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Submits a signed transaction and waits until a validated ledger holds it. */
export async function submitAndWait(
  node: NodeClient,
  defs: XrplDefinitions,
  tx: TxJson,
): Promise<SubmittedTx> {
  const answer = await node.request("submit", { tx_blob: encode(tx, defs) });
  const engineResult = String(read(answer, ["engine_result"]));
  const hash = read(answer, ["tx_json", "hash"]);
  if (typeof hash !== "string") throw new Error(`submit returned no hash (${engineResult})`);
  if (!engineResult.startsWith("tes") && !engineResult.startsWith("ter")) {
    return { hash, result: engineResult };
  }
  const deadline = Date.now() + VALIDATION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    try {
      const found = await node.request("tx", { transaction: hash });
      const result = read(found, ["meta", "TransactionResult"]);
      if (read(found, ["validated"]) === true && typeof result === "string")
        return { hash, result };
    } catch (error) {
      if (!(error instanceof RpcError && error.code === "txnNotFound")) throw error;
    }
  }
  throw new Error(`transaction ${hash} not validated after ${VALIDATION_TIMEOUT_MS / 1000} s`);
}
