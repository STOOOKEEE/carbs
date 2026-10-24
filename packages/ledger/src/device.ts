// A session with the XRP app of a Ledger, through the Device Management Kit only.
// Classical signing goes through the XRP signer kit; the ML-DSA instructions the kit
// does not know are sent as raw APDUs on the same session.

import {
  DeviceActionStatus,
  type DeviceActionState,
  type DeviceManagementKit,
  DeviceManagementKitBuilder,
  type DeviceSessionId,
  type ExecuteDeviceActionReturnType,
  type TransportFactory,
} from "@ledgerhq/device-management-kit";
import { type SignerXrp, SignerXrpBuilder } from "@ledgerhq/device-signer-kit-xrp";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, lastValueFrom } from "rxjs";

/** First account of the XRP app (BIP44 coin type 144). */
export const DEFAULT_XRP_PATH = "44'/144'/0'/0/0";
const SW_OK = 0x9000;

export interface LedgerAccount {
  address: string;
  /** Compressed secp256k1 public key, upper-case hex. */
  publicKey: string;
}

export interface ApduResponse {
  data: Uint8Array;
  status: number;
}

export interface LedgerXrp {
  account: LedgerAccount;
  /** Signs the signing fields (without the `STX\0` prefix, which the app adds) with the account key. */
  signTransaction(payload: Uint8Array): Promise<Uint8Array>;
  /** One raw APDU to the open XRP app. */
  exchange(apdu: Uint8Array): Promise<ApduResponse>;
  close(): Promise<void>;
}

/** Ledger status words worth explaining to the user. */
const STATUS_HINTS: Record<string, string> = {
  "6985": "refused on the device",
  "5515": "the device is locked",
  "6982": "the device is locked",
  "6d00": "the XRP app does not know this instruction (wrong app version?)",
  "6a80": "the XRP app refused the data",
  "6700": "the transaction is too large for the XRP app",
};

function statusWord(error: object): string | undefined {
  const code = Reflect.get(error, "errorCode");
  if (typeof code === "string") return code.toLowerCase();
  const original = Reflect.get(error, "originalError");
  return typeof original === "object" && original !== null ? statusWord(original) : undefined;
}

export function describeLedgerError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const code = statusWord(error);
  if (code !== undefined && STATUS_HINTS[code] !== undefined)
    return `${STATUS_HINTS[code]} (${code})`;
  const message = Reflect.get(error, "message");
  const tag = Reflect.get(error, "_tag");
  return [
    typeof tag === "string" ? tag : "Ledger error",
    code,
    typeof message === "string" ? message : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
}

async function settle<Output, Err, Intermediate>(
  action: ExecuteDeviceActionReturnType<Output, Err, Intermediate>,
): Promise<Output> {
  const state: DeviceActionState<Output, Err, Intermediate> = await lastValueFrom(
    action.observable,
  );
  if (state.status === DeviceActionStatus.Completed) return state.output;
  if (state.status === DeviceActionStatus.Error)
    throw new Error(`Ledger: ${describeLedgerError(state.error)}`);
  throw new Error(`Ledger: the action stopped without a result (${state.status})`);
}

async function openSession(
  dmk: DeviceManagementKit,
  sessionId: DeviceSessionId,
  signer: SignerXrp,
  path: string,
): Promise<LedgerXrp> {
  const { address, publicKey } = await settle(signer.getAddress(path));
  return {
    account: { address, publicKey: publicKey.toUpperCase() },
    signTransaction: (payload) => settle(signer.signTransaction(path, payload)),
    async exchange(apdu) {
      const response = await dmk.sendApdu({ sessionId, apdu });
      const [high = 0, low = 0] = response.statusCode;
      return { data: response.data, status: (high << 8) | low };
    },
    async close() {
      await dmk.disconnect({ sessionId });
      dmk.close();
    },
  };
}

/**
 * Connects to the first Ledger found and reads the XRP account at `path`.
 * In a browser, call it from a user gesture: WebHID opens the device picker.
 */
export async function connectLedger(
  transport: TransportFactory = webHidTransportFactory,
  path = DEFAULT_XRP_PATH,
): Promise<LedgerXrp> {
  const dmk = new DeviceManagementKitBuilder().addTransport(transport).build();
  let sessionId: DeviceSessionId | undefined;
  try {
    const device = await firstValueFrom(dmk.startDiscovering({}));
    await dmk.stopDiscovering();
    sessionId = await dmk.connect({ device });
    return await openSession(
      dmk,
      sessionId,
      new SignerXrpBuilder({ dmk, sessionId }).build(),
      path,
    );
  } catch (error) {
    if (sessionId !== undefined) await dmk.disconnect({ sessionId });
    dmk.close();
    throw error;
  }
}

/** Sends one APDU and returns its data; throws on any status other than 9000. */
export async function send(ledger: LedgerXrp, apdu: Uint8Array): Promise<Uint8Array> {
  const { data, status } = await ledger.exchange(apdu);
  if (status !== SW_OK) {
    const code = status.toString(16).padStart(4, "0");
    throw new Error(`Ledger: ${STATUS_HINTS[code] ?? "error"} (${code})`);
  }
  return data;
}
