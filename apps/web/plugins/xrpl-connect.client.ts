import { createXrplConnect, useWallet } from "@xrpl-commons/xrpl-connect-vue";
import { sharedAppContext } from "~/lib/app-context";
import { WALLETS_KEY } from "~/lib/context";
import { createWalletAdapters } from "~/lib/wallets/adapters";
import { createWalletsApi } from "~/lib/wallets/api";
import { browserPasskeySource } from "~/lib/wallets/passkey";

// The wallet entry lists three adapters and nothing else: Ledger Stax, Passkey (this Mac)
// and a throw-away Demo account. They need no API key and load no third-party script.
export default defineNuxtPlugin((nuxtApp) => {
  const { backend, demo, network } = sharedAppContext();
  const adapters = createWalletAdapters({ backend, demo, network }, browserPasskeySource());
  const selected = network.selected();

  nuxtApp.vueApp.use(
    createXrplConnect({
      adapters,
      network: { id: selected.id, name: selected.name, wss: selected.wss, rpc: selected.rpc },
      // Every connection creates a fresh account, so a page reload never reconnects on its own.
      autoConnect: false,
      logger: { level: "warn" },
    }),
  );
  const { manager } = nuxtApp.vueApp.runWithContext(() => useWallet());
  const wallets = createWalletsApi(manager, adapters, backend, false);
  void wallets.refresh();
  nuxtApp.vueApp.provide(WALLETS_KEY, wallets);
});
