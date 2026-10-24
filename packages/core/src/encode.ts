/**
 * Transaction encoding with the node's definitions (FIANSO-SPEC.md sections 6.14, 8.2 and 8.4).
 *
 * - `encodeForSigning`: `STX\0 ‖ signing fields`, the data a WebCrypto, passkey or ML-DSA key signs.
 * - `encodeForDevice`: the signing fields **without** the prefix, as the Ledger app expects them
 *   (the app prepends `STX\0` itself); `SigningPubKey` must be set and `TxnSignature` absent.
 * - `encodeTx`: the full blob to submit.
 */

import { sha512 } from "@noble/hashes/sha2.js";
import {
  decode as codecDecode,
  encode as codecEncode,
  encodeForSigning as codecEncodeForSigning,
} from "ripple-binary-codec";
import { bytesToHex, concatBytes, equalBytes, hexToBytes } from "./bytes.js";
import { kTxIdPrefix, kTxSignPrefix } from "./constants.js";
import type { Definitions } from "./definitions.js";

/** A transaction in the JSON form the codec takes. */
export type TxJson = Record<string, unknown> & { TransactionType: string; Account: string };

export class EncodeError extends Error {
  override readonly name = "EncodeError";
}

/** The full serialized transaction (what `submit` takes), upper-case hex. */
export function encodeTx(tx: TxJson, defs: Definitions): string {
  return codecEncode(tx, defs.codec);
}

/** `STX\0 ‖ signing fields`: the bytes a single signature covers. */
export function encodeForSigning(tx: TxJson, defs: Definitions): Uint8Array {
  const bytes = hexToBytes(codecEncodeForSigning(tx, defs.codec));
  if (!equalBytes(bytes.subarray(0, kTxSignPrefix.length), kTxSignPrefix)) {
    throw new EncodeError("the codec did not prefix the signing data with STX\\0");
  }
  return bytes;
}

/**
 * The bytes the Ledger app expects: the signing fields without the `STX\0` prefix.
 * Refuses a transaction without `SigningPubKey` or with a `TxnSignature`.
 */
export function encodeForDevice(tx: TxJson, defs: Definitions): Uint8Array {
  if (typeof tx["SigningPubKey"] !== "string" || tx["SigningPubKey"].length === 0) {
    throw new EncodeError("the device signs a transaction whose SigningPubKey is set");
  }
  if (tx["TxnSignature"] !== undefined) {
    throw new EncodeError("the device signs a transaction without TxnSignature");
  }
  return encodeForSigning(tx, defs).subarray(kTxSignPrefix.length);
}

/** Decode a serialized transaction with these definitions. */
export function decodeTx(blob: string, defs: Definitions): Record<string, unknown> {
  return codecDecode(blob, defs.codec);
}

/** SHA-512Half. */
export function sha512Half(bytes: Uint8Array): Uint8Array {
  return sha512(bytes).subarray(0, 32);
}

/** Transaction id of a signed blob: `SHA512Half(TXN\0 ‖ blob)`. */
export function transactionHash(blob: string): string {
  return bytesToHex(sha512Half(concatBytes(kTxIdPrefix, hexToBytes(blob))));
}
