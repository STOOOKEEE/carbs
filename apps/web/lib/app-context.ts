import { createSimBackend, type SimBackend } from "./backend";
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
}

/** Everything the screens inject, wired on the simulated backend. */
export function createAppContext(network: NetworkStoreOptions = {}): AppContext {
  const backend = createSimBackend();
  const prompt = createDevicePrompt();
  backend.simDevice.setApprover(prompt.approver);
  return {
    backend,
    demo: createDemo(backend),
    migration: createMigration(backend),
    prompt,
    network: createNetworkStore(network),
  };
}
