import { describe, expect, it } from "vitest";
import AttackScreen from "./AttackScreen.vue";
import { codesIn, flushPromises, mountScreen } from "./test-utils";

async function withSession(mode: "P" | "C") {
  const mounted = mountScreen(AttackScreen);
  await mounted.ctx.demo.createAccount("mac");
  await mounted.ctx.demo.openSession({
    mode,
    durationSec: 600,
    permissions: ["Payment"],
    capDrops: 20_000_000,
  });
  await flushPromises();
  return mounted;
}

async function run(wrapper: Awaited<ReturnType<typeof withSession>>["wrapper"], id: string) {
  await wrapper.get(`[data-testid='run-${id}']`).trigger("click");
  await flushPromises();
}

describe("Attack screen", () => {
  it("every refusal is the node's code", async () => {
    const { wrapper } = await withSession("P");
    const expected: Record<string, string> = {
      "regular-key": "tefSESSION_TX_NOT_ALLOWED",
      passkey: "tefSESSION_TX_NOT_ALLOWED",
      "disable-master": "tefSESSION_TX_NOT_ALLOWED",
      "open-session": "tefSESSION_TX_NOT_ALLOWED",
      "fee-burn": "tefSESSION_LIMIT",
      "no-last-ledger": "tefSESSION_TX_NOT_ALLOWED",
      "other-account": "tefBAD_AUTH",
    };
    for (const [id, code] of Object.entries(expected)) {
      await run(wrapper, id);
      expect(codesIn(wrapper)[0], id).toBe(code);
    }
    expect(
      wrapper
        .findAll("[data-testid='result']")
        .every((node) => node.text().includes("no fee charged")),
    ).toBe(true);
  });

  it("is refused after expiry with tefSESSION_EXPIRED", async () => {
    const { wrapper } = await withSession("P");
    await run(wrapper, "after-expiry");
    expect(codesIn(wrapper)).toEqual(["tefSESSION_EXPIRED"]);
  });

  it("needs a mode C session for the cap overflow, then refuses it with tefSESSION_LIMIT", async () => {
    const p = await withSession("P");
    expect(p.wrapper.get("[data-testid='run-cap-overflow']").attributes("disabled")).toBeDefined();
    const c = await withSession("C");
    await run(c.wrapper, "cap-overflow");
    expect(codesIn(c.wrapper)).toEqual(["tefSESSION_LIMIT"]);
  });

  it("asks for a session first", async () => {
    const { wrapper, ctx } = mountScreen(AttackScreen);
    await ctx.demo.createAccount("mac");
    await flushPromises();
    expect(wrapper.get("[data-testid='run-regular-key']").attributes("disabled")).toBeDefined();
  });
});
