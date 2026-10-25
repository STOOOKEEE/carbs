/**
 * A real Ledger Stax over USB as the `DevicePort` of the live backend: the commands and signers
 * of `@carbs/ledger` on a `LedgerDevice` from `connectLedger()` (WebHID, Chrome, Edge, Brave).
 * The XRP app shows every review and takes every confirmation on the Stax itself; the page only
 * waits. Nothing here is simulated.
 */
import type { Definitions } from "@carbs/sessions";
import type { LedgerDevice, XrpTransport } from "@carbs/ledger";
import type { DevicePort } from "../ports";
import { createContractDevice, toDeviceError } from "./contract-device";

export const LEDGER_STAX_USB_MODEL = "Ledger Stax (USB)";

export function createLedgerDevicePort(defs: Definitions, transport: XrpTransport): DevicePort {
  return createContractDevice({
    defs,
    mode: "live",
    model: LEDGER_STAX_USB_MODEL,
    simulated: false,
    transport: () => transport,
  });
}

/** Ends the device session; a failure is described like any other device error. */
export async function closeLedgerDevice(device: LedgerDevice): Promise<void> {
  try {
    await device.close();
  } catch (error) {
    throw toDeviceError(error);
  }
}
