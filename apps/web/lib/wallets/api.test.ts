import { createXrplConnect, useWallet } from "@xrpl-commons/xrpl-connect-vue";
import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import { createAppContext } from "../app-context";
import { createWalletAdapters } from "./adapters";
import { createWalletsApi } from "./api";
import { browserPasskeySource, softwarePasskeySource } from "./passkey";

function wired(passkeys = softwarePasskeySource()) {
  const ctx = createAppContext();
  ctx.sim.simDevice.setApprover(async () => true);
  const adapters = createWalletAdapters(
    { backend: ctx.backend, demo: ctx.demo, network: ctx.network },
    passkeys,
  );
  // The same wiring as plugins/xrpl-connect.client.ts.
  const app = createApp({});
  const selected = ctx.network.selected();
  app.use(
    createXrplConnect({
      adapters,
      network: { id: selected.id, name: selected.name, wss: selected.wss, rpc: selected.rpc },
      autoConnect: false,
      logger: { level: "error" },
    }),
  );
  const { manager } = app.runWithContext(() => useWallet());
  return { ctx, api: createWalletsApi(manager, adapters, ctx.backend, passkeys.simulated) };
}

describe("wallets API on the Vue binding", () => {
  it("lists availability, connects and disconnects through the binding's manager", async () => {
    const { api, ctx } = wired();
    await api.refresh();
    expect(api.state.entries.map((e) => e.available)).toEqual([true, true, true]);
    expect(await api.connect("demo-account")).toBe(true);
    expect(api.state.address).toBe(ctx.demo.state.address);
    await api.disconnect();
    expect(api.state.address).toBeNull();
    expect(ctx.demo.state.address).toBeNull();
  });

  it("says why the passkey is unavailable where the browser has no WebAuthn", async () => {
    const { api } = wired(browserPasskeySource());
    await api.refresh();
    const passkey = api.state.entries.find((e) => e.description.id === "passkey-mac");
    expect(passkey?.available).toBe(false);
    expect(passkey?.unavailableReason).toContain("secure context");
  });

  it("keeps the error when a connection fails", async () => {
    const { api, ctx } = wired();
    ctx.sim.simDevice.setApprover(async () => false);
    expect(await api.connect("ledger-stax")).toBe(false);
    expect(api.state.error).toContain("Rejected on the device");
    expect(api.state.connectedId).toBeNull();
  });
});
