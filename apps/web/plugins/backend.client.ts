import { SIM_TICK_MS } from "~/lib/constants";
import { sharedAppContext } from "~/lib/app-context";
import {
  BACKEND_KEY,
  DEMO_KEY,
  DEVICE_PROMPT_KEY,
  MIGRATION_KEY,
  NETWORK_KEY,
} from "~/lib/context";

// Builds the backend once per page load and provides it to every screen. Today it is the
// SIMULATED one; the live backend replaces it in M2/M3 (the screens only see the ports).
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig().public;
  const localWss = String(config.localNodeUrl ?? "").trim();
  const { backend, demo, migration, prompt, network } = sharedAppContext({
    storage: window.localStorage,
    pageProtocol: window.location.protocol,
    ...(localWss === "" ? {} : { localWss }),
  });
  nuxtApp.vueApp.provide(BACKEND_KEY, backend);
  nuxtApp.vueApp.provide(DEMO_KEY, demo);
  nuxtApp.vueApp.provide(MIGRATION_KEY, migration);
  nuxtApp.vueApp.provide(DEVICE_PROMPT_KEY, prompt);
  nuxtApp.vueApp.provide(NETWORK_KEY, network);
  void demo.refresh();
  // The simulated ledger closes on its own, at the pace of the real one.
  window.setInterval(() => {
    void demo.tick();
  }, SIM_TICK_MS);
});
