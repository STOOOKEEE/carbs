import { SIM_TICK_MS } from "~/lib/constants";
import { sharedAppContext, setSharedAppContext } from "~/lib/app-context";
import { chooseBackend } from "~/lib/boot";
import { clearNodeChoice, readNodeChoice } from "~/lib/node-choice";
import {
  BACKEND_KEY,
  BACKEND_STATUS_KEY,
  DEMO_KEY,
  DEVICE_PROMPT_KEY,
  DEVICE_SELECTION_KEY,
  LIVE_EXPOSURE_KEY,
  LIVE_MIGRATION_KEY,
  MIGRATION_KEY,
  NETWORK_KEY,
} from "~/lib/context";
import { watchLedgerDisconnects } from "~/lib/live/device-selection";
import type { NetworkStoreOptions } from "~/lib/network-store";
import { browserPasskeySource } from "~/lib/wallets/passkey";

/** A runtime-config value, or nothing when it is empty (the default of `lib/networks.ts` applies). */
function configured(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? undefined : text;
}

// Builds the context once per page load, chooses the node (the simulation, or the local or
// team node when it was chosen and answers) and provides it to every screen. When the live
// node cannot be used the page stays on the simulation, the header says why once, and the
// saved choice is forgotten so the next load does not wait for it again.
export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig().public;
  const options: NetworkStoreOptions = {
    storage: window.localStorage,
    pageProtocol: window.location.protocol,
  };
  const localWss = configured(config.localNodeUrl);
  const localFaucet = configured(config.localFaucetUrl);
  const teamWss = configured(config.teamNodeUrl);
  const teamFaucet = configured(config.teamFaucetUrl);
  if (localWss !== undefined) options.localWss = localWss;
  if (localFaucet !== undefined) options.localFaucet = localFaucet;
  if (teamWss !== undefined) options.teamWss = teamWss;
  if (teamFaucet !== undefined) options.teamFaucet = teamFaucet;
  const base = sharedAppContext(options);
  const requested = readNodeChoice(window.localStorage, config.backend);
  const { ctx, status } = await chooseBackend(base, {
    requested,
    passkeys: browserPasskeySource(),
  });
  if (status.active !== status.requested) clearNodeChoice(window.localStorage);
  setSharedAppContext(ctx);

  nuxtApp.vueApp.provide(BACKEND_KEY, ctx.backend);
  nuxtApp.vueApp.provide(DEMO_KEY, ctx.demo);
  nuxtApp.vueApp.provide(MIGRATION_KEY, ctx.migration);
  nuxtApp.vueApp.provide(DEVICE_PROMPT_KEY, ctx.prompt);
  nuxtApp.vueApp.provide(NETWORK_KEY, ctx.network);
  nuxtApp.vueApp.provide(LIVE_EXPOSURE_KEY, ctx.liveExposure);
  nuxtApp.vueApp.provide(LIVE_MIGRATION_KEY, ctx.liveMigration);
  nuxtApp.vueApp.provide(BACKEND_STATUS_KEY, status);
  nuxtApp.vueApp.provide(DEVICE_SELECTION_KEY, ctx.deviceSelection);
  // A real Stax's session is closed when it is unplugged or the page goes away.
  const hid: unknown = Reflect.get(window.navigator, "hid");
  watchLedgerDisconnects(ctx.deviceSelection, window, hid instanceof EventTarget ? hid : null);
  void ctx.demo.tick();
  // The simulated ledger closes on its own, at the pace of the real one; a live node is polled.
  window.setInterval(() => {
    void ctx.demo.tick();
  }, SIM_TICK_MS);
});
