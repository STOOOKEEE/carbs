/**
 * ML-DSA-44 with `@noble/post-quantum` 0.7.1 (pinned). Pure ML-DSA, empty context, hedged
 * (randomized) signing over the full signing data `STX\0 ‖ fields`, which is what the node verifies
 * (FIANSO-SPEC.md section 6.14: `M' = 0x00 ‖ 0x00 ‖ M`). Public key 1 312 bytes, no prefix.
 *
 * In this repository the software signer is a cross-check and the stand-in for the device when the
 * device is not used: every result it produces is labelled SIMULATED where it is reported.
 */

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import {
  kMlDsa44PublicKeyLength,
  kMlDsa44SecretKeyLength,
  kMlDsa44SeedLength,
  kMlDsa44SignatureLength,
} from "../constants.js";
import type { BytesSigner } from "../sign.js";
import { KeyError } from "./classic.js";

export interface MlDsaSigner extends BytesSigner {
  readonly keyType: "ml-dsa-44";
}

/** A fresh random 32-byte ML-DSA seed. */
export function generateMlDsaSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(kMlDsa44SeedLength));
}

/** The ML-DSA-44 key pair of a 32-byte seed (FIPS 204 `ML-DSA.KeyGen_internal`). */
export function mlDsaKeyPairFromSeed(seed: Uint8Array): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  if (seed.length !== kMlDsa44SeedLength) {
    throw new KeyError(`an ML-DSA seed is ${kMlDsa44SeedLength} bytes`);
  }
  const { publicKey, secretKey } = ml_dsa44.keygen(seed);
  if (
    publicKey.length !== kMlDsa44PublicKeyLength ||
    secretKey.length !== kMlDsa44SecretKeyLength
  ) {
    throw new KeyError("unexpected ML-DSA-44 key sizes");
  }
  return { publicKey, secretKey };
}

/** A software ML-DSA-44 signer (SIMULATED wherever it stands in for the device). */
export function mlDsaSignerFromSeed(seed: Uint8Array): MlDsaSigner {
  const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
  return {
    keyType: "ml-dsa-44",
    publicKey,
    sign: async (data) => {
      const signature = ml_dsa44.sign(data, secretKey);
      if (signature.length !== kMlDsa44SignatureLength) {
        throw new KeyError("unexpected ML-DSA-44 signature size");
      }
      return signature;
    },
  };
}

/** Verify a pure ML-DSA-44 signature with an empty context, as the node does. */
export function verifyMlDsa(
  signature: Uint8Array,
  data: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  if (
    signature.length !== kMlDsa44SignatureLength ||
    publicKey.length !== kMlDsa44PublicKeyLength
  ) {
    return false;
  }
  return ml_dsa44.verify(signature, data, publicKey);
}
