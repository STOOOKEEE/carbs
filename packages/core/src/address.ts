/**
 * Key types and account ids. Mirrors `publicKeyType` (`rippled/src/libxrpl/protocol/PublicKey.cpp:237-256`)
 * and `calcAccountID` (`rippled/src/libxrpl/protocol/AccountID.cpp:149-156`, RIPEMD-160 of SHA-256 of
 * the public key bytes, whatever the key type).
 */

import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { decodeAccountID, encodeAccountID, isValidClassicAddress } from "ripple-address-codec";
import { bytesToHex, hexToBytes } from "./bytes.js";
import {
  kClassicPublicKeyLength,
  kEd25519PublicKeyPrefix,
  kMlDsa44PublicKeyLength,
  kP256PublicKeyLength,
  kP256PublicKeyPrefix,
} from "./constants.js";

export type KeyType = "secp256k1" | "ed25519" | "ml-dsa-44" | "p256";

const kSecp256k1EvenPrefix = 0x02;
const kSecp256k1OddPrefix = 0x03;

/** The key type the node would see, or `undefined` for bytes it does not accept as a key. */
export function keyTypeOf(publicKey: Uint8Array | string): KeyType | undefined {
  const pk = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  if (pk.length === kClassicPublicKeyLength) {
    if (pk[0] === kEd25519PublicKeyPrefix) return "ed25519";
    if (pk[0] === kSecp256k1EvenPrefix || pk[0] === kSecp256k1OddPrefix) return "secp256k1";
  } else if (pk.length === kMlDsa44PublicKeyLength) {
    return "ml-dsa-44";
  }
  if (pk.length === kP256PublicKeyLength && pk[0] === kP256PublicKeyPrefix) return "p256";
  return undefined;
}

/** Key types a quantum computer could break (every type but ML-DSA). */
export function isQuantumVulnerable(type: KeyType): boolean {
  return type !== "ml-dsa-44";
}

/** The 20-byte AccountID of a public key. */
export function accountIdBytes(publicKey: Uint8Array | string): Uint8Array {
  const pk = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  return ripemd160(sha256(pk));
}

/** The classic address (`r…`) of a public key. */
export function addressFromPublicKey(publicKey: Uint8Array | string): string {
  return encodeAccountID(accountIdBytes(publicKey));
}

export function isClassicAddress(address: string): boolean {
  return isValidClassicAddress(address);
}

/** The AccountID of a classic address, upper-case hex. */
export function accountIdHex(address: string): string {
  return bytesToHex(decodeAccountID(address));
}
