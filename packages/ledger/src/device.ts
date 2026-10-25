/**
 * A real Ledger as an `ApduTransport`: a Device Management Kit session, so the commands and
 * signers of this package run on the device unchanged. The WebHID connection is `src/webhid.ts`.
 */

import { dmkTransport, type ApduTransport, type DmkApduSender } from "./apdu.js";

/** First account of the XRP app (BIP44 coin type 144). */
export const kDefaultXrpPath = "44'/144'/0'/0/0";

/** A connected device: APDUs to the open XRP app, then `close` once done. */
export interface LedgerDevice extends ApduTransport {
  close(): Promise<void>;
}

/** The DMK calls a device session needs; `DeviceManagementKit` 1.11.0 satisfies it as it is. */
export interface DmkSession extends DmkApduSender {
  disconnect(args: { sessionId: string }): Promise<void>;
  close(): void;
}

export function ledgerDevice(dmk: DmkSession, sessionId: string): LedgerDevice {
  const transport = dmkTransport(dmk, sessionId);
  return {
    exchange: (apdu) => transport.exchange(apdu),
    async close() {
      await dmk.disconnect({ sessionId });
      dmk.close();
    },
  };
}
