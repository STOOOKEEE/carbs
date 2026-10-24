/**
 * ECDSA signature formats for P-256 (FIANSO-SPEC.md sections 6.14 and 8.3).
 *
 * WebCrypto returns `r ‖ s` (IEEE P1363). The node takes DER. The node does not enforce low-S for
 * P-256, so the client normalizes every signature to low-S and writes strict (minimal) DER: a
 * signature then has one encoding, which keeps the transaction id stable.
 */

import { bigIntToBytes, bytesToBigInt, concatBytes } from "./bytes.js";
import { kP256Order, kP256ScalarLength } from "./constants.js";

const kDerSequenceTag = 0x30;
const kDerIntegerTag = 0x02;
const kDerHighBit = 0x80;
/** Longest DER body that still uses a one-byte length. */
const kDerShortLengthMax = 0x7f;

export class SignatureFormatError extends Error {
  override readonly name = "SignatureFormatError";
}

export interface EcdsaSignature {
  r: bigint;
  s: bigint;
}

export function isLowS(s: bigint, order: bigint = kP256Order): boolean {
  return s > 0n && s <= order >> 1n;
}

/** Replace `s` by `n − s` when it is in the upper half of the group order. */
export function normalizeLowS(sig: EcdsaSignature, order: bigint = kP256Order): EcdsaSignature {
  if (sig.r <= 0n || sig.r >= order || sig.s <= 0n || sig.s >= order) {
    throw new SignatureFormatError("r or s out of range");
  }
  return sig.s > order >> 1n ? { r: sig.r, s: order - sig.s } : sig;
}

/** Parse WebCrypto's `r ‖ s` (64 bytes for P-256). */
export function parseP1363(
  raw: Uint8Array,
  scalarLength: number = kP256ScalarLength,
): EcdsaSignature {
  if (raw.length !== 2 * scalarLength) {
    throw new SignatureFormatError(`expected ${2 * scalarLength} bytes, got ${raw.length}`);
  }
  return {
    r: bytesToBigInt(raw.subarray(0, scalarLength)),
    s: bytesToBigInt(raw.subarray(scalarLength)),
  };
}

export function toP1363(sig: EcdsaSignature, scalarLength: number = kP256ScalarLength): Uint8Array {
  return concatBytes(bigIntToBytes(sig.r, scalarLength), bigIntToBytes(sig.s, scalarLength));
}

function minimalInteger(value: bigint): Uint8Array {
  let length = 1;
  while (value >> BigInt(8 * length) > 0n) length += 1;
  const bytes = bigIntToBytes(value, length);
  return (bytes[0] ?? 0) & kDerHighBit ? concatBytes(Uint8Array.of(0), bytes) : bytes;
}

/** Strict DER: `30 len 02 lenR R 02 lenS S`, minimal integers, short-form lengths. */
export function encodeDer(sig: EcdsaSignature): Uint8Array {
  const r = minimalInteger(sig.r);
  const s = minimalInteger(sig.s);
  const body = concatBytes(
    Uint8Array.of(kDerIntegerTag, r.length),
    r,
    Uint8Array.of(kDerIntegerTag, s.length),
    s,
  );
  if (body.length > kDerShortLengthMax) throw new SignatureFormatError("signature too long");
  return concatBytes(Uint8Array.of(kDerSequenceTag, body.length), body);
}

function readInteger(der: Uint8Array, offset: number): { value: bigint; next: number } {
  if (der[offset] !== kDerIntegerTag) throw new SignatureFormatError("expected an INTEGER");
  const length = der[offset + 1];
  if (length === undefined || length === 0 || length > kDerShortLengthMax) {
    throw new SignatureFormatError("bad INTEGER length");
  }
  const start = offset + 2;
  const bytes = der.subarray(start, start + length);
  if (bytes.length !== length) throw new SignatureFormatError("truncated INTEGER");
  const first = bytes[0] ?? 0;
  if (first & kDerHighBit) throw new SignatureFormatError("negative INTEGER");
  if (first === 0 && length > 1 && !((bytes[1] ?? 0) & kDerHighBit)) {
    throw new SignatureFormatError("INTEGER is not minimal");
  }
  return { value: bytesToBigInt(bytes), next: start + length };
}

/** Parse strict DER; throws on any non-minimal or trailing byte. */
export function decodeDer(der: Uint8Array): EcdsaSignature {
  if (der[0] !== kDerSequenceTag) throw new SignatureFormatError("expected a SEQUENCE");
  const length = der[1];
  if (length === undefined || length > kDerShortLengthMax || length !== der.length - 2) {
    throw new SignatureFormatError("bad SEQUENCE length");
  }
  const r = readInteger(der, 2);
  const s = readInteger(der, r.next);
  if (s.next !== der.length) throw new SignatureFormatError("trailing bytes");
  return { r: r.value, s: s.value };
}

/** True for strict DER with `r`, `s` in range and low-S. */
export function isCanonicalP256Der(der: Uint8Array): boolean {
  try {
    const sig = decodeDer(der);
    return sig.r > 0n && sig.r < kP256Order && isLowS(sig.s);
  } catch {
    return false;
  }
}

/** WebCrypto `r ‖ s` → low-S → strict DER, the form of `TxnSignature` for a P-256 key. */
export function p1363ToCanonicalDer(raw: Uint8Array): Uint8Array {
  return encodeDer(normalizeLowS(parseP1363(raw)));
}

/** Any DER P-256 signature (a passkey may return high-S) → low-S strict DER. */
export function canonicalizeDer(der: Uint8Array): Uint8Array {
  return encodeDer(normalizeLowS(decodeDer(der)));
}
