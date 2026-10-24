import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import type { Component } from "vue";
import { createAppContext, type AppContext } from "~/lib/app-context";
import { BACKEND_KEY, DEMO_KEY, DEVICE_PROMPT_KEY, MIGRATION_KEY } from "~/lib/context";

/** Mount a screen on a fresh SIMULATED backend whose device approves every review. */
export function mountScreen(component: Component, options: { autoApprove?: boolean } = {}) {
  const ctx: AppContext = createAppContext();
  if (options.autoApprove !== false) ctx.backend.simDevice.setApprover(async () => true);
  const wrapper = mount(component, {
    global: {
      stubs: { NuxtLink: RouterLinkStub },
      plugins: [
        (app) => {
          app.provide(BACKEND_KEY, ctx.backend);
          app.provide(DEMO_KEY, ctx.demo);
          app.provide(MIGRATION_KEY, ctx.migration);
          app.provide(DEVICE_PROMPT_KEY, ctx.prompt);
        },
      ],
    },
  });
  return { ctx, wrapper };
}

export { flushPromises };

/** The result codes shown inside a wrapper, in order. */
export function codesIn(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll("[data-testid='result-code']").map((node) => node.text());
}
