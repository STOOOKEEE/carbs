import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { afterEach } from "vitest";
import { WalletManager } from "xrpl-connect";
import type { Component } from "vue";
import { createAppContext, type AppContext } from "~/lib/app-context";
import type { ClientFactory } from "~/lib/live/clients";
import type { Backend } from "~/lib/ports";
import type { NetworkStoreOptions } from "~/lib/network-store";
import { createWalletAdapters } from "~/lib/wallets/adapters";
import { createWalletsApi } from "~/lib/wallets/api";
import { softwarePasskeySource } from "~/lib/wallets/passkey";
import type { BackendStatus } from "~/lib/boot";
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
  WALLETS_KEY,
} from "~/lib/context";

// Wrappers are attached to the document (focus needs it): clear it between tests.
afterEach(() => {
  document.body.innerHTML = "";
});

/** Mount a screen on a fresh SIMULATED backend whose device approves every review. */
export function mountScreen(
  component: Component,
  options: {
    autoApprove?: boolean;
    network?: NetworkStoreOptions;
    clientFactory?: ClientFactory;
    fetcher?: typeof fetch;
    props?: Record<string, unknown>;
    /** Provide this backend to the screens instead of the simulated one. */
    backend?: Backend;
    /** What the page load found (default: the simulation, as asked). */
    status?: BackendStatus;
  } = {},
) {
  const ctx: AppContext = createAppContext(options.network, {
    ...(options.clientFactory === undefined ? {} : { clientFactory: options.clientFactory }),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  });
  if (options.status !== undefined) ctx.network.state.node = options.status.active;
  const adapters = createWalletAdapters(
    { backend: ctx.backend, demo: ctx.demo, network: ctx.network },
    softwarePasskeySource(),
  );
  const manager = new WalletManager({ adapters, autoConnect: false, logger: { level: "error" } });
  const wallets = createWalletsApi(manager, adapters, ctx.backend, true);
  if (options.autoApprove !== false) {
    ctx.sim.simDevice.setApprover(async () => true);
    ctx.prompt.approver = async () => true;
  }
  const wrapper = mount(component, {
    attachTo: document.body,
    ...(options.props === undefined ? {} : { props: options.props }),
    global: {
      stubs: { NuxtLink: RouterLinkStub },
      plugins: [
        (app) => {
          app.provide(BACKEND_KEY, options.backend ?? ctx.backend);
          app.provide(DEMO_KEY, ctx.demo);
          app.provide(MIGRATION_KEY, ctx.migration);
          app.provide(DEVICE_PROMPT_KEY, ctx.prompt);
          app.provide(NETWORK_KEY, ctx.network);
          app.provide(DEVICE_SELECTION_KEY, ctx.deviceSelection);
          app.provide(LIVE_EXPOSURE_KEY, ctx.liveExposure);
          app.provide(LIVE_MIGRATION_KEY, ctx.liveMigration);
          app.provide(WALLETS_KEY, wallets);
          app.provide(
            BACKEND_STATUS_KEY,
            options.status ?? {
              requested: "simulated",
              active: "simulated",
              error: null,
              target: "",
            },
          );
        },
      ],
    },
  });
  return { ctx, wrapper, wallets };
}

export { flushPromises };

/** The result codes shown inside a wrapper, in order. */
export function codesIn(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll("[data-testid='result-code']").map((node) => node.text());
}
