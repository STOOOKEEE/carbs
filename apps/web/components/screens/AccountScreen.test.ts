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

  it("does not claim device signing for the simulated Stax", () => {
    const { wrapper } = mountScreen(AccountScreen);
    const ledger = wrapper.get("[data-testid='profile-ledger']").text();
    expect(ledger).not.toContain("signed on the device");
    expect(ledger).toContain("signed by the simulated Stax");
    expect(wrapper.get("[data-testid='profile-mac']").text()).not.toMatch(/device/i);
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
    ctx.sim.simDevice.setApprover(async () => false);
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='error']").text()).toContain("Rejected on the device");
    expect(codesIn(wrapper)).toEqual([]);
  });
});

describe("Account screen, browser support", () => {
  it("says to use Chrome when navigator.hid is missing", () => {
    Reflect.deleteProperty(navigator, "hid");
    const { wrapper } = mountScreen(AccountScreen);
    const warning = wrapper.get("[data-testid='hid-warning']").text();
    expect(warning).toContain("Use Chrome");
    expect(warning).toContain("WebHID");
  });

  it("shows no warning when WebHID exists", () => {
    Object.defineProperty(navigator, "hid", { value: {}, configurable: true });
    try {
      const { wrapper } = mountScreen(AccountScreen);
      expect(wrapper.find("[data-testid='hid-warning']").exists()).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, "hid");
    }
  });
});

describe("Account screen, steps signed on the simulated device", () => {
  it("badges them even when the node is live", async () => {
    const mounted = mountScreen(AccountScreen);
    const backend = {
      ...mounted.ctx.backend,
      mode: "live",
      device: { ...mounted.ctx.backend.device, mode: "simulated" },
    } as typeof mounted.ctx.backend;
    const live = mountScreen(AccountScreen, { backend });
    await live.wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    const steps = live.wrapper.findAll("[data-testid='setup-steps'] li");
    expect(live.ctx.demo.state.steps.filter((s) => s.simulatedDevice).length).toBe(3);
    const badged = steps.filter((li) => li.find("p [data-testid='sim-badge']").exists());
    expect(badged).toHaveLength(3);
  });

  it("badges none for a passkey account on a live node", async () => {
    const mounted = mountScreen(AccountScreen);
    const backend = { ...mounted.ctx.backend, mode: "live" } as typeof mounted.ctx.backend;
    const live = mountScreen(AccountScreen, { backend });
    await live.wrapper.get("[data-testid='create-mac']").trigger("click");
    await flushPromises();
    expect(live.ctx.demo.state.steps.some((s) => s.simulatedDevice)).toBe(false);
  });
});
