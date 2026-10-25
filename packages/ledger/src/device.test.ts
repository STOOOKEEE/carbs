import {
  bytesToHex,
  kMlDsa44PublicKeyLength,
  kMlDsa44SignatureLength,
  kTxSignPrefix,
} from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import {
  DeviceError,
  kInsPqGetPublicKey,
  kInsPqGetSignature,
  kInsPqSign,
  kPqChunk,
  kPqP2Last,
  kSw,
  type ApduResponse,
} from "./apdu.js";
import { getMlDsaPublicKey, signMlDsa } from "./commands.js";
import { ledgerDevice, type DmkSession } from "./device.js";
import { describeLedgerError } from "./ledger-error.js";

const kSessionId = "session-1";
/** Long enough for three `0x11` chunks: 255, 255, then 90 bytes. */
const kSigningDataLength = 600;

/** The app's answers to the ML-DSA instructions (`ledger-app/src/pq/pq_root.c`), by raw bytes. */
function pqAnswer(apdu: Uint8Array): ApduResponse {
  const [, ins = 0, p1 = 0, p2 = 0] = apdu;
  const chunkOf = (total: number) =>
    new Uint8Array(Math.min(kPqChunk, total - p1 * kPqChunk)).fill(p1);
  switch (ins) {
    case kInsPqGetPublicKey:
      return { data: chunkOf(kMlDsa44PublicKeyLength), statusWord: kSw.ok };
    case kInsPqSign: {
      const length = Uint8Array.of(kMlDsa44SignatureLength >> 8, kMlDsa44SignatureLength & 0xff);
      return { data: p2 === kPqP2Last ? length : new Uint8Array(), statusWord: kSw.ok };
    }
    case kInsPqGetSignature:
      return { data: chunkOf(kMlDsa44SignatureLength), statusWord: kSw.ok };
    default:
      return { data: new Uint8Array(), statusWord: kSw.insNotSupported };
  }
}

/** A DMK double: records the raw APDUs and answers with `statusCode` bytes, as `sendApdu` does. */
function fakeDmk(answer: (apdu: Uint8Array) => ApduResponse) {
  const sent: Uint8Array[] = [];
  const calls: string[] = [];
  const dmk: DmkSession = {
    async sendApdu({ sessionId, apdu }) {
      expect(sessionId).toBe(kSessionId);
      sent.push(apdu);
      const { data, statusWord } = answer(apdu);
      return { data, statusCode: Uint8Array.of(statusWord >> 8, statusWord & 0xff) };
    },
    async disconnect({ sessionId }) {
      calls.push(`disconnect ${sessionId}`);
    },
    close() {
      calls.push("close");
    },
  };
  return { dmk, sent, calls };
}

function signingData(): Uint8Array {
  const data = new Uint8Array(kSigningDataLength).fill(0xab);
  data.set(kTxSignPrefix);
  return data;
}

describe("a Ledger over the Device Management Kit (fake DMK)", () => {
  it("reads the ML-DSA public key in 250-byte chunks, one E0 10 <index> 00 00 each", async () => {
    const { dmk, sent } = fakeDmk(pqAnswer);
    const publicKey = await getMlDsaPublicKey(ledgerDevice(dmk, kSessionId));
    expect(publicKey.length).toBe(kMlDsa44PublicKeyLength);
    expect(sent.map(bytesToHex)).toEqual(
      ["00", "01", "02", "03", "04", "05"].map((p1) => `E010${p1}0000`),
    );
    expect(publicKey[kPqChunk * 5]).toBe(5);
  });

  it("frames 0x11 as 255-byte chunks, P1 first/next, P2 last on the final one, then reads 0x12", async () => {
    const { dmk, sent } = fakeDmk(pqAnswer);
    const data = signingData();
    const signature = await signMlDsa(ledgerDevice(dmk, kSessionId), data);
    expect(signature.length).toBe(kMlDsa44SignatureLength);
    const signs = sent.filter((apdu) => apdu[1] === kInsPqSign);
    expect(signs.map((apdu) => bytesToHex(apdu.slice(0, 5)))).toEqual([
      "E0110000FF",
      "E0110100FF",
      "E01101015A",
    ]);
    expect(bytesToHex(Uint8Array.from(signs.flatMap((apdu) => [...apdu.slice(5)])))).toBe(
      bytesToHex(data),
    );
    const reads = sent.filter((apdu) => apdu[1] === kInsPqGetSignature);
    expect(reads.map(bytesToHex)).toEqual(
      ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09"].map((p1) => `E012${p1}0000`),
    );
  });

  it("turns a status word other than 9000 into a DeviceError and a message for the user", async () => {
    const { dmk } = fakeDmk(() => ({ data: new Uint8Array(), statusWord: kSw.denied }));
    const error: unknown = await signMlDsa(ledgerDevice(dmk, kSessionId), signingData()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeviceError);
    expect(error).toMatchObject({ statusWord: kSw.denied, ins: kInsPqSign });
    expect(describeLedgerError(error)).toBe("refused on the device (0x6985)");
  });

  it("disconnects the session, then closes the kit", async () => {
    const { dmk, calls } = fakeDmk(pqAnswer);
    await ledgerDevice(dmk, kSessionId).close();
    expect(calls).toEqual([`disconnect ${kSessionId}`, "close"]);
  });
});

describe("describeLedgerError", () => {
  it("explains the status word of a DMK error, its own or the one it wraps", () => {
    expect(
      describeLedgerError({ _tag: "DeviceLockedError", errorCode: "5515", message: "x" }),
    ).toBe("the device is locked (0x5515)");
    expect(
      describeLedgerError({ _tag: "UnknownDAError", originalError: { errorCode: "6D00" } }),
    ).toBe("the XRP app does not know this instruction (wrong app version?) (0x6d00)");
  });

  it("falls back on the tag, code and message of a DMK error, never [object Object]", () => {
    expect(describeLedgerError({ _tag: "DeviceBusyError", message: "Device is busy" })).toBe(
      "DeviceBusyError · Device is busy",
    );
    expect(describeLedgerError({ _tag: "InvalidStatusWordError", errorCode: "6a84" })).toBe(
      "InvalidStatusWordError · 6a84",
    );
    expect(describeLedgerError({})).toBe("Ledger error");
  });

  it("keeps the message of an Error and the text of anything else", () => {
    expect(describeLedgerError(new DeviceError(0x6a84, kInsPqSign))).toBe(
      "device answered 0x6a84 (unknown) to INS 0x11",
    );
    expect(describeLedgerError(new Error("no device selected"))).toBe("no device selected");
    expect(describeLedgerError("cancelled")).toBe("cancelled");
  });
});
