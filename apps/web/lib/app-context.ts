import { createSimBackend, type SimBackend } from "./backend";
import { createLiveClients, type ClientFactory } from "./live/clients";
import { LiveExposure } from "./live/exposure";
import { createDemo, type Demo } from "./demo";
import { createDevicePrompt, type DevicePrompt } from "./device-prompt";
import { createMigration, type Migration } from "./migration";
import { createNetworkStore, type NetworkStore, type NetworkStoreOptions } from "./network-store";

export interface AppContext {
  backend: SimBackend;
  demo: Demo;
  migration: Migration;
  prompt: DevicePrompt;
  network: NetworkStore;
  /** Real reads of mainnet and the AlphaNet (the Quantum screen's live source). */
  liveExposure: LiveExposure;
}

/** Everything the screens inject, wired on the simulated backend. */
export function createAppContext(
  network: NetworkStoreOptions = {},
  clientFactory?: ClientFactory,
): AppContext {
  const backend = createSimBackend();
  const prompt = createDevicePrompt();
  backend.simDevice.setApprover(prompt.approver);
  const networkStore = createNetworkStore(network);
  return {
    backend,
    demo: createDemo(backend),
    migration: createMigration(backend),
    prompt,
    network: networkStore,
    liveExposure: new LiveExposure(createLiveClients(() => networkStore.networks(), clientFactory)),
  };
}

let shared: AppContext | null = null;

/** One context per page: the plugins and the wallet adapters must see the same account. */
export function sharedAppContext(network: NetworkStoreOptions = {}): AppContext {
  shared ??= createAppContext(network);
  return shared;
}
