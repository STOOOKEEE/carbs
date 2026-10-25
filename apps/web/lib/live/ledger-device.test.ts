import { describe, expect, it } from "vitest";
import {
  addressFromPublicKey,
  bytesToHex,
  classicSignerFromSeed,
  encodeForSigning,
  generateClassicSeed,
  hexToBytes,
  signTransaction,
  verifyMlDsa,
} from "@carbs/sessions";
import {
  kInsPqSign,
  kInsSign,
  kSw,
  type ApduResponse,
  type ApduTransport,
  type LedgerDevice,
} from "@carbs/ledger";
import { DeviceRejectedError, type TxJson } from "../ports";
import { FakeAlphaNet } from "./fake-alphanet";
import { fakeStax } from "./fake-stax";
import { closeLedgerDevice, createLedgerDevicePort, LEDGER_STAX_USB_MODEL } from "./ledger-device";

const ML_DSA_PUBLIC_KEY_BYTES = 1312;
const ML_DSA_SIGNATURE_BYTES = 2420;
const SECP256K1_PUBLIC_KEY_BYTES = 33;
/** A Device Management Kit error is a plain object, not an `Error`. */
const DMK_LOCKED = { _tag: "DeviceLockedError", errorCode: "5515", message: "Device locked" };

const defs = new FakeAlphaNet().defs;
const destination = addressFromPublicKey(
  classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1")).publicKey,
);

function payment(account: string): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: "1000",
    Fee: "12",
    Sequence: 7,
    LastLedgerSequence: 120,
  };
}

function answering(statusWord: number): ApduTransport {
  return {
    exchange: async (): Promise<ApduResponse> => ({ data: new Uint8Array(), statusWord }),
  };
}

describe("real Ledger Stax port (fake APDU transport)", () => {
  it("is labelled as the real device, never SIMULATED, and lets the Stax show the review", () => {
    const port = createLedgerDevicePort(defs, fakeStax(defs).device);
    expect(port.mode).toBe("live");
    expect(port.model).toBe(LEDGER_STAX_USB_MODEL);
    expect(port.model).not.toMatch(/simulated/i);
    expect(port.review(payment(destination)).simulated).toBe(false);
  });

  it("reads the secp256k1 master key and the ML-DSA-44 root key from the device", async () => {
    const stax = fakeStax(defs);
    const port = createLedgerDevicePort(defs, stax.device);
    const classic = await port.getPublicKey("secp256k1");
    const master = classicSignerFromSeed(stax.classicSeed).publicKey;
    expect(classic).toEqual({
      algorithm: "secp256k1",
      publicKey: bytesToHex(master),
      address: addressFromPublicKey(master),
      publicKeyBytes: SECP256K1_PUBLIC_KEY_BYTES,
    });
    const pq = await port.getPublicKey("mldsa44");
    expect(pq.publicKey).toBe(bytesToHex(stax.contract.mlDsaPublicKey));
    expect(pq.publicKeyBytes).toBe(ML_DSA_PUBLIC_KEY_BYTES);
    expect(pq.address).toBe(addressFromPublicKey(stax.contract.mlDsaPublicKey));
  });

  it("signs with the classical key on the device (INS 0x04), after the review on the Stax", async () => {
    const stax = fakeStax(defs);
    const port = createLedgerDevicePort(defs, stax.device);
    const { address } = await port.getPublicKey("secp256k1");
    const signed = await port.signTransaction("secp256k1", payment(address));
    expect(stax.instructions).toContain(kInsSign);
    expect(stax.reviews).toEqual(["classic"]);
    // RFC 6979: the same key signs the same data the same way.
    const expected = await signTransaction(
      payment(address),
      classicSignerFromSeed(stax.classicSeed),
      defs,
    );
    expect(signed.SigningPubKey).toBe(expected.tx["SigningPubKey"]);
    expect(signed.TxnSignature).toBe(expected.tx["TxnSignature"]);
  });

  it("signs with the ML-DSA-44 root key on the device (INS 0x11), a signature the key verifies", async () => {
    const stax = fakeStax(defs);
    const port = createLedgerDevicePort(defs, stax.device);
    const { address } = await port.getPublicKey("secp256k1");
    const signed = await port.signTransaction("mldsa44", payment(address));
    expect(stax.instructions).toContain(kInsPqSign);
    expect(stax.reviews).toEqual(["ml-dsa"]);
    const signature = hexToBytes(signed.TxnSignature ?? "");
    expect(signature.length).toBe(ML_DSA_SIGNATURE_BYTES);
    const unsigned: TxJson = { ...signed };
    delete unsigned.TxnSignature;
    expect(
      verifyMlDsa(signature, encodeForSigning(unsigned, defs), stax.contract.mlDsaPublicKey),
    ).toBe(true);
  });

  it("maps a refusal on the Stax to DeviceRejectedError", async () => {
    const stax = fakeStax(defs);
    stax.answer.approve = false;
    const port = createLedgerDevicePort(defs, stax.device);
    const { address } = await port.getPublicKey("secp256k1");
    await expect(port.signTransaction("secp256k1", payment(address))).rejects.toBeInstanceOf(
      DeviceRejectedError,
    );
    await expect(port.signTransaction("mldsa44", payment(address))).rejects.toBeInstanceOf(
      DeviceRejectedError,
    );
  });

  it("describes the other device errors for the person", async () => {
    const wrongApp = createLedgerDevicePort(defs, answering(kSw.claNotSupported));
    await expect(wrongApp.getPublicKey("secp256k1")).rejects.toThrow(
      "the open app is not the XRP app (0x6e00)",
    );
    const locked = createLedgerDevicePort(defs, {
      exchange: () => Promise.reject(DMK_LOCKED),
    });
    await expect(locked.getPublicKey("mldsa44")).rejects.toThrow("the device is locked (0x5515)");
  });

  it("does not keep a failed key read: the next call asks the device again", async () => {
    const stax = fakeStax(defs);
    let fail = true;
    const port = createLedgerDevicePort(defs, {
      exchange: (apdu) =>
        fail
          ? Promise.resolve({ data: new Uint8Array(), statusWord: kSw.claNotSupported })
          : stax.device.exchange(apdu),
    });
    await expect(port.getPublicKey("mldsa44")).rejects.toThrow(/not the XRP app/);
    fail = false;
    const key = await port.getPublicKey("mldsa44");
    expect(key.publicKey).toBe(bytesToHex(stax.contract.mlDsaPublicKey));
  });

  it("closes the device session, and describes a failed close", async () => {
    const stax = fakeStax(defs);
    await closeLedgerDevice(stax.device);
    expect(stax.closes).toBe(1);
    const broken: LedgerDevice = {
      exchange: stax.device.exchange,
      close: () => Promise.reject({ _tag: "DeviceSessionNotFound", message: "no session" }),
    };
    await expect(closeLedgerDevice(broken)).rejects.toThrow("DeviceSessionNotFound · no session");
  });
});
