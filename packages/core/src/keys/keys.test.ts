import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { verify as keypairsVerify } from "ripple-keypairs";
import { describe, expect, it } from "vitest";
import { addressFromPublicKey, keyTypeOf } from "../address.js";
import { base64UrlDecode, bytesToHex, concatBytes, hexToBytes } from "../bytes.js";
import { isCanonicalP256Der } from "../der.js";
import { encodeForSigning, type TxJson } from "../encode.js";
import { signTransaction } from "../sign.js";
import { simulatedSessionDefinitions } from "../testing/simulated-definitions.js";
import { classicSignerFromSeed, generateClassicSeed } from "./classic.js";
import {
  generateMlDsaSeed,
  mlDsaKeyPairFromSeed,
  mlDsaSignerFromSeed,
  verifyMlDsa,
} from "./mldsa.js";
import {
  createSessionKey,
  MemorySessionKeyStore,
  sessionKeyFromKeyPair,
  xrplP256PublicKey,
} from "./p256-session.js";
import {
  buildPasskeyListSet,
  passkeyPublicKeyFromSpki,
  signWithPasskey,
  SoftwareAuthenticator,
} from "./passkey.js";

const defs = simulatedSessionDefinitions();
const account = "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK";
const payment: TxJson = {
  TransactionType: "Payment",
  Account: account,
  Destination: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  Amount: "1000000",
  Fee: "12",
  Sequence: 7,
  LastLedgerSequence: 500,
};

describe("P-256 session key (WebCrypto)", () => {
  it("is non-extractible, fresh per call, and exports 0xF6 ‖ X ‖ Y", async () => {
    const a = await createSessionKey();
    const b = await createSessionKey();
    expect(a.keyPair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", a.keyPair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", a.keyPair.privateKey)).rejects.toThrow();
    expect(a.publicKey.length).toBe(65);
    expect(a.publicKey[0]).toBe(0xf6);
    expect(keyTypeOf(a.publicKey)).toBe("p256");
    expect(a.address).toBe(addressFromPublicKey(a.publicKey));
    expect(a.publicKeyHex).not.toBe(b.publicKeyHex);
  });

  it("signs STX\\0 ‖ fields with low-S strict DER that P-256 verifies", async () => {
    const key = await createSessionKey();
    const point = concatBytes(Uint8Array.of(0x04), key.publicKey.subarray(1));
    for (let i = 0; i < 20; i += 1) {
      const signed = await signTransaction({ ...payment, Sequence: i + 1 }, key, defs);
      const der = hexToBytes(String(signed.tx["TxnSignature"]));
      expect(isCanonicalP256Der(der)).toBe(true);
      const data = encodeForSigning(signed.tx, defs);
      expect(p256.verify(der, data, point, { format: "der", lowS: true })).toBe(true);
      expect(signed.tx["SigningPubKey"]).toBe(key.publicKeyHex);
    }
  });

  it("refuses to wrap an extractible key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    await expect(sessionKeyFromKeyPair(pair)).rejects.toThrow(/non-extractible/);
  });

  it("keeps the pair in a store and signs after reading it back", async () => {
    const key = await createSessionKey();
    const store = new MemorySessionKeyStore();
    await store.put("s1", key.keyPair);
    const pair = await store.get("s1");
    expect(pair).toBeDefined();
    if (!pair) return;
    const again = await sessionKeyFromKeyPair(pair);
    expect(again.publicKeyHex).toBe(key.publicKeyHex);
    await store.delete("s1");
    expect(await store.get("s1")).toBeUndefined();
  });

  it("converts only an uncompressed point", () => {
    expect(() => xrplP256PublicKey(new Uint8Array(65))).toThrow();
    expect(() => xrplP256PublicKey(new Uint8Array(33))).toThrow();
  });
});

describe("ML-DSA-44 (@noble/post-quantum 0.7.1)", () => {
  it("derives the same 1 312-byte key from the same seed, and signs what the node verifies", async () => {
    const seed = generateMlDsaSeed();
    const a = mlDsaKeyPairFromSeed(seed);
    const b = mlDsaKeyPairFromSeed(seed);
    expect(bytesToHex(a.publicKey)).toBe(bytesToHex(b.publicKey));
    expect(a.publicKey.length).toBe(1312);
    expect(keyTypeOf(a.publicKey)).toBe("ml-dsa-44");
    const signer = mlDsaSignerFromSeed(seed);
    const signed = await signTransaction(payment, signer, defs);
    const signature = hexToBytes(String(signed.tx["TxnSignature"]));
    expect(signature.length).toBe(2420);
    const data = encodeForSigning(signed.tx, defs);
    expect(verifyMlDsa(signature, data, signer.publicKey)).toBe(true);
    // Pure ML-DSA, empty context: noble's own verify with no options agrees.
    expect(ml_dsa44.verify(signature, data, signer.publicKey)).toBe(true);
    // Not over the data without the prefix, nor with a context.
    expect(verifyMlDsa(signature, data.subarray(4), signer.publicKey)).toBe(false);
    expect(ml_dsa44.verify(signature, data, signer.publicKey, { context: Uint8Array.of(1) })).toBe(
      false,
    );
    expect(() => mlDsaKeyPairFromSeed(new Uint8Array(31))).toThrow();
  });
});

describe("classical keys (ripple-keypairs)", () => {
  it("signs with secp256k1 and Ed25519 as the node verifies", async () => {
    for (const algorithm of ["ecdsa-secp256k1", "ed25519"] as const) {
      const signer = classicSignerFromSeed(generateClassicSeed(algorithm));
      expect(signer.keyType).toBe(algorithm === "ed25519" ? "ed25519" : "secp256k1");
      const signed = await signTransaction(payment, signer, defs);
      const data = bytesToHex(encodeForSigning(signed.tx, defs));
      expect(
        keypairsVerify(data, String(signed.tx["TxnSignature"]), bytesToHex(signer.publicKey)),
      ).toBe(true);
    }
  });
});

describe("passkeys (software authenticator, SIMULATED)", () => {
  it("builds PasskeySignature as the node verifies it (STTx.cpp verifyPasskeySignature)", async () => {
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const credential = authenticator.credential;
    const signed = await signWithPasskey(payment, credential, authenticator, "localhost", defs);
    const tx = signed.tx;
    expect(tx["TxnSignature"]).toBeUndefined();
    expect(tx["SigningPubKey"]).toBe(bytesToHex(credential.publicKey));
    const sig = tx["PasskeySignature"] as Record<string, string>;
    const clientDataJSON = hexToBytes(String(sig["ClientDataJSON"]));
    const parsed = JSON.parse(new TextDecoder().decode(clientDataJSON)) as Record<string, string>;
    expect(parsed["type"]).toBe("webauthn.get");
    // The challenge is the whole signing data, STX\0 included, and PasskeySignature is not signed.
    const signingData = encodeForSigning(tx, defs);
    expect(bytesToHex(base64UrlDecode(String(parsed["challenge"])))).toBe(bytesToHex(signingData));
    expect(signingData[0]).toBe(0x53);
    const der = hexToBytes(String(sig["Signature"]));
    expect(isCanonicalP256Der(der)).toBe(true);
    const point = concatBytes(Uint8Array.of(0x04), credential.publicKey.subarray(1));
    const message = concatBytes(
      hexToBytes(String(sig["AuthenticatorData"])),
      sha256(clientDataJSON),
    );
    expect(p256.verify(der, message, point, { format: "der", lowS: true })).toBe(true);
    expect(sig["PasskeyID"]).toBe(bytesToHex(credential.credentialId));
  });

  it("builds a PasskeyListSet and reads a key from its SPKI", () => {
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const tx = buildPasskeyListSet(account, [authenticator.credential]);
    expect(tx).toMatchObject({
      TransactionType: "PasskeyListSet",
      Passkeys: [{ Passkey: { PublicKey: bytesToHex(authenticator.credential.publicKey) } }],
    });
    expect(() => buildPasskeyListSet(account, [])).toThrow();
    const spkiHeader = hexToBytes("3059301306072A8648CE3D020106082A8648CE3D030107034200");
    const point = concatBytes(Uint8Array.of(0x04), authenticator.credential.publicKey.subarray(1));
    expect(bytesToHex(passkeyPublicKeyFromSpki(concatBytes(spkiHeader, point)))).toBe(
      bytesToHex(authenticator.credential.publicKey),
    );
  });
});
