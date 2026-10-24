import { JsonRpcClient, RpcError } from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import {
  MAX_RATE_LIMIT_RETRIES,
  retryDelayMs,
  simpleRequestFetch,
  withRateLimitRetry,
} from "./clients";

function flaky(
  failures: number,
  error = new RpcError("account_tx", "tooBusy", "rate limit: retry in ~7042ms"),
) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async request() {
      calls += 1;
      if (calls <= failures) throw error;
      return { ok: true };
    },
  };
}

describe("rate-limit retry", () => {
  it("waits as long as the node asks, then succeeds", async () => {
    const inner = flaky(2);
    const waits: number[] = [];
    const client = withRateLimitRetry(inner, async (ms) => void waits.push(ms));
    await expect(client.request("account_tx", {})).resolves.toEqual({ ok: true });
    expect(waits).toEqual([7292, 7292]);
    expect(inner.calls).toBe(3);
  });

  it("gives up after a bounded number of tries and keeps the node's error", async () => {
    const inner = flaky(100);
    const client = withRateLimitRetry(inner, async () => undefined);
    await expect(client.request("account_tx", {})).rejects.toThrow(/tooBusy/);
    expect(inner.calls).toBe(MAX_RATE_LIMIT_RETRIES + 1);
  });

  it("does not retry other errors", async () => {
    const inner = flaky(1, new RpcError("account_info", "actNotFound", "Account not found."));
    const client = withRateLimitRetry(inner, async () => undefined);
    await expect(client.request("account_info", {})).rejects.toThrow(/actNotFound/);
    expect(inner.calls).toBe(1);
  });

  it("caps the delay and has a default when the node gives none", () => {
    expect(retryDelayMs(new RpcError("x", "slowDown", "rate limit exceeded"))).toBe(2250);
    expect(retryDelayMs(new RpcError("x", "tooBusy", "retry in ~99999ms"))).toBe(15000);
  });
});

describe("simple requests (no CORS preflight)", () => {
  it("sends the JSON-RPC body as text/plain so that the browser does not preflight", async () => {
    const seen: { type: string | undefined; body: unknown; method: string | undefined }[] = [];
    const base = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        type: (init?.headers as Record<string, string>)["content-type"],
        body: init?.body,
        method: init?.method,
      });
      return new Response(JSON.stringify({ result: { status: "success" } }));
    }) as typeof fetch;
    const client = new JsonRpcClient("https://node.example.org", simpleRequestFetch(base));
    await client.request("server_info", {});
    expect(seen).toHaveLength(1);
    expect(seen[0]?.type).toBe("text/plain");
    expect(seen[0]?.method).toBe("POST");
    expect(JSON.parse(String(seen[0]?.body))).toEqual({ method: "server_info", params: [{}] });
  });
});
