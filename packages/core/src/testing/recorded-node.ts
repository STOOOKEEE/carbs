/**
 * A node that replays recorded answers (tests and demos without a network), and a wrapper that
 * records the answers of a real node. A recording holds `result` objects exactly as the node sent
 * them; nothing in it is invented. Recordings made with this wrapper never hold a secret: the
 * client never sends one.
 */

import { RpcError } from "../errors.js";
import type { NodeClient } from "../node.js";

export interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: { error: string; error_message?: string };
}

/** Stable JSON of the parameters: keys sorted, so the order of a literal does not matter. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function callKey(method: string, params: Record<string, unknown>): string {
  return `${method} ${canonical(params)}`;
}

export class RecordedNodeMissError extends Error {
  override readonly name = "RecordedNodeMissError";
}

/** Replays `calls`; a call that was not recorded throws, so a test never reaches a network. */
export class RecordedNode implements NodeClient {
  readonly #answers = new Map<string, RecordedCall>();
  readonly requests: string[] = [];

  constructor(calls: readonly RecordedCall[]) {
    for (const call of calls) this.#answers.set(callKey(call.method, call.params), call);
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const key = callKey(method, params);
    this.requests.push(key);
    const call = this.#answers.get(key);
    if (!call) throw new RecordedNodeMissError(`not recorded: ${key}`);
    if (call.error) throw new RpcError(method, call.error.error, call.error.error_message ?? "");
    return structuredClone(call.result);
  }
}

/** Records every answer of `inner` (for spikes that produce fixtures). */
export class RecordingNode implements NodeClient {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly inner: NodeClient) {}

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      const result = await this.inner.request(method, params);
      this.calls.push({ method, params, result });
      return result;
    } catch (error) {
      if (error instanceof RpcError) {
        this.calls.push({
          method,
          params,
          error: { error: error.error, error_message: error.errorMessage },
        });
      }
      throw error;
    }
  }
}
