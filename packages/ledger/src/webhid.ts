/** The WebHID connection to a Ledger, through the Device Management Kit only. */

import { SignerXrpBuilder } from "@carbs/device-signer-kit-xrp";
import { DeviceManagementKitBuilder, type TransportFactory } from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom } from "rxjs";
import { ledgerDevice, type LedgerDevice } from "./device.js";

/**
 * Connects to the first Ledger found and binds Ledger's XRP signer kit, extended for this
 * repository's app, to its session. In a browser, call it from a user gesture: WebHID opens the
 * device picker. The XRP app must be open for the commands to answer.
 */
export async function connectLedger(
  transport: TransportFactory = webHidTransportFactory,
): Promise<LedgerDevice> {
  const dmk = new DeviceManagementKitBuilder().addTransport(transport).build();
  try {
    const device = await firstValueFrom(dmk.startDiscovering({}));
    await dmk.stopDiscovering();
    const sessionId = await dmk.connect({ device });
    return ledgerDevice(dmk, sessionId, new SignerXrpBuilder({ dmk, sessionId }).build());
  } catch (error) {
    dmk.close();
    throw error;
  }
}
