import { SIM_TICK_MS } from "~/lib/constants";
import { createAppContext } from "~/lib/app-context";
import { BACKEND_KEY, DEMO_KEY, DEVICE_PROMPT_KEY, MIGRATION_KEY } from "~/lib/context";

// Builds the backend once per page load and provides it to every screen. Today it is the
// SIMULATED one; the live backend replaces it in M2/M3 (the screens only see the ports).
export default defineNuxtPlugin((nuxtApp) => {
  const { backend, demo, migration, prompt } = createAppContext();
  nuxtApp.vueApp.provide(BACKEND_KEY, backend);
  nuxtApp.vueApp.provide(DEMO_KEY, demo);
  nuxtApp.vueApp.provide(MIGRATION_KEY, migration);
  nuxtApp.vueApp.provide(DEVICE_PROMPT_KEY, prompt);
  void demo.refresh();
  // The simulated ledger closes on its own, at the pace of the real one.
  window.setInterval(() => {
    void demo.tick();
  }, SIM_TICK_MS);
});
