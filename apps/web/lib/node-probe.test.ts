import { describe, expect, it } from "vitest";
import { FakeAlphaNet } from "./live/fake-alphanet";
import { probeNode, type ProbeClient } from "./node-probe";
import { demoCommand } from "./node-setup";

describe("probing a node (the dialog's Connect)", () => {
  it("answers with the last validated ledger of a node that serves SigningSessions, then hangs up", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    let closed = false;
    const urls: string[] = [];
    const client: ProbeClient = {
      request: (method, params) => fake.request(method, params),
      close: () => {
        closed = true;
      },
    };
    const result = await probeNode("ws://localhost:6006", {
      clientFactory: (url) => {
        urls.push(url);
        return client;
      },
    });
    expect(result).toEqual({ ok: true, ledgerIndex: fake.ledger });
    expect(urls).toEqual(["ws://localhost:6006"]);
    expect(closed).toBe(true);
  });

  it("says that a node without the amendment does not serve SigningSessions", async () => {
    const fake = new FakeAlphaNet({ sessions: false });
    const result = await probeNode("ws://localhost:6006", { clientFactory: () => fake });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("does not serve SigningSessions");
  });

  it("gives the client's reason when nothing answers", async () => {
    const result = await probeNode("ws://localhost:6006", {
      clientFactory: () => ({
        async request() {
          throw new Error("cannot connect to ws://localhost:6006");
        },
      }),
    });
    expect(result).toEqual({ ok: false, reason: "cannot connect to ws://localhost:6006" });
  });

  it("times out, and hangs up, on a node that never answers", async () => {
    let closed = false;
    const result = await probeNode("wss://debian-docker.tail8b5861.ts.net:9448", {
      timeoutMs: 20,
      clientFactory: () => ({
        request: () => new Promise<never>(() => undefined),
        close: () => {
          closed = true;
        },
      }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "wss://debian-docker.tail8b5861.ts.net:9448 did not answer within 0.02 s",
    });
    expect(closed).toBe(true);
  });
});

describe("the command the Local node dialog shows", () => {
  it("starts the node, its closer and the dev faucet without the web app", () => {
    expect(demoCommand("http://localhost:3000")).toBe(
      "XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo --no-web",
    );
    expect(demoCommand(null)).toBe("XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo --no-web");
  });

  it("lets another page call the dev faucet with --web-origin", () => {
    expect(demoCommand("https://carbs-kappa.vercel.app")).toBe(
      "XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo --no-web --web-origin https://carbs-kappa.vercel.app",
    );
  });
});
