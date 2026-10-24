import type { Backend } from "./ports";
import { SimulatedDevice } from "./sim/device";
import { SimulatedExposure } from "./sim/exposure";
import { seedFixtures, type Fixture } from "./sim/fixtures";
import { SimulatedNode, type SimulatedNodeOptions } from "./sim/node";
import { SimulatedWallet } from "./sim/wallet";

export interface SimBackend extends Backend {
  mode: "simulated";
  simNode: SimulatedNode;
  simDevice: SimulatedDevice;
  fixtures: Fixture[];
  clock: SimulatedNode;
}

/** The whole backend, simulated. Every piece carries the SIMULATED label in the UI. */
export function createSimBackend(options: SimulatedNodeOptions = {}): SimBackend {
  const node = new SimulatedNode(options);
  const device = new SimulatedDevice();
  const fixtures = seedFixtures(node);
  return {
    mode: "simulated",
    node,
    simNode: node,
    device,
    simDevice: device,
    wallet: new SimulatedWallet(),
    exposure: new SimulatedExposure(node),
    clock: node,
    fixtures,
  };
}
