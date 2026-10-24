import { p256 } from "@noble/curves/nist.js";
import { describe, expect, it } from "vitest";
import { bigIntToBytes, bytesToHex, hexToBytes, utf8ToBytes } from "./bytes.js";
import { kP256Order } from "./constants.js";
import {
  canonicalizeDer,
  decodeDer,
  encodeDer,
  isCanonicalP256Der,
  isLowS,
  normalizeLowS,
  p1363ToCanonicalDer,
  parseP1363,
  SignatureFormatError,
  toP1363,
} from "./der.js";

describe("low-S and strict DER for P-256", () => {
  it("replaces a high s by n − s and keeps a low s", () => {
    const high = { r: 5n, s: kP256Order - 3n };
    expect(normalizeLowS(high)).toEqual({ r: 5n, s: 3n });
    expect(normalizeLowS({ r: 5n, s: 3n })).toEqual({ r: 5n, s: 3n });
    expect(isLowS(kP256Order >> 1n)).toBe(true);
    expect(isLowS((kP256Order >> 1n) + 1n)).toBe(false);
  });

  it("refuses r or s out of range", () => {
    expect(() => normalizeLowS({ r: 0n, s: 1n })).toThrow(SignatureFormatError);
    expect(() => normalizeLowS({ r: 1n, s: kP256Order })).toThrow(SignatureFormatError);
  });

  it("writes minimal integers, with a 0x00 only before a high bit", () => {
    expect(bytesToHex(encodeDer({ r: 1n, s: 0x80n }))).toBe("3007020101020200" + "80");
    expect(bytesToHex(encodeDer({ r: 0x7fn, s: 0x0100n }))).toBe("300702017F02020100");
  });

  it("refuses non-strict DER", () => {
    // Non-minimal r (leading zero before a byte without the high bit).
    expect(() => decodeDer(hexToBytes("3008020200010202017F"))).toThrow(/not minimal/);
    // Negative s.
    expect(() => decodeDer(hexToBytes("3006020101020180"))).toThrow(/negative/);
    // Trailing byte.
    expect(() => decodeDer(hexToBytes("300602010102010100"))).toThrow(SignatureFormatError);
    // Wrong sequence length.
    expect(() => decodeDer(hexToBytes("3007020101020101"))).toThrow(/SEQUENCE length/);
  });

  it("matches noble's DER and verifies, for 200 signatures, high-S ones included", () => {
    const secretKey = p256.utils.randomSecretKey();
    const publicKey = p256.getPublicKey(secretKey, false);
    let sawHigh = false;
    for (let i = 0; i < 200; i += 1) {
      const message = utf8ToBytes(`message ${i}`);
      const raw = p256.sign(message, secretKey, { lowS: false });
      const parsed = parseP1363(raw);
      if (!isLowS(parsed.s)) sawHigh = true;
      const der = p1363ToCanonicalDer(raw);
      expect(isCanonicalP256Der(der)).toBe(true);
      const low = normalizeLowS(parsed);
      expect(bytesToHex(der)).toBe(
        bytesToHex(p256.Signature.fromBytes(toP1363(low)).toBytes("der")),
      );
      expect(p256.verify(der, message, publicKey, { format: "der", lowS: true })).toBe(true);
      expect(bytesToHex(canonicalizeDer(encodeDer(parsed)))).toBe(bytesToHex(der));
    }
    expect(sawHigh).toBe(true);
  });

  it("round-trips P1363", () => {
    const sig = { r: 123n, s: kP256Order - 1n };
    const raw = toP1363(sig);
    expect(raw.length).toBe(64);
    expect(parseP1363(raw)).toEqual(sig);
    expect(bytesToHex(raw.subarray(0, 32))).toBe(bytesToHex(bigIntToBytes(123n, 32)));
    expect(() => parseP1363(new Uint8Array(63))).toThrow(SignatureFormatError);
  });
});
