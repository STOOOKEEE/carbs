import { Curve } from "@api/model/Curve";

export const APP_NAME = "XRP";

/**
 * Curve used when a caller of a public entry point (the signer's options, the
 * device action factories, `GetAddressCommandArgs`) does not give one. Every
 * layer below those takes the curve as a required argument.
 */
export const DEFAULT_CURVE = Curve.Secp256k1;

/** Length of an ML-DSA-44 public key (FIPS 204), in bytes. */
export const ML_DSA_44_PUBLIC_KEY_LENGTH = 1312;

/**
 * The app answers the ML-DSA-44 public key and signature in chunks of this
 * size, the last one shorter (`PQ_CHUNK` in its `src/pq/pq_root.c`).
 */
export const PQ_ANSWER_CHUNK_LENGTH = 250;
