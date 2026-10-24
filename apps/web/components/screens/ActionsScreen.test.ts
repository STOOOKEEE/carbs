import { describe, expect, it } from "vitest";
import ActionsScreen from "./ActionsScreen.vue";
import { codesIn, flushPromises, mountScreen } from "./test-utils";

async function withSession(mode: "P" | "C" | "A") {
  const mounted = mountScreen(ActionsScreen);
  await mounted.ctx.demo.createAccount("mac");
  await mounted.ctx.demo.openSession({
    mode,
    durationSec: 600,
    permissions: [
      "Payment",
      "OfferCreate",
      "TrustSet",
      "TicketCreate",
      "NFTokenMint",
      "CheckCreate",
    ],
    capDrops: 20_000_000,
  });
  await flushPromises();
  return mounted;
}

describe("Actions screen", () => {
  it("disables the actions until a session is open", async () => {
    const { wrapper, ctx } = mountScreen(ActionsScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    expect(wrapper.find("[data-testid='no-session']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='run-payment']").attributes("disabled")).toBeDefined();
  });

  it("runs six transaction types with no prompt, each answered by the node", async () => {
    const { wrapper, ctx } = await withSession("P");
    let prompts = 0;
    ctx.backend.simDevice.setApprover(async () => {
      prompts += 1;
      return true;
    });
    for (const id of ["payment", "offer", "trust", "ticket", "mint", "check"]) {
      await wrapper.get(`[data-testid='run-${id}']`).trigger("click");
      await flushPromises();
    }
    expect(codesIn(wrapper)).toEqual(Array(6).fill("tesSUCCESS"));
    expect(prompts).toBe(0);
    expect(wrapper.findAll("[data-testid='sim-badge']").length).toBeGreaterThan(0);
  });

  it("mode C: the sixth payment is refused tefSESSION_LIMIT (W6)", async () => {
    const { wrapper } = await withSession("C");
    for (let i = 0; i < 6; i += 1) {
      await wrapper.get("[data-testid='run-payment']").trigger("click");
      await flushPromises();
    }
    expect(codesIn(wrapper)).toEqual(["tefSESSION_LIMIT", ...Array(5).fill("tesSUCCESS")]);
  });

  it("mode C: other types are refused tefSESSION_TX_NOT_ALLOWED", async () => {
    const { wrapper } = await withSession("C");
    await wrapper.get("[data-testid='run-ticket']").trigger("click");
    await flushPromises();
    expect(codesIn(wrapper)).toEqual(["tefSESSION_TX_NOT_ALLOWED"]);
  });
});
