import { describe, expect, it } from "vitest";
import { createAppContext } from "./app-context";
import { chooseBackend } from "./boot";
import { FakeAlphaNet } from "./live/fake-alphanet";
import { softwarePasskeySource } from "./wallets/passkey";

function boot(options: Parameters<typeof chooseBackend>[1], network = {}) {
  const ctx = createAppContext(network);
  ctx.prompt.approver = async () => true;
  return { ctx, run: () => chooseBackend(ctx, options) };
}

const common = { passkeys: softwarePasskeySource(), sleep: async () => undefined };

describe("choosing the node", () => {
  it("stays on the simulation when it was asked for", async () => {
    const { ctx, run } = boot({ ...common, requested: "simulated" });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend).toBe(ctx.sim);
    expect(status).toMatchObject({ requested: "simulated", active: "simulated", error: null });
    expect(ctx.network.state.node).toBe("simulated");
  });

  it("runs on the local node when it answers and serves the SigningSessions names", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const urls: string[] = [];
    const { ctx, run } = boot({
      ...common,
      requested: "local",
      clientFactory: (url) => {
        urls.push(url);
        return fake;
      },
      fetcher: fake.faucet,
    });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend.mode).toBe("live");
    expect(chosen.demo).not.toBe(ctx.demo);
    expect(chosen.sim).toBe(ctx.sim);
    expect(urls).toEqual(["ws://localhost:6006"]);
    expect(status).toMatchObject({
      requested: "local",
      active: "local",
      error: null,
      target: "ws://localhost:6006",
    });
    expect(ctx.network.state.node).toBe("local");
    expect(chosen.backend.node.explorerNetwork()?.id).toBe("local");
  });

  it("runs on the team node at its preset URL", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const urls: string[] = [];
    const { ctx, run } = boot(
      {
        ...common,
        requested: "team",
        clientFactory: (url) => {
          urls.push(url);
          return fake;
        },
        fetcher: fake.faucet,
      },
      { pageProtocol: "https:" },
    );
    const { ctx: chosen, status } = await run();
    expect(urls).toEqual(["wss://debian-docker.tail8b5861.ts.net:9448"]);
    expect(status).toMatchObject({ requested: "team", active: "team", error: null });
    expect(ctx.network.selected().id).toBe("team");
    expect(chosen.backend.node.explorerNetwork()?.name).toBe("Team node");
  });

  it("stays on the simulation, with the reason, when the node lacks the amendment", async () => {
    const fake = new FakeAlphaNet({ sessions: false });
    const { ctx, run } = boot({ ...common, requested: "local", clientFactory: () => fake });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend).toBe(ctx.sim);
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("does not serve SigningSessions");
    expect(ctx.network.state.node).toBe("simulated");
  });

  it("stays on the simulation when the node cannot be reached", async () => {
    const { run } = boot({
      ...common,
      requested: "team",
      clientFactory: () => ({
        async request() {
          throw new Error("cannot connect to wss://debian-docker.tail8b5861.ts.net:9448");
        },
      }),
    });
    const { status } = await run();
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("cannot connect");
  });

  it("gives up on a node that does not answer", async () => {
    const { run } = boot({
      ...common,
      requested: "local",
      timeoutMs: 20,
      clientFactory: () => ({ request: () => new Promise<never>(() => undefined) }),
    });
    const { status } = await run();
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("did not answer within");
  });

  it("hangs up on a node it refuses, and keeps the client of a node it uses", async () => {
    let closed = 0;
    const close = () => {
      closed += 1;
    };
    const refused = new FakeAlphaNet({ sessions: false });
    await boot({
      ...common,
      requested: "local",
      clientFactory: () => ({ request: (m, p) => refused.request(m, p), close }),
    }).run();
    expect(closed).toBe(1);
    await boot({
      ...common,
      requested: "team",
      timeoutMs: 20,
      clientFactory: () => ({ request: () => new Promise<never>(() => undefined), close }),
    }).run();
    expect(closed).toBe(2);
    const live = new FakeAlphaNet({ sessions: true });
    const { status } = await boot({
      ...common,
      requested: "local",
      fetcher: live.faucet,
      clientFactory: () => ({ request: (m, p) => live.request(m, p), close }),
    }).run();
    expect(status.active).toBe("local");
    expect(closed).toBe(2);
  });

  it("tries ws://localhost from an https page: Chrome and Firefox trust the loopback", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const { run } = boot(
      { ...common, requested: "local", clientFactory: () => fake, fetcher: fake.faucet },
      { pageProtocol: "https:" },
    );
    const { status } = await run();
    expect(status.active).toBe("local");
  });

  it("does not even try a ws:// node on another host from an https page", async () => {
    let tried = false;
    const { run } = boot(
      {
        ...common,
        requested: "local",
        clientFactory: () => {
          tried = true;
          return new FakeAlphaNet({ sessions: true });
        },
      },
      { pageProtocol: "https:", localWss: "ws://node.example.org:6006" },
    );
    const { status } = await run();
    expect(tried).toBe(false);
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("mixed content");
  });
});
