/**
 * The simulated device of the live backend: the contract-following software double of
 * `@carbs/ledger` (APDU by APDU) with a random seed made in this page. **SIMULATED**: it is not
 * a Stax (the real one is `ledger-device.ts`). Reviews are shown by the page's simulated Stax
 * screen.
 */
import { generateClassicSeed, type Definitions } from "@carbs/sessions";
import { SimulatedDevice as ContractDevice } from "@carbs/ledger";
import type { DeviceApprover, DevicePort } from "../ports";
import { createContractDevice, deviceReview } from "./contract-device";

const DEVICE_SEED_BYTES = 64;

export const SIMULATED_DEVICE_MODEL =
  "SIMULATED Ledger Stax (software double of the device contract)";

export function createLiveDevice(defs: Definitions, approver: () => DeviceApprover): DevicePort {
  function makeTransport(): ContractDevice {
    return new ContractDevice({
      defs,
      bip39Seed: crypto.getRandomValues(new Uint8Array(DEVICE_SEED_BYTES)),
      classicSeeds: {
        secp256k1: generateClassicSeed("ecdsa-secp256k1"),
        ed25519: generateClassicSeed("ed25519"),
      },
      approve: (review) => approver()(deviceReview(review, true)),
    });
  }
  let transport = makeTransport();
  return createContractDevice({
    defs,
    mode: "simulated",
    model: SIMULATED_DEVICE_MODEL,
    simulated: true,
    transport: () => transport,
    onReset: () => {
      transport = makeTransport();
    },
  });
}
