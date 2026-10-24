/**
 * The APDU contract between the client and the XRP app of this repository (`docs/device-contract.md`).
 * Every number here is read from the device track's code, cited next to it.
 */

/** `ledger-app/src/apdu/constants.h:22-33`. */
export const kCla = 0xe0;
export const kInsGetPublicKey = 0x02;
export const kInsSign = 0x04;
export const kInsGetAppConfiguration = 0x06;
export const kP1Confirm = 0x01;
export const kP1NonConfirm = 0x00;
export const kP2NoChainCode = 0x00;
export const kP2ChainCode = 0x01;
/** `INS_SIGN` P1: bit 0 set on every chunk but the first, bit 7 set while more chunks follow. */
export const kP1MaskOrder = 0x01;
export const kP1MaskMore = 0x80;
export const kP2Secp256k1 = 0x40;
export const kP2Ed25519 = 0x80;

/** ML-DSA-44 root key instructions, `ledger-app/src/pq/pq_root.h:12-14`. */
export const kInsPqGetPublicKey = 0x10;
export const kInsPqSign = 0x11;
export const kInsPqGetSignature = 0x12;
/** `INS_PQ_SIGN` P1 / P2 (`ledger-app/src/pq/pq_root.c:164-181`). */
export const kPqP1First = 0x00;
export const kPqP1Next = 0x01;
export const kPqP2More = 0x00;
export const kPqP2Last = 0x01;
/** Chunk size of the public key and signature answers (`ledger-app/src/pq/pq_root.c:43`). */
export const kPqChunk = 250;
/** Largest signing data the device signs with ML-DSA, prefix and key included (`ledger-app/src/apdu/global.h:71`). */
export const kPqMaxMessage = 2048;

/** Largest data field of one short APDU. */
export const kApduMaxData = 255;
/** Largest classical transaction the app buffers, prefix included (`ledger-app/src/limitations.h:35`). */
export const kMaxRawTx = 10000;
/** Hardened BIP32 index bit. */
export const kHardened = 0x80000000;

/** Status words the app sends (`ledger-app/src/pq/pq_root.c:47-53`, `ledger-app/src/apdu/entry.c:37`, `:67`). */
export const kSw = {
  ok: 0x9000,
  denied: 0x6985,
  wrongLength: 0x6700,
  wrongData: 0x6a80,
  invalidPath: 0x6a81,
  wrongP1P2: 0x6b00,
  noSignature: 0x6982,
  internal: 0x6f00,
  insNotSupported: 0x6d00,
  claNotSupported: 0x6e00,
} as const;

const kSwNames = new Map<number, string>(Object.entries(kSw).map(([name, sw]) => [sw, name]));

export interface Apdu {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data: Uint8Array;
}

export interface ApduResponse {
  data: Uint8Array;
  statusWord: number;
}

/** Anything that exchanges one APDU with the device. */
export interface ApduTransport {
  exchange(apdu: Apdu): Promise<ApduResponse>;
}

export class DeviceError extends Error {
  override readonly name = "DeviceError";
  constructor(
    readonly statusWord: number,
    readonly ins: number,
  ) {
    super(
      `device answered 0x${statusWord.toString(16).padStart(4, "0")} (${kSwNames.get(statusWord) ?? (statusWord >> 8 === 0x68 ? "parse error" : "unknown")}) to INS 0x${ins.toString(16).padStart(2, "0")}`,
    );
  }
}

/** `CLA INS P1 P2 Lc data`. */
export function encodeApdu(apdu: Apdu): Uint8Array {
  if (apdu.data.length > kApduMaxData) throw new RangeError("APDU data longer than 255 bytes");
  const out = new Uint8Array(5 + apdu.data.length);
  out.set([apdu.cla, apdu.ins, apdu.p1, apdu.p2, apdu.data.length]);
  out.set(apdu.data, 5);
  return out;
}

export function decodeApdu(bytes: Uint8Array): Apdu {
  if (bytes.length < 5) throw new RangeError("APDU shorter than its header");
  const length = bytes[4] ?? 0;
  if (bytes.length !== 5 + length) throw new RangeError("APDU length does not match Lc");
  return {
    cla: bytes[0] ?? 0,
    ins: bytes[1] ?? 0,
    p1: bytes[2] ?? 0,
    p2: bytes[3] ?? 0,
    data: bytes.slice(5),
  };
}

/** Exchange and throw a `DeviceError` unless the status word is 0x9000. */
export async function exchangeOk(transport: ApduTransport, apdu: Apdu): Promise<Uint8Array> {
  const response = await transport.exchange(apdu);
  if (response.statusWord !== kSw.ok) throw new DeviceError(response.statusWord, apdu.ins);
  return response.data;
}

/** `44'/144'/0'/0/0` → `[count] [4 bytes big-endian each]`, as `parse_bip32_path` reads it. */
export function encodeBip32Path(path: string): Uint8Array {
  const parts = path.replace(/^m\//, "").split("/");
  const out = new Uint8Array(1 + 4 * parts.length);
  out[0] = parts.length;
  const view = new DataView(out.buffer);
  parts.forEach((part, i) => {
    const hardened = part.endsWith("'") || part.endsWith("h");
    const index = Number.parseInt(hardened ? part.slice(0, -1) : part, 10);
    if (!Number.isInteger(index) || index < 0 || index >= kHardened)
      throw new RangeError(`bad path element ${part}`);
    view.setUint32(1 + 4 * i, hardened ? (index | kHardened) >>> 0 : index);
  });
  return out;
}

/**
 * The Device Management Kit's `sendApdu` (`@ledgerhq/device-management-kit` 1.11.0,
 * `lib/types/src/api/DeviceManagementKit.d.ts:85`, args `lib/types/src/internal/send/use-case/SendApduUseCase.d.ts:8-16`,
 * answer `lib/types/src/api/device-session/ApduResponse.d.ts`): the only DMK call this package needs.
 */
export interface DmkApduSender {
  sendApdu(args: {
    sessionId: string;
    apdu: Uint8Array;
  }): Promise<{ statusCode: Uint8Array; data: Uint8Array }>;
}

/** An `ApduTransport` over a DMK device session (WebHID in the browser). */
export function dmkTransport(dmk: DmkApduSender, sessionId: string): ApduTransport {
  return {
    async exchange(apdu) {
      const response = await dmk.sendApdu({ sessionId, apdu: encodeApdu(apdu) });
      const [hi = 0, lo = 0] = response.statusCode;
      return { data: response.data, statusWord: (hi << 8) | lo };
    },
  };
}

/**
 * The raw exchange of the device track's DMK session (`LedgerXrp.exchange` of
 * `packages/ledger/src/device.ts` on `STOOOKEEE/n1-passkey-challenge-fix`): bytes in, data and
 * status word out.
 */
export type RawExchange = (apdu: Uint8Array) => Promise<{ data: Uint8Array; status: number }>;

/** An `ApduTransport` over a raw exchange. */
export function rawTransport(exchange: RawExchange): ApduTransport {
  return {
    async exchange(apdu) {
      const { data, status } = await exchange(encodeApdu(apdu));
      return { data, statusWord: status };
    },
  };
}

/** A raw exchange over an `ApduTransport` (for example the simulated device). */
export function rawExchangeOf(transport: ApduTransport): RawExchange {
  return async (bytes) => {
    const { data, statusWord } = await transport.exchange(decodeApdu(bytes));
    return { data, status: statusWord };
  };
}
