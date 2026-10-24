import { JsonRpcClient } from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import { createLiveClients, simpleRequestFetch } from "./clients";
import { NETWORKS } from "../networks";

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

describe("live clients", () => {
  it("make one client per node and cache definitions, without caching a failure", async () => {
    const urls: string[] = [];
    let failures = 1;
    const clients = createLiveClients(
      () => NETWORKS,
      (url) => {
        urls.push(url);
        return {
          async request() {
            if (failures-- > 0) throw new Error("down");
            return { not: "definitions" };
          },
        };
      },
    );
    expect(clients.client("alphanet")).toBe(clients.client("alphanet"));
    expect(clients.client("mainnet")).not.toBe(clients.client("alphanet"));
    expect(urls).toEqual(["https://rpc.alphanet.xrpl.org", "https://xrplcluster.com"]);
    await expect(clients.definitions("alphanet")).rejects.toThrow("down");
    // The failure is forgotten: the next call asks the node again.
    await expect(clients.definitions("alphanet")).rejects.toThrow(
      /server_definitions|definitions/i,
    );
  });
});
