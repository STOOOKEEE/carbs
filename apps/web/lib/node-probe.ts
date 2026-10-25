/**
 * The Connect button of the node dialog: asks a node for its definitions (it must serve the
 * SigningSessions names, as the page load will check) and its last validated ledger, then
 * hangs up. Nothing is signed or submitted.
 */
import { WebSocketClient, loadDefinitions, type NodeClient } from "@carbs/sessions";
import { NODE_TIMEOUT_MS, withTimeout } from "./timeout";

export type ProbeResult = { ok: true; ledgerIndex: number } | { ok: false; reason: string };

/** A client the probe can hang up on once it has its answer. */
export type ProbeClient = NodeClient & { close?: () => void };

export interface ProbeOptions {
  clientFactory?: (url: string) => ProbeClient;
  timeoutMs?: number;
}

function ledgerIndexOf(answer: unknown): number {
  const ledger =
    typeof answer === "object" && answer !== null ? Reflect.get(answer, "ledger") : undefined;
  const raw =
    typeof ledger === "object" && ledger !== null ? Reflect.get(ledger, "ledger_index") : undefined;
  const index = Number(raw);
  if (!Number.isInteger(index)) throw new Error("the node answered without a ledger index");
  return index;
}

export async function probeNode(url: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const client = (options.clientFactory ?? ((target: string) => new WebSocketClient(target)))(url);
  try {
    const ledgerIndex = await withTimeout(
      (async () => {
        await loadDefinitions(client, { requireSessions: true });
        return ledgerIndexOf(await client.request("ledger", { ledger_index: "validated" }));
      })(),
      options.timeoutMs ?? NODE_TIMEOUT_MS,
      url,
    );
    return { ok: true, ledgerIndex };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    client.close?.();
  }
}
