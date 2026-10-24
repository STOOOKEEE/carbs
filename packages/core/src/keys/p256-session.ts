/**
 * Session keys (FIANSO-SPEC.md section 8.3, ADR 0004): a WebCrypto ECDSA P-256 key generated
 * **non-extractible**, fresh for every session. The public key is exported as the uncompressed SEC1
 * point `0x04 ‖ X ‖ Y` and rewritten `0xF6 ‖ X ‖ Y` for the node; signatures are WebCrypto `r ‖ s`
 * normalized to low-S and written in strict DER.
 */

import { addressFromPublicKey } from "../address.js";
import { bytesToHex, concatBytes, toArrayBufferView } from "../bytes.js";
import {
  kP256PublicKeyLength,
  kP256PublicKeyPrefix,
  kSec1UncompressedPrefix,
} from "../constants.js";
import { p1363ToCanonicalDer } from "../der.js";
import type { BytesSigner } from "../sign.js";
import { KeyError } from "./classic.js";

const kEcdsaP256: EcKeyGenParams = { name: "ECDSA", namedCurve: "P-256" };
const kEcdsaSha256: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

export interface SessionKey extends BytesSigner {
  readonly keyType: "p256";
  /** `0xF6 ‖ X ‖ Y`. */
  readonly publicKey: Uint8Array;
  readonly publicKeyHex: string;
  /** The `SessionKey` field: the AccountID of the public key, as an address. */
  readonly address: string;
  /** The WebCrypto pair; the private key is not extractible. */
  readonly keyPair: CryptoKeyPair;
}

/** Convert WebCrypto's raw export `0x04 ‖ X ‖ Y` to the node's `0xF6 ‖ X ‖ Y`. */
export function xrplP256PublicKey(rawSec1: Uint8Array): Uint8Array {
  if (rawSec1.length !== kP256PublicKeyLength || rawSec1[0] !== kSec1UncompressedPrefix) {
    throw new KeyError("expected an uncompressed P-256 point (65 bytes, 0x04 prefix)");
  }
  return concatBytes(Uint8Array.of(kP256PublicKeyPrefix), rawSec1.subarray(1));
}

/** Wrap an existing WebCrypto pair (for example one read back from IndexedDB). */
export async function sessionKeyFromKeyPair(
  keyPair: CryptoKeyPair,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<SessionKey> {
  if (keyPair.privateKey.extractable) {
    throw new KeyError("a session key must be non-extractible");
  }
  const raw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
  const publicKey = xrplP256PublicKey(raw);
  return {
    keyType: "p256",
    publicKey,
    publicKeyHex: bytesToHex(publicKey),
    address: addressFromPublicKey(publicKey),
    keyPair,
    sign: async (data) => {
      const p1363 = new Uint8Array(
        await subtle.sign(kEcdsaSha256, keyPair.privateKey, toArrayBufferView(data)),
      );
      return p1363ToCanonicalDer(p1363);
    },
  };
}

/** A fresh, non-extractible P-256 session key. Call it once per session, never reuse one. */
export async function createSessionKey(
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<SessionKey> {
  const keyPair = await subtle.generateKey(kEcdsaP256, false, ["sign", "verify"]);
  return sessionKeyFromKeyPair(keyPair, subtle);
}

/**
 * Where a page keeps its session keys between reloads. A `CryptoKeyPair` survives a structured
 * clone, so an IndexedDB store keeps the private key non-extractible; the web app provides that
 * store, the library only needs this interface.
 */
export interface SessionKeyStore {
  put(id: string, keyPair: CryptoKeyPair): Promise<void>;
  get(id: string): Promise<CryptoKeyPair | undefined>;
  delete(id: string): Promise<void>;
}

/** An in-memory store (tests, and pages that do not persist sessions). */
export class MemorySessionKeyStore implements SessionKeyStore {
  readonly #pairs = new Map<string, CryptoKeyPair>();
  async put(id: string, keyPair: CryptoKeyPair): Promise<void> {
    this.#pairs.set(id, keyPair);
  }
  async get(id: string): Promise<CryptoKeyPair | undefined> {
    return this.#pairs.get(id);
  }
  async delete(id: string): Promise<void> {
    this.#pairs.delete(id);
  }
}
