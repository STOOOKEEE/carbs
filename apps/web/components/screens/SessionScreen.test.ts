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
