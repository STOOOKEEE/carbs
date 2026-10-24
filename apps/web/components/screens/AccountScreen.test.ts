import { describe, expect, it } from "vitest";
import AccountScreen from "./AccountScreen.vue";
import { codesIn, flushPromises, mountScreen } from "./test-utils";

describe("Account screen", () => {
  it("creates a Mac account with a passkey, state read from the node, SIMULATED", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    expect(wrapper.find("[data-testid='account-state']").exists()).toBe(false);
    await wrapper.get("[data-testid='create-mac']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='address']").text()).toBe(ctx.demo.state.address);
    expect(wrapper.get("[data-testid='master']").text()).toBe("enabled");
    expect(wrapper.text()).toContain("Passkeys");
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(1);
    expect(codesIn(wrapper)).toEqual(["tesSUCCESS"]);
    expect(wrapper.find("[data-testid='sim-badge']").exists()).toBe(true);
  });

  it("runs the passkey-only recipe: blackhole regular key, master disabled", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    await wrapper.get("[data-testid='passkey-only']").setValue(true);
    await wrapper.get("[data-testid='create-mac']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='master']").text()).toBe("disabled");
    expect(ctx.demo.state.info?.regularKey).toBe("rrrrrrrrrrrrrrrrrrrrBZbvji");
    expect(codesIn(wrapper)).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
  });

  it("creates a Ledger account in three device-signed steps, master disabled, no passkey", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='master']").text()).toBe("disabled");
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(0);
    expect(codesIn(wrapper)).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
  });

  it("shows a rejection on the device and sends nothing", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen, { autoApprove: false });
    ctx.backend.simDevice.setApprover(async () => false);
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='error']").text()).toContain("Rejected on the device");
    expect(codesIn(wrapper)).toEqual([]);
  });
});
