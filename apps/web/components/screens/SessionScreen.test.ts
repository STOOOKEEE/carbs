import { describe, expect, it } from "vitest";
import SessionScreen from "./SessionScreen.vue";
import { flushPromises, mountScreen } from "./test-utils";

describe("Session screen", () => {
  it("asks for an account first", () => {
    const { wrapper } = mountScreen(SessionScreen);
    expect(wrapper.find("[data-testid='need-account']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='session-form']").exists()).toBe(false);
  });

  it("opens a mode P session and counts down from the node's close time", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[data-testid='session-result'] [data-testid='result-code']").text()).toBe(
      "tesSUCCESS",
    );
    expect(wrapper.get("[data-testid='entry-mode']").text()).toBe("P");
    expect(wrapper.get("[data-testid='countdown']").text()).toMatch(/^(09|10):\d\d$/);
  });

  it("shows the spent / cap bar in mode C and closes with the session key", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    await wrapper.get("[data-testid='mode-C']").setValue(true);
    await wrapper.get("[data-testid='cap']").setValue(20);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[data-testid='spent']").text()).toBe("0 XRP of 20 XRP");
    await ctx.demo.runAction("payment");
    await flushPromises();
    expect(wrapper.get("[data-testid='spent']").text()).toBe("3.500012 XRP of 20 XRP");
    await wrapper.get("[data-testid='close-session']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='session-result'] [data-testid='result-code']").text()).toBe(
      "tesSUCCESS",
    );
    expect(wrapper.text()).toContain("No session open.");
  });

  it("shows Expired after the simulated clock passes the Expiration", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    await wrapper.get("[data-testid='advance']").trigger("click");
    await ctx.demo.advance(600);
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(wrapper.find("[data-testid='expired']").exists()).toBe(true);
  });

  it("opens a Ledger account's session on the device, with the rules on its screen", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    await ctx.demo.createAccount("ledger");
    const seen: string[] = [];
    ctx.sim.simDevice.setApprover(async (review) => {
      seen.push(...review.lines.map((line) => `${line.label}: ${line.value}`));
      return true;
    });
    await flushPromises();
    await wrapper.get("[data-testid='mode-A']").setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(seen).toContain("Allows: All transactions");
    expect(seen).toContain("Valid for: 10 minutes");
    expect(seen.some((line) => line.startsWith("Note: Cannot change keys"))).toBe(true);
    expect(wrapper.get("[data-testid='entry-mode']").text()).toBe("A");
  });
});

describe("Session screen, what is simulated and what is asked", () => {
  async function ledgerOnLiveNode() {
    const mounted = mountScreen(SessionScreen);
    // A live node with the simulated device: the node answers are real, the Stax is not.
    const backend = {
      ...mounted.ctx.backend,
      mode: "live",
      device: { ...mounted.ctx.backend.device, mode: "simulated" },
    } as typeof mounted.ctx.backend;
    const live = mountScreen(SessionScreen, { backend });
    await live.ctx.demo.createAccount("ledger");
    return live;
  }

  it("badges the open button when a Ledger account is signed by the simulated device, even on a live node", async () => {
    const { wrapper } = await ledgerOnLiveNode();
    await flushPromises();
    expect(wrapper.find("[data-testid='open-session'] [data-testid='sim-badge']").exists()).toBe(
      true,
    );
  });

  it("badges nothing on a live node for a passkey account", async () => {
    const mounted = mountScreen(SessionScreen);
    const backend = { ...mounted.ctx.backend, mode: "live" } as typeof mounted.ctx.backend;
    const live = mountScreen(SessionScreen, { backend });
    await live.ctx.demo.createAccount("mac");
    await flushPromises();
    expect(
      live.wrapper.find("[data-testid='open-session'] [data-testid='sim-badge']").exists(),
    ).toBe(false);
  });

  it("says why Open is disabled when no type is ticked", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    for (const box of wrapper.findAll("input[type='checkbox']")) await box.setValue(false);
    expect(wrapper.get("[data-testid='open-session']").attributes("disabled")).toBeDefined();
    expect(wrapper.get("[data-testid='open-hint']").text()).toContain("Tick at least one");
  });

  it("asks for an account when the setup stopped half-way", async () => {
    const { wrapper, ctx } = mountScreen(SessionScreen);
    ctx.sim.simDevice.setApprover(async () => false);
    await ctx.demo.createAccount("ledger");
    await flushPromises();
    expect(ctx.demo.state.address).not.toBeNull();
    expect(wrapper.find("[data-testid='need-account']").exists()).toBe(true);
  });
});
