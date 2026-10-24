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

describe("choosing the backend", () => {
  it("stays on the simulation when it was asked for", async () => {
    const { ctx, run } = boot({ ...common, requested: "simulated" });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend).toBe(ctx.sim);
    expect(status).toMatchObject({ requested: "simulated", active: "simulated", error: null });
  });

  it("runs on the live node when it answers and serves the SigningSessions names", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const { ctx, run } = boot({
      ...common,
      requested: "live",
      clientFactory: () => fake,
      fetcher: fake.faucet,
    });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend.mode).toBe("live");
    expect(chosen.demo).not.toBe(ctx.demo);
    expect(chosen.sim).toBe(ctx.sim);
    expect(status).toMatchObject({
      requested: "live",
      active: "live",
      error: null,
      target: "ws://localhost:6006",
    });
  });

  it("stays on the simulation, with the reason, when the node lacks the amendment", async () => {
    const fake = new FakeAlphaNet({ sessions: false });
    const { ctx, run } = boot({ ...common, requested: "live", clientFactory: () => fake });
    const { ctx: chosen, status } = await run();
    expect(chosen.backend).toBe(ctx.sim);
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("does not serve SigningSessions");
  });

  it("stays on the simulation when the node cannot be reached", async () => {
    const { run } = boot({
      ...common,
      requested: "live",
      clientFactory: () => ({
        async request() {
          throw new Error("cannot connect to ws://localhost:6006");
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
      requested: "live",
      timeoutMs: 20,
      clientFactory: () => ({ request: () => new Promise<never>(() => undefined) }),
    });
    const { status } = await run();
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("did not answer within");
  });

  it("does not even try a ws:// node from an https page", async () => {
    let tried = false;
    const { run } = boot(
      {
        ...common,
        requested: "live",
        clientFactory: () => {
          tried = true;
          return new FakeAlphaNet({ sessions: true });
        },
      },
      { pageProtocol: "https:" },
    );
    const { status } = await run();
    expect(tried).toBe(false);
    expect(status.active).toBe("simulated");
    expect(status.error).toContain("mixed content");
  });
});
