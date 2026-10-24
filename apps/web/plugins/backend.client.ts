import { SIM_TICK_MS } from "~/lib/constants";
import { sharedAppContext, setSharedAppContext } from "~/lib/app-context";
import { readBackendChoice } from "~/lib/backend-choice";
import { chooseBackend } from "~/lib/boot";
import {
  BACKEND_KEY,
  BACKEND_STATUS_KEY,
  DEMO_KEY,
  DEVICE_PROMPT_KEY,
  LIVE_EXPOSURE_KEY,
  LIVE_MIGRATION_KEY,
  MIGRATION_KEY,
  NETWORK_KEY,
} from "~/lib/context";
import { browserPasskeySource } from "~/lib/wallets/passkey";

// Builds the context once per page load, chooses the backend (the simulation, or the live node
// when it was asked for and answers) and provides it to every screen. When the live node
// cannot be used the page stays on the simulation and the header says why.
export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig().public;
  const localWss = String(config.localNodeUrl ?? "").trim();
  const localFaucet = String(config.localFaucetUrl ?? "").trim();
  const base = sharedAppContext({
    storage: window.localStorage,
    pageProtocol: window.location.protocol,
    ...(localWss === "" ? {} : { localWss }),
    ...(localFaucet === "" ? {} : { localFaucet }),
  });
  const requested = readBackendChoice(window.localStorage, config.backend);
  const { ctx, status } = await chooseBackend(base, {
    requested,
    passkeys: browserPasskeySource(),
  });
  setSharedAppContext(ctx);

  nuxtApp.vueApp.provide(BACKEND_KEY, ctx.backend);
  nuxtApp.vueApp.provide(DEMO_KEY, ctx.demo);
  nuxtApp.vueApp.provide(MIGRATION_KEY, ctx.migration);
  nuxtApp.vueApp.provide(DEVICE_PROMPT_KEY, ctx.prompt);
  nuxtApp.vueApp.provide(NETWORK_KEY, ctx.network);
  nuxtApp.vueApp.provide(LIVE_EXPOSURE_KEY, ctx.liveExposure);
  nuxtApp.vueApp.provide(LIVE_MIGRATION_KEY, ctx.liveMigration);
  nuxtApp.vueApp.provide(BACKEND_STATUS_KEY, status);
  void ctx.demo.tick();
  // The simulated ledger closes on its own, at the pace of the real one; a live node is polled.
  window.setInterval(() => {
    void ctx.demo.tick();
  }, SIM_TICK_MS);
});
