import { createSimBackend, type SimBackend } from "./backend";
import type { Backend } from "./ports";
import { createLiveClients, type ClientFactory } from "./live/clients";
import { LiveExposure } from "./live/exposure";
import { createLiveMigration } from "./live/migration";
import { createDemo, type Demo } from "./demo";
import { createDevicePrompt, type DevicePrompt } from "./device-prompt";
import { createMigration, type Migration } from "./migration";
import { createNetworkStore, type NetworkStore, type NetworkStoreOptions } from "./network-store";

export interface AppContext {
  /** The simulation, always present (the Quantum screen's simulated source runs on it). */
  sim: SimBackend;
  /** The backend the screens run on: `sim`, or the live node when one was reached (`lib/boot.ts`). */
  backend: Backend;
  demo: Demo;
  migration: Migration;
  prompt: DevicePrompt;
  network: NetworkStore;
  /** Real reads of mainnet and the AlphaNet (the Quantum screen's live source). */
  liveExposure: LiveExposure;
  /** The AlphaNet migration on a fresh account; the device in it is SIMULATED, the node is real. */
  liveMigration: Migration;
}

/** Everything the screens inject, wired on the simulated backend. */
/** Test doubles for the live parts: the node clients and the faucet's `fetch`. */
export interface LiveOptions {
  clientFactory?: ClientFactory;
  fetcher?: typeof fetch;
}

export function createAppContext(
  network: NetworkStoreOptions = {},
  live: LiveOptions = {},
): AppContext {
  const backend = createSimBackend();
  const prompt = createDevicePrompt();
  backend.simDevice.setApprover(prompt.approver);
  const networkStore = createNetworkStore(network);
  const clients = createLiveClients(() => networkStore.networks(), live.clientFactory);
  const liveExposure = new LiveExposure(clients);
  return {
    sim: backend,
    backend,
    demo: createDemo(backend),
    migration: createMigration(backend),
    prompt,
    network: networkStore,
    liveExposure,
    liveMigration: createLiveMigration({
      clients,
      exposure: liveExposure,
      network: () => networkStore.networks().alphanet,
      // Looked up at call time, so that a test can replace the approver.
      approver: (review) => prompt.approver(review),
      ...(live.fetcher === undefined ? {} : { fetcher: live.fetcher }),
    }),
  };
}

let shared: AppContext | null = null;

/** One context per page: the plugins and the wallet adapters must see the same account. */
export function sharedAppContext(network: NetworkStoreOptions = {}): AppContext {
  shared ??= createAppContext(network);
  return shared;
}

/** Replace the shared context once the backend is chosen (the simulation or the live node). */
export function setSharedAppContext(ctx: AppContext): void {
  shared = ctx;
}
