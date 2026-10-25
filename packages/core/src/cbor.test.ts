import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./bytes.js";
import { CborError, decodeCbor, decodeCborItem, encodeCbor, type CborValue } from "./cbor.js";

// RFC 8949 appendix A vectors.
const kVectors: [string, CborValue][] = [
  ["00", 0],
  ["17", 23],
  ["1818", 24],
  ["190100", 256],
  ["1a000f4240", 1_000_000],
  ["1b000000e8d4a51000", 1_000_000_000_000],
  ["20", -1],
  ["3863", -100],
  ["382f", -48],
  ["40", new Uint8Array()],
  ["4401020304", Uint8Array.of(1, 2, 3, 4)],
  ["6449455446", "IETF"],
  ["83010203", [1, 2, 3]],
  ["f4", false],
  ["f5", true],
  ["f6", null],
  ["f7", undefined],
];

describe("CBOR (RFC 8949 subset)", () => {
  it("decodes and re-encodes the RFC 8949 vectors", () => {
    for (const [hex, value] of kVectors) {
      expect(decodeCbor(hexToBytes(hex))).toEqual(value);
      expect(bytesToHex(encodeCbor(value))).toBe(hex.toUpperCase());
    }
  });

  it("decodes maps with integer and text keys, and tags", () => {
    const map = decodeCbor(hexToBytes("a201020304"));
    expect(map).toEqual(
      new Map([
        [1, 2],
        [3, 4],
      ]),
    );
    expect(decodeCbor(hexToBytes("c11a514b67b0"))).toEqual({ tag: 1, value: 1363896240 });
    const nested = new Map<string | number, CborValue>([
      ["fmt", "packed"],
      ["attStmt", new Map<string, CborValue>([["x5c", [Uint8Array.of(9)]]])],
      [-1, new Uint8Array(1312)],
    ]);
    expect(decodeCbor(encodeCbor(nested))).toEqual(nested);
  });

  it("uses the shortest length for each size boundary", () => {
    for (const [length, header] of [
      [23, "57"],
      [24, "5818"],
      [255, "58ff"],
      [256, "590100"],
      [1312, "590520"],
      [65_536, "5a00010000"],
    ] as const) {
      const encoded = encodeCbor(new Uint8Array(length));
      expect(bytesToHex(encoded.subarray(0, header.length / 2))).toBe(header.toUpperCase());
      expect(encoded.length).toBe(header.length / 2 + length);
    }
  });

  it("returns where an item ends, for the COSE key inside authenticatorData", () => {
    const bytes = hexToBytes("8201020304");
    expect(decodeCborItem(bytes)).toEqual({ value: [1, 2], end: 3 });
    expect(decodeCborItem(bytes, 3)).toEqual({ value: 3, end: 4 });
  });

  it("refuses indefinite lengths, floats, truncation, trailing bytes and duplicate keys", () => {
    for (const hex of [
      "5f4101ff", // indefinite byte string
      "9f01ff", // indefinite array
      "f97c00", // half float
      "fb3ff199999999999a", // double
      "590520", // truncated byte string
      "1b0020000000000000", // above 2^53
      "a201020103", // duplicate key
      "a1f601", // null as a map key
      "0000", // trailing byte
      "1c", // reserved additional information
    ]) {
      expect(() => decodeCbor(hexToBytes(hex)), hex).toThrow(CborError);
    }
  });
});
