/**
 * The subset of CBOR (RFC 8949) WebAuthn needs: the `attestationObject` of a registration and the
 * COSE key in its `authenticatorData`. Definite lengths only (CTAP2 canonical CBOR has no
 * indefinite lengths); unsigned and negative integers, byte and text strings, arrays, maps, tags,
 * `false`, `true`, `null` and `undefined`. Floats and integers beyond 2^53 are refused.
 *
 * The encoder is for the software authenticator of the tests: it writes CTAP2's canonical form
 * (shortest lengths, map keys in the order given, which the caller keeps canonical).
 */

export type CborValue =
  number | Uint8Array | string | boolean | null | undefined | CborValue[] | CborMap | CborTag;

/** A CBOR map; keys are integers or text strings (all that WebAuthn and COSE use). */
export type CborMap = Map<number | string, CborValue>;

export interface CborTag {
  tag: number;
  value: CborValue;
}

export class CborError extends Error {
  override readonly name = "CborError";
}

const kMajorUnsigned = 0;
const kMajorNegative = 1;
const kMajorBytes = 2;
const kMajorText = 3;
const kMajorArray = 4;
const kMajorMap = 5;
const kMajorTag = 6;
const kMajorSimple = 7;

const kSimpleFalse = 20;
const kSimpleTrue = 21;
const kSimpleNull = 22;
const kSimpleUndefined = 23;

/** Additional info values: the argument follows in 1, 2, 4 or 8 bytes. */
const kInfoOneByte = 24;
const kInfoTwoBytes = 25;
const kInfoFourBytes = 26;
const kInfoEightBytes = 27;

/** Nesting deeper than this is refused (WebAuthn structures are three levels deep). */
const kMaxDepth = 16;

class Reader {
  offset: number;
  readonly bytes: Uint8Array;
  readonly view: DataView;

  constructor(bytes: Uint8Array, offset: number) {
    this.bytes = bytes;
    this.offset = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(length: number): void {
    if (this.offset + length > this.bytes.length) throw new CborError("truncated CBOR");
  }

  byte(): number {
    this.need(1);
    const value = this.bytes[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  take(length: number): Uint8Array {
    this.need(length);
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  argument(info: number): number {
    if (info < kInfoOneByte) return info;
    let value: number;
    switch (info) {
      case kInfoOneByte:
        value = this.byte();
        break;
      case kInfoTwoBytes:
        this.need(2);
        value = this.view.getUint16(this.offset);
        this.offset += 2;
        break;
      case kInfoFourBytes:
        this.need(4);
        value = this.view.getUint32(this.offset);
        this.offset += 4;
        break;
      case kInfoEightBytes: {
        this.need(8);
        const big = this.view.getBigUint64(this.offset);
        this.offset += 8;
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new CborError("CBOR integer too large");
        value = Number(big);
        break;
      }
      default:
        throw new CborError("indefinite or reserved CBOR length");
    }
    return value;
  }

  item(depth: number): CborValue {
    if (depth > kMaxDepth) throw new CborError("CBOR nested too deeply");
    const initial = this.byte();
    const major = initial >> 5;
    const info = initial & 0x1f;
    if (major === kMajorSimple) {
      switch (info) {
        case kSimpleFalse:
          return false;
        case kSimpleTrue:
          return true;
        case kSimpleNull:
          return null;
        case kSimpleUndefined:
          return undefined;
        default:
          throw new CborError("unsupported CBOR simple value or float");
      }
    }
    const argument = this.argument(info);
    switch (major) {
      case kMajorUnsigned:
        return argument;
      case kMajorNegative:
        return -1 - argument;
      case kMajorBytes:
        return this.take(argument);
      case kMajorText:
        return new TextDecoder("utf-8", { fatal: true }).decode(this.take(argument));
      case kMajorArray: {
        const out: CborValue[] = [];
        for (let i = 0; i < argument; i += 1) out.push(this.item(depth + 1));
        return out;
      }
      case kMajorMap: {
        const out: CborMap = new Map();
        for (let i = 0; i < argument; i += 1) {
          const key = this.item(depth + 1);
          if (typeof key !== "number" && typeof key !== "string") {
            throw new CborError("CBOR map key is not an integer or a text string");
          }
          if (out.has(key)) throw new CborError(`duplicate CBOR map key ${String(key)}`);
          out.set(key, this.item(depth + 1));
        }
        return out;
      }
      case kMajorTag:
        return { tag: argument, value: this.item(depth + 1) };
      default:
        throw new CborError("unknown CBOR major type");
    }
  }
}

/**
 * Decode one CBOR item starting at `offset`; returns it and the offset just past it (the COSE key
 * in `authenticatorData` is followed by the extensions, so the caller needs where it ends).
 */
export function decodeCborItem(bytes: Uint8Array, offset = 0): { value: CborValue; end: number } {
  const reader = new Reader(bytes, offset);
  const value = reader.item(0);
  return { value, end: reader.offset };
}

/** Decode a buffer that holds exactly one CBOR item. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value, end } = decodeCborItem(bytes);
  if (end !== bytes.length) throw new CborError("trailing bytes after the CBOR item");
  return value;
}

export function isCborMap(value: CborValue): value is CborMap {
  return value instanceof Map;
}

function head(major: number, argument: number): Uint8Array {
  if (!Number.isSafeInteger(argument) || argument < 0) {
    throw new CborError("CBOR argument out of range");
  }
  if (argument < kInfoOneByte) return Uint8Array.of((major << 5) | argument);
  if (argument <= 0xff) return Uint8Array.of((major << 5) | kInfoOneByte, argument);
  if (argument <= 0xffff) {
    return Uint8Array.of((major << 5) | kInfoTwoBytes, argument >> 8, argument & 0xff);
  }
  if (argument <= 0xffffffff) {
    const out = new Uint8Array(5);
    out[0] = (major << 5) | kInfoFourBytes;
    new DataView(out.buffer).setUint32(1, argument);
    return out;
  }
  const out = new Uint8Array(9);
  out[0] = (major << 5) | kInfoEightBytes;
  new DataView(out.buffer).setBigUint64(1, BigInt(argument));
  return out;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Encode a value (shortest-form lengths; map entries in insertion order). */
export function encodeCbor(value: CborValue): Uint8Array {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new CborError("only safe integers are encoded");
    return value >= 0 ? head(kMajorUnsigned, value) : head(kMajorNegative, -1 - value);
  }
  if (value instanceof Uint8Array) return join([head(kMajorBytes, value.length), value]);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return join([head(kMajorText, bytes.length), bytes]);
  }
  if (value === false) return Uint8Array.of((kMajorSimple << 5) | kSimpleFalse);
  if (value === true) return Uint8Array.of((kMajorSimple << 5) | kSimpleTrue);
  if (value === null) return Uint8Array.of((kMajorSimple << 5) | kSimpleNull);
  if (value === undefined) return Uint8Array.of((kMajorSimple << 5) | kSimpleUndefined);
  if (Array.isArray(value)) {
    return join([head(kMajorArray, value.length), ...value.map((v) => encodeCbor(v))]);
  }
  if (value instanceof Map) {
    const parts = [head(kMajorMap, value.size)];
    for (const [k, v] of value) parts.push(encodeCbor(k), encodeCbor(v));
    return join(parts);
  }
  return join([head(kMajorTag, value.tag), encodeCbor(value.value)]);
}
