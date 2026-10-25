/**
 * The live backend: a node that carries the amendment, reached on its public port, with
 * real keys and the node's own definitions. The device is the person's choice
 * (`device-selection.ts`): the SIMULATED software double of the device contract (the default)
 * or a real Ledger Stax over USB. Created asynchronously, since it asks the node
 * for its definitions first; a node that cannot be reached or does not serve the
 * SigningSessions names is refused with the reason, and the app stays on the simulation.
 */
import {
  addressFromPublicKey,
  classicSignerFromSeed,
  generateClassicSeed,
  loadDefinitions,
  type NodeClient,
} from "@carbs/sessions";
import type { AppNetwork } from "../networks";
import type { Backend, DeviceApprover, ExposurePort } from "../ports";
import type { PasskeySource } from "../wallets/adapters";
import { createLiveBuilders } from "./builders";
import { createLiveDevice } from "./device";
import {
  createDeviceSelection,
  createSelectableDevice,
  type DeviceSelection,
} from "./device-selection";
import { LiveNode } from "./node";
import { LiveWallet } from "./wallet";

export interface LiveBackendOptions {
  client: NodeClient;
  network: () => AppNetwork;
  /** The simulated Stax screen, looked up at call time. */
  approver: () => DeviceApprover;
  /** Simulated device or real Stax; without it, the simulated device. */
  device?: DeviceSelection;
  passkeys: PasskeySource;
  exposure: ExposurePort;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

function counterparty(): string {
  return addressFromPublicKey(
    classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1")).publicKey,
  );
}

export async function createLiveBackend(options: LiveBackendOptions): Promise<Backend> {
  // The sessions screens need a node that serves the SigningSessions names.
  const defs = await loadDefinitions(options.client, { requireSessions: true });
  const node = new LiveNode({
    client: options.client,
    defs,
    network: options.network,
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  });
  return {
    mode: "live",
    node,
    device: createSelectableDevice(
      options.device ?? createDeviceSelection(),
      createLiveDevice(defs, options.approver),
      defs,
    ),
    wallet: new LiveWallet(defs, options.passkeys),
    exposure: options.exposure,
    builders: createLiveBuilders(defs),
    counterparties: { sink: counterparty(), victim: counterparty() },
    fixtures: [],
    clock: null,
  };
}
