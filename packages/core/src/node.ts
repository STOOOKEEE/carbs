/**
 * Node client (FIANSO-SPEC.md section 8.2): JSON-RPC over HTTP or WebSocket on the node's public,
 * non-admin port. It never calls `sign`, `wallet_propose` or an admin method; the result code of a
 * transaction is the node's own.
 */

import {
  kLastLedgerSequenceOffset,
  kNetworkIdRequiredAbove,
  kValidationPollIntervalMs,
} from "./constants.js";
import { RpcError } from "./errors.js";
import type { TxCommonFields } from "./session.js";

/** Anything that answers a JSON-RPC method with its `result` object. */
export interface NodeClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Methods a client of this library may call (public, non-admin). */
const kAllowedMethods = new Set([
  "account_info",
  "account_objects",
  "account_tx",
  "fee",
  "ledger",
  "ledger_current",
  "ledger_entry",
  "server_definitions",
  "server_info",
  "submit",
  "tx",
]);

export class NodeClientError extends Error {
  override readonly name = "NodeClientError";
}

function assertAllowed(method: string): void {
  if (!kAllowedMethods.has(method)) {
    throw new NodeClientError(`method ${method} is not on the client's list of public methods`);
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap `{result: {...}}`, throwing the node's error for `status: "error"`. */
export function unwrapResult(method: string, answer: unknown): JsonObject {
  if (!isObject(answer) || !isObject(answer["result"])) {
    throw new NodeClientError(`${method}: malformed answer`);
  }
  const result = answer["result"];
  if (result["status"] === "error" || typeof result["error"] === "string") {
    throw new RpcError(
      method,
      String(result["error"] ?? "error"),
      String(result["error_message"] ?? ""),
    );
  }
  return result;
}

/** JSON-RPC over HTTP(S) with `fetch`. */
export class JsonRpcClient implements NodeClient {
  constructor(
    readonly url: string,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async request(method: string, params: JsonObject): Promise<unknown> {
    assertAllowed(method);
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, params: [params] }),
    });
    if (!response.ok) throw new NodeClientError(`${method}: HTTP ${response.status}`);
    return unwrapResult(method, await response.json());
  }
}

/** JSON-RPC over a WebSocket (the browser's or Node's global `WebSocket`). */
export class WebSocketClient implements NodeClient {
  #socket: WebSocket | undefined;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(readonly url: string) {}

  async #open(): Promise<WebSocket> {
    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) return this.#socket;
    const socket = new WebSocket(this.url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new NodeClientError(`cannot connect to ${this.url}`)),
        {
          once: true,
        },
      );
    });
    socket.addEventListener("message", (event) => {
      const message: unknown = JSON.parse(String(event.data));
      if (!isObject(message) || typeof message["id"] !== "number") return;
      const pending = this.#pending.get(message["id"]);
      if (!pending) return;
      this.#pending.delete(message["id"]);
      pending.resolve(message);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values())
        pending.reject(new NodeClientError("socket closed"));
      this.#pending.clear();
    });
    this.#socket = socket;
    return socket;
  }

  async request(method: string, params: JsonObject): Promise<unknown> {
    assertAllowed(method);
    const socket = await this.#open();
    const id = this.#nextId++;
    const answer = await new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, command: method, ...params }));
    });
    // A WebSocket answer carries `result` and `status` at the top level.
    if (isObject(answer) && answer["status"] === "error") {
      throw new RpcError(
        method,
        String(answer["error"] ?? "error"),
        String(answer["error_message"] ?? ""),
      );
    }
    return unwrapResult(method, answer);
  }

  close(): void {
    this.#socket?.close();
    this.#socket = undefined;
  }
}

function num(value: unknown, what: string): number {
  if (typeof value !== "number") throw new NodeClientError(`${what} is not a number`);
  return value;
}

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new NodeClientError(`${what} is not a string`);
  return value;
}

export interface AccountState {
  address: string;
  sequence: number;
  flags: number;
  balanceDrops: bigint;
  ownerCount: number;
  regularKey: string | undefined;
  /** The `account_data` object as the node returned it. */
  raw: JsonObject;
}

/** `account_info` of the current (open) ledger, or `undefined` when the account does not exist. */
export async function getAccountState(
  node: NodeClient,
  address: string,
  ledgerIndex: "current" | "validated" = "current",
): Promise<AccountState | undefined> {
  let result: unknown;
  try {
    result = await node.request("account_info", { account: address, ledger_index: ledgerIndex });
  } catch (error) {
    if (error instanceof RpcError && error.error === "actNotFound") return undefined;
    throw error;
  }
  if (!isObject(result) || !isObject(result["account_data"])) {
    throw new NodeClientError("account_info: no account_data");
  }
  const data = result["account_data"];
  return {
    address,
    sequence: num(data["Sequence"], "Sequence"),
    flags: num(data["Flags"], "Flags"),
    balanceDrops: BigInt(str(data["Balance"], "Balance")),
    ownerCount: num(data["OwnerCount"], "OwnerCount"),
    regularKey: typeof data["RegularKey"] === "string" ? data["RegularKey"] : undefined,
    raw: data,
  };
}

export interface NetworkState {
  networkId: number | undefined;
  /** Base fee in drops. */
  baseFeeDrops: bigint;
  currentLedger: number;
}

export async function getNetworkState(node: NodeClient): Promise<NetworkState> {
  const info = await node.request("server_info", {});
  const fee = await node.request("fee", {});
  if (!isObject(info) || !isObject(info["info"])) throw new NodeClientError("server_info: no info");
  if (!isObject(fee) || !isObject(fee["drops"])) throw new NodeClientError("fee: no drops");
  const networkId = info["info"]["network_id"];
  return {
    networkId: typeof networkId === "number" ? networkId : undefined,
    baseFeeDrops: BigInt(str(fee["drops"]["base_fee"], "base_fee")),
    currentLedger: num(fee["ledger_current_index"], "ledger_current_index"),
  };
}

export interface CommonFieldOptions {
  /** Ledgers ahead for `LastLedgerSequence` (default `kLastLedgerSequenceOffset`). */
  ledgerOffset?: number;
  /** Fee in drops (default: the base fee). */
  feeDrops?: bigint;
  /** The sequence to use (default: the account's next sequence). */
  sequence?: number;
}

/** `Sequence`, `Fee`, `LastLedgerSequence` and, on networks above id 1024, `NetworkID`. */
export async function fetchCommonFields(
  node: NodeClient,
  account: string,
  options: CommonFieldOptions = {},
): Promise<TxCommonFields> {
  const state = await getAccountState(node, account);
  if (!state) throw new NodeClientError(`account ${account} does not exist`);
  const network = await getNetworkState(node);
  const common: TxCommonFields = {
    Sequence: options.sequence ?? state.sequence,
    Fee: (options.feeDrops ?? network.baseFeeDrops).toString(),
    LastLedgerSequence: network.currentLedger + (options.ledgerOffset ?? kLastLedgerSequenceOffset),
  };
  if (network.networkId !== undefined && network.networkId > kNetworkIdRequiredAbove) {
    common.NetworkID = network.networkId;
  }
  return common;
}

export interface SubmitResult {
  engineResult: string;
  engineResultCode: number;
  engineResultMessage: string;
  hash: string | undefined;
  /** The node accepted the blob into its open ledger or queue. */
  accepted: boolean;
}

/** `submit` a signed blob (never the `sign` mode of `submit`). */
export async function submitBlob(node: NodeClient, blob: string): Promise<SubmitResult> {
  const result = await node.request("submit", { tx_blob: blob });
  if (!isObject(result)) throw new NodeClientError("submit: malformed result");
  const txJson = isObject(result["tx_json"]) ? result["tx_json"] : {};
  return {
    engineResult: str(result["engine_result"], "engine_result"),
    engineResultCode: num(result["engine_result_code"], "engine_result_code"),
    engineResultMessage: String(result["engine_result_message"] ?? ""),
    hash: typeof txJson["hash"] === "string" ? txJson["hash"] : undefined,
    accepted: result["accepted"] === true,
  };
}

export interface FinalResult {
  hash: string;
  /** The validated result, or the submit result when the transaction never validated. */
  result: string;
  validated: boolean;
  ledgerIndex: number | undefined;
  submit: SubmitResult;
}

export interface WaitOptions {
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Submit and wait until the transaction is validated or its `LastLedgerSequence` has passed. A `tef`,
 * `tem` or `tel` answer ends the wait at once: such a transaction is never included.
 */
export async function submitAndWait(
  node: NodeClient,
  blob: string,
  hash: string,
  lastLedgerSequence: number,
  options: WaitOptions = {},
): Promise<FinalResult> {
  const submit = await submitBlob(node, blob);
  const prefix = submit.engineResult.slice(0, 3);
  if (prefix === "tef" || prefix === "tem" || prefix === "tel") {
    return { hash, result: submit.engineResult, validated: false, ledgerIndex: undefined, submit };
  }
  const sleep = options.sleep ?? defaultSleep;
  const interval = options.pollIntervalMs ?? kValidationPollIntervalMs;
  for (;;) {
    try {
      const tx = await node.request("tx", { transaction: hash });
      if (isObject(tx) && tx["validated"] === true && isObject(tx["meta"])) {
        return {
          hash,
          result: str(tx["meta"]["TransactionResult"], "TransactionResult"),
          validated: true,
          ledgerIndex: typeof tx["ledger_index"] === "number" ? tx["ledger_index"] : undefined,
          submit,
        };
      }
    } catch (error) {
      if (!(error instanceof RpcError && error.error === "txnNotFound")) throw error;
    }
    const network = await getNetworkState(node);
    if (network.currentLedger > lastLedgerSequence + 1) {
      return {
        hash,
        result: submit.engineResult,
        validated: false,
        ledgerIndex: undefined,
        submit,
      };
    }
    await sleep(interval);
  }
}

/** A ledger entry by index, or `undefined` when it does not exist. */
export async function getLedgerEntry(
  node: NodeClient,
  index: string,
  ledgerIndex: "current" | "validated" = "validated",
): Promise<JsonObject | undefined> {
  try {
    const result = await node.request("ledger_entry", { index, ledger_index: ledgerIndex });
    if (!isObject(result) || !isObject(result["node"])) return undefined;
    return result["node"];
  } catch (error) {
    if (error instanceof RpcError && error.error === "entryNotFound") return undefined;
    throw error;
  }
}

/** Every page of `account_objects` of one type, bounded. */
export async function getAccountObjects(
  node: NodeClient,
  account: string,
  type?: string,
  pageLimit = 10,
): Promise<JsonObject[]> {
  const objects: JsonObject[] = [];
  let marker: unknown;
  for (let page = 0; page < pageLimit; page += 1) {
    const params: JsonObject = { account, ledger_index: "validated" };
    if (type !== undefined) params["type"] = type;
    if (marker !== undefined) params["marker"] = marker;
    const result = await node.request("account_objects", params);
    if (!isObject(result) || !Array.isArray(result["account_objects"])) {
      throw new NodeClientError("account_objects: malformed result");
    }
    for (const object of result["account_objects"]) if (isObject(object)) objects.push(object);
    marker = result["marker"];
    if (marker === undefined) return objects;
  }
  throw new NodeClientError(`account_objects: more than ${pageLimit} pages`);
}
