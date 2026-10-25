// The game's SigningSession entry as the open ledger holds it: what the next shot is checked
// against (spent / cap, max per payment, tx count / max tx count, expiration).

import type { Connection } from "../../account.ts";
import { read } from "../../ledger.ts";
import { RpcError } from "../../rpc.ts";
import { dropsToXrp } from "./rules.ts";

export interface GameSessionState {
  spentXrp: number;
  capXrp: number | undefined;
  maxPerTxXrp: number | undefined;
  /** Session-signed transactions applied so far (SessionTxCount, 0 until the first one). */
  txCount: number;
  maxTxCount: number | undefined;
  /** Seconds since the XRPL epoch. */
  expiration: number | undefined;
}

function xrpField(node: unknown, name: string): number | undefined {
  const drops = read(node, [name]);
  return typeof drops === "string" && /^\d+$/.test(drops) ? dropsToXrp(drops) : undefined;
}

function numberField(node: unknown, name: string): number | undefined {
  const value = read(node, [name]);
  return typeof value === "number" ? value : undefined;
}

/** undefined once the entry is gone (closed, or deleted after expiry). */
export async function readGameSession(
  connection: Connection,
  owner: string,
  sessionKey: string,
): Promise<GameSessionState | undefined> {
  let entry: unknown;
  try {
    entry = await connection.node.request("ledger_entry", {
      signing_session: { account: owner, session_key: sessionKey },
      ledger_index: "current",
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const node = read(entry, ["node"]);
  if (node === undefined) return undefined;
  return {
    spentXrp: xrpField(node, "SessionSpent") ?? 0,
    capXrp: xrpField(node, "SessionCap"),
    maxPerTxXrp: xrpField(node, "SessionMaxPerTx"),
    txCount: numberField(node, "SessionTxCount") ?? 0,
    maxTxCount: numberField(node, "SessionMaxTxCount"),
    expiration: numberField(node, "Expiration"),
  };
}
