// @vitest-environment node
import {
  generateClassicSeed,
  classicSignerFromSeed,
  decodeTx,
  addressFromPublicKey,
} from "@carbs/sessions";
import { alphanetDefinitions, alphanetServerDefinitions } from "@carbs/sessions/testing";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { childEnv } from "./child-env.js";
import { localConfig, portsOf } from "./config.js";
import { createFaucetServer, fund, parseDestination } from "./faucet.js";

const CFG = `[server]
port_ws_public
port_ws_admin_local

[port_ws_public]
port = 6006
ip = 0.0.0.0
protocol = ws

[port_ws_admin_local]
port = 6007
ip = 0.0.0.0
admin = 127.0.0.1, 172.16.0.0/12
protocol = ws

[database_path]
/var/lib/xrpld/db

[debug_logfile]
/var/lib/xrpld/debug.log
`;

describe("local configuration", () => {
  it("moves the data under the temporary directory and listens on the loopback only", () => {
    const local = localConfig(CFG, "/tmp/x");
    expect(local).not.toContain("/var/lib/xrpld");
    expect(local).toContain("/tmp/x/db");
    expect(local).not.toContain("0.0.0.0");
    expect(local).not.toContain("172.16.0.0/12");
    expect(local).toContain("admin = 127.0.0.1\n");
  });

  it("reads the ports from the file", () => {
    expect(portsOf(CFG)).toEqual({ publicWs: 6006, adminWs: 6007 });
    expect(() => portsOf("[server]\n")).toThrow(/no port/);
  });
});

describe("child processes", () => {
  it("never receive the genesis seed, whatever the parent or the caller passes", () => {
    const env = childEnv(
      { GENESIS_SEED: "sSecret", PATH: "/bin", HOME: "/h" },
      { NUXT_PUBLIC_BACKEND: "live", GENESIS_SEED: "sAgain" },
    );
    expect(env).toEqual({ PATH: "/bin", HOME: "/h", NUXT_PUBLIC_BACKEND: "live" });
    expect(Object.keys(env)).not.toContain("GENESIS_SEED");
  });
});

describe("destination", () => {
  it("accepts a classic address only", () => {
    expect(parseDestination('{"destination":"rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"}')).toBe(
      "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    );
    for (const body of ["", "{}", '{"destination":5}', '{"destination":"xyz"}', "not json", "[]"]) {
      expect(parseDestination(body), body).toBeUndefined();
    }
  });
});

/** A node that answers the few methods the faucet uses and keeps the blob it was given. */
function nodeDouble() {
  return {
    client: {
      async request(method: string): Promise<unknown> {
        switch (method) {
          case "server_definitions":
            return structuredClone(alphanetServerDefinitions());
          case "account_info":
            return {
              account_data: { Account: "r", Flags: 0, Sequence: 7, Balance: "1", OwnerCount: 0 },
            };
          case "server_info":
            return { info: { network_id: 0 } };
          case "fee":
            return { drops: { base_fee: "10" }, ledger_current_index: 500 };
          case "submit":
            return {
              engine_result: "tesSUCCESS",
              engine_result_code: 0,
              engine_result_message: "",
              accepted: true,
              tx_json: { hash: "AB" },
            };
        }
        throw new Error(`unexpected ${method}`);
      },
    },
  };
}

describe("dev faucet", () => {
  const genesis = classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1"));
  const destination = addressFromPublicKey(
    classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1")).publicKey,
  );

  it("funds with tesSUCCESS when the node accepts the payment", async () => {
    const funded = await fund({ client: nodeDouble().client, genesis }, destination);
    expect(funded.result).toBe("tesSUCCESS");
    expect(funded.hash).toBeDefined();
  });

  it("answers over HTTP only to the page's own origins, and says no to everything else", async () => {
    const node = nodeDouble();
    const blobs: string[] = [];
    const client = {
      async request(method: string, params: Record<string, unknown>) {
        if (method === "submit") blobs.push(String(params["tx_blob"]));
        return node.client.request(method);
      },
    };
    const server = createFaucetServer({ client, genesis }, ["http://localhost:3000"]);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (headers: Record<string, string>, body: string, path = "/accounts") =>
        fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
        });

      const ok = await post({ origin: "http://localhost:3000" }, JSON.stringify({ destination }));
      expect(ok.status).toBe(200);
      expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      const tx = decodeTx(blobs[0] ?? "", alphanetDefinitions());
      expect(tx["TransactionType"]).toBe("Payment");
      expect(tx["Destination"]).toBe(destination);
      expect(tx["Amount"]).toBe("100000000");
      expect(tx["Account"]).toBe(addressFromPublicKey(genesis.publicKey));

      const preflight = await fetch(`${base}/accounts`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000" },
      });
      expect(preflight.status).toBe(204);
      expect(
        (await post({ origin: "https://evil.example" }, JSON.stringify({ destination }))).status,
      ).toBe(403);
      expect((await post({}, JSON.stringify({ destination }))).status).toBe(403);
      expect((await post({ origin: "http://localhost:3000" }, "{}")).status).toBe(400);
      expect(
        (await post({ origin: "http://localhost:3000" }, JSON.stringify({ destination }), "/other"))
          .status,
      ).toBe(404);
      expect(blobs).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it("caps how many accounts one origin can fund per window (429 above the cap)", async () => {
    let now = 1_000_000;
    let submits = 0;
    const node = nodeDouble();
    const client = {
      async request(method: string) {
        if (method === "submit") submits += 1;
        return node.client.request(method);
      },
    };
    const origins = ["http://localhost:3000", "http://127.0.0.1:3000"];
    const server = createFaucetServer({ client, genesis }, origins, {
      perWindow: 2,
      windowMs: 60_000,
      now: () => now,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const post = (origin: string) =>
        fetch(`${base}/accounts`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ destination }),
        });
      expect((await post(origins[0] ?? "")).status).toBe(200);
      expect((await post(origins[0] ?? "")).status).toBe(200);
      const refused = await post(origins[0] ?? "");
      expect(refused.status).toBe(429);
      expect(refused.headers.get("retry-after")).toBe("60");
      expect(submits).toBe(2);
      // Another origin has its own budget; the first gets its budget back after the window.
      expect((await post(origins[1] ?? "")).status).toBe(200);
      now += 60_001;
      expect((await post(origins[0] ?? "")).status).toBe(200);
      expect(submits).toBe(4);
    } finally {
      server.close();
    }
  });
});
