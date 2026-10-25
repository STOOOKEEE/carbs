/**
 * A real Ledger: a Device Management Kit session and the extended XRP signer kit bound to it, so
 * the commands and signers of this package run on the device through the kit. The WebHID
 * connection is `src/webhid.ts`.
 */

import type { SignerXrp } from "@carbs/device-signer-kit-xrp";
import { dmkTransport, type DmkApduSender } from "./apdu.js";
import type { XrpTransport } from "./kit.js";

/** First account of the XRP app (BIP44 coin type 144). */
export const kDefaultXrpPath = "44'/144'/0'/0/0";

/**
 * A connected device: the kit's signer for the commands, raw APDUs to the open XRP app, then
 * `close` once done.
 */
export interface LedgerDevice extends XrpTransport {
  close(): Promise<void>;
}

/** The DMK calls a device session needs; `DeviceManagementKit` 1.11.0 satisfies it as it is. */
export interface DmkSession extends DmkApduSender {
  disconnect(args: { sessionId: string }): Promise<void>;
  close(): void;
}

/**
 * A device over a DMK session. With `signer` (the kit built on the same session, as
 * `connectLedger` does), the commands go through `dmk.executeDeviceAction`; without it, they
 * run the kit's device actions over `sendApdu`.
 */
export function ledgerDevice(dmk: DmkSession, sessionId: string, signer?: SignerXrp): LedgerDevice {
  const transport = dmkTransport(dmk, sessionId);
  return {
    exchange: (apdu) => transport.exchange(apdu),
    signer,
    async close() {
      await dmk.disconnect({ sessionId });
      dmk.close();
    },
  };
}
