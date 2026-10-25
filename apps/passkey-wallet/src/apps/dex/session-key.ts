// The trading session's key: generated in the page, kept in memory only, it signs the owner's
// transactions alone (no prompt). Its submissions go one at a time, since they share the owner's
// Sequence; the session's entry on the ledger gives the count, the cap and the Expiration.

import { generateSeed } from "ripple-keypairs";

import type { Connection } from "../../account.ts";
import {
  type TxJson,
  addressOfSeed,
  autofill,
  read,
  signWithSeed,
  submitAndWait,
} from "../../ledger.ts";
import { RpcError } from "../../rpc.ts";

const DROPS_PER_XRP = 1_000_000;

export interface SessionKey {
  seed: string;
  address: string;
}

export interface SessionTxResult {
  hash: string;
  result: string;
  /** Sequence of the transaction: an OfferCreate's offer is known by it. */
  sequence: number;
}

/** The SigningSession entry as the ledger holds it. */
export interface SessionEntry {
  txCount: number;
  maxTxCount: number | undefined;
  spentXrp: number;
  capXrp: number | undefined;
  /** Seconds since the XRPL epoch. */
  expiration: number | undefined;
}

export function newSessionKey(): SessionKey {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  return { seed, address: addressOfSeed(seed) };
}

function numberField(node: unknown, name: string): number | undefined {
  const value = read(node, [name]);
  return typeof value === "number" ? value : undefined;
}

function xrpField(node: unknown, name: string): number | undefined {
  const value = read(node, [name]);
  return typeof value === "string" && /^\d+$/.test(value)
    ? Number(value) / DROPS_PER_XRP
    : undefined;
}

/** The session's entry; undefined once it is gone (closed, or deleted once expired). */
export async function readSessionEntry(
  { node }: Connection,
  owner: string,
  key: string,
): Promise<SessionEntry | undefined> {
  let answer: unknown;
  try {
    answer = await node.request("ledger_entry", {
      signing_session: { account: owner, session_key: key },
      ledger_index: "current",
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const entry = read(answer, ["node"]);
  if (entry === undefined) return undefined;
  return {
    txCount: numberField(entry, "SessionTxCount") ?? 0,
    maxTxCount: numberField(entry, "SessionMaxTxCount"),
    spentXrp: xrpField(entry, "SessionSpent") ?? 0,
    capXrp: xrpField(entry, "SessionCap"),
    expiration: numberField(entry, "Expiration"),
  };
}

/** Signs transactions of `owner` with the session key, one submission at a time. */
export class SessionSigner {
  readonly owner: string;
  readonly key: SessionKey;
  private readonly connection: Connection;
  private queue: Promise<void> = Promise.resolve();

  constructor(connection: Connection, owner: string, key: SessionKey) {
    this.connection = connection;
    this.owner = owner;
    this.key = key;
  }

  submit(tx: TxJson): Promise<SessionTxResult> {
    const run = this.queue.then(() => this.signAndSubmit(tx));
    // The next submission waits for this one whatever its outcome; the caller gets the error.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async signAndSubmit(tx: TxJson): Promise<SessionTxResult> {
    const { node, defs } = this.connection;
    const filled = await autofill(node, defs, { ...tx, Account: this.owner });
    const sequence = filled["Sequence"];
    if (typeof sequence !== "number") throw new Error("autofill returned no Sequence");
    const submitted = await submitAndWait(node, defs, signWithSeed(defs, filled, this.key.seed));
    return { ...submitted, sequence };
  }
}
