import { describe, expect, it } from "vitest";
import { flushPromises, mountScreen } from "../screens/test-utils";
import WalletConnector from "./WalletConnector.vue";

async function opened() {
  const mounted = mountScreen(WalletConnector);
  await mounted.wallets.refresh();
  await mounted.wrapper.get("[data-testid='wallet-open']").trigger("click");
  return mounted;
}

describe("Wallet entry", () => {
  it("lists the three wallets and nothing else", async () => {
    const { wrapper } = await opened();
    const ids = wrapper
      .findAll("[data-testid^='wallet-']")
      .map((n) => n.attributes("data-testid"))
      .filter((id) => /^wallet-(ledger-stax|passkey-mac|demo-account)$/.test(id ?? ""));
    expect(ids).toEqual(["wallet-ledger-stax", "wallet-passkey-mac", "wallet-demo-account"]);
    const text = wrapper.text();
    expect(text).not.toMatch(/Xaman|GemWallet|WalletConnect/i);
  });

  it("shows, for each, the key type, who signs what and the SIMULATED badge", async () => {
    const { wrapper } = await opened();
    for (const id of ["ledger-stax", "passkey-mac", "demo-account"]) {
      const card = wrapper.get(`[data-testid='wallet-${id}']`);
      expect(card.get("[data-testid='key-type']").text().length).toBeGreaterThan(10);
      expect(card.findAll("[data-testid='signs'] li").length).toBeGreaterThanOrEqual(2);
      expect(card.find("[data-testid='sim-badge']").exists()).toBe(true);
    }
    expect(
      wrapper.get("[data-testid='wallet-ledger-stax'] [data-testid='simulated-parts']").text(),
    ).toBe("node, Stax");
    expect(
      wrapper.get("[data-testid='wallet-ledger-stax'] [data-testid='key-type']").text(),
    ).toContain("ML-DSA-44");
    expect(
      wrapper.get("[data-testid='wallet-passkey-mac'] [data-testid='key-type']").text(),
    ).toContain("P-256");
  });

  it("connects the demo account, closes, shows the address and disconnects", async () => {
    const { wrapper, ctx } = await opened();
    await wrapper.get("[data-testid='connect-demo-account']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='wallet-modal']").exists()).toBe(false);
    expect(ctx.demo.state.profile).toBe("demo");
    expect(wrapper.get("[data-testid='connected-address']").text()).toContain("rSim");
    await wrapper.get("[data-testid='wallet-disconnect']").trigger("click");
    await flushPromises();
    expect(ctx.demo.state.address).toBeNull();
    expect(wrapper.find("[data-testid='wallet-open']").exists()).toBe(true);
  });

  it("connects the Ledger Stax through the simulated device and the passkey through the software authenticator", async () => {
    const stax = await opened();
    await stax.wrapper.get("[data-testid='connect-ledger-stax']").trigger("click");
    await flushPromises();
    expect(stax.ctx.demo.state.profile).toBe("ledger");

    const passkey = await opened();
    await passkey.wrapper.get("[data-testid='connect-passkey-mac']").trigger("click");
    await flushPromises();
    expect(passkey.ctx.demo.state.profile).toBe("mac");
  });

  it("shows the error of a rejected device and stays open", async () => {
    const { wrapper, ctx } = await opened();
    ctx.backend.simDevice.setApprover(async () => false);
    await wrapper.get("[data-testid='connect-ledger-stax']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='wallet-error']").text()).toContain("Rejected on the device");
    expect(wrapper.find("[data-testid='wallet-modal']").exists()).toBe(true);
  });
});
