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

/** Length of an ML-DSA-44 signature (FIPS 204), in bytes. */
export const ML_DSA_44_SIGNATURE_LENGTH = 2420;

/**
 * The largest signing data the app signs with ML-DSA-44, prefix included
 * (`PQ_MAX_MESSAGE` in its `src/apdu/global.h`); the app answers `6700`
 * beyond. The `SigningPubKey` alone takes 1,312 of these bytes.
 */
export const PQ_MAX_SIGNING_DATA_LENGTH = 2048;

/**
 * The XRPL single-signing prefix, `STX\0` (`HashPrefix::txSign`). The app
 * prepends it itself on the classical path (`INS 0x04`), so a classical
 * signature takes the fields alone; the ML-DSA path (`INS 0x11`) takes the
 * signing data with it, since the node verifies pure ML-DSA over those bytes.
 */
export const XRPL_SINGLE_SIGNING_PREFIX = Uint8Array.from([
  0x53, 0x54, 0x58, 0x00,
]);
