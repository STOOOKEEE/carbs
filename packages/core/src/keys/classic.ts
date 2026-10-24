/**
 * Classical secp256k1 / Ed25519 keys from an XRPL seed, through `ripple-keypairs`. Used for the
 * master key in tests, spikes and the migration's master-signed steps. Seeds stay in memory: never
 * write one to a file, a log or the repository.
 */

import { deriveKeypair, generateSeed, sign } from "ripple-keypairs";
import { keyTypeOf } from "../address.js";
import { bytesToHex, hexToBytes } from "../bytes.js";
import type { BytesSigner } from "../sign.js";

export type ClassicAlgorithm = "ecdsa-secp256k1" | "ed25519";

export class KeyError extends Error {
  override readonly name = "KeyError";
}

/** A fresh random seed (`s…`). */
export function generateClassicSeed(algorithm: ClassicAlgorithm = "ecdsa-secp256k1"): string {
  return generateSeed({ algorithm });
}

/** A signer for the key pair of an XRPL seed. */
export function classicSignerFromSeed(seed: string): BytesSigner {
  const { publicKey, privateKey } = deriveKeypair(seed);
  const pk = hexToBytes(publicKey);
  const keyType = keyTypeOf(pk);
  if (keyType !== "secp256k1" && keyType !== "ed25519") {
    throw new KeyError("the seed did not give a secp256k1 or Ed25519 key");
  }
  return {
    keyType,
    publicKey: pk,
    // ripple-keypairs hashes with SHA-512Half for secp256k1 (canonical, low-S) and signs the
    // message itself for Ed25519, as the node verifies them.
    sign: async (data) => hexToBytes(sign(bytesToHex(data), privateKey)),
  };
}
