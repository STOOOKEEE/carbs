import { createSimBackend, type SimBackend } from "./backend";
import { createDemo, type Demo } from "./demo";
import { createDevicePrompt, type DevicePrompt } from "./device-prompt";
import { createMigration, type Migration } from "./migration";

export interface AppContext {
  backend: SimBackend;
  demo: Demo;
  migration: Migration;
  prompt: DevicePrompt;
}

/** Everything the screens inject, wired on the simulated backend. */
export function createAppContext(): AppContext {
  const backend = createSimBackend();
  const prompt = createDevicePrompt();
  backend.simDevice.setApprover(prompt.approver);
  return { backend, demo: createDemo(backend), migration: createMigration(backend), prompt };
}
