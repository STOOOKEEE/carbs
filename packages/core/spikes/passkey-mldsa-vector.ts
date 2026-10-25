/**
 * Generates the fixed ML-DSA-44 WebAuthn vector of the rippled suite `PasskeyMLDSA`
 * (`rippled/src/test/app/PasskeyMLDSA_test.cpp`, `testIndependentVector`) with implementations
 * independent of rippled: @noble/post-quantum 0.7.1 for ML-DSA-44 and ripple-binary-codec for the
 * signing data. The key comes from a fixed seed; the signature is randomized, so a new run gives
 * another valid vector, not the committed one. Output: one JSON line of hex fields.
 *
 *   pnpm --filter @carbs/sessions exec tsx spikes/passkey-mldsa-vector.ts
 */

import { createHash } from "node:crypto";

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { encodeForSigning } from "ripple-binary-codec";

const kSeedLabel = "carbs PasskeyMLDSA test vector";
const kRelyingPartyId = "carbs.example";
const kOrigin = "https://carbs.example";
// User present and user verified, then a signature counter of 7 (big-endian).
const kFlagsAndCounter = Uint8Array.from([0x05, 0x00, 0x00, 0x00, 0x07]);

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex").toUpperCase();
const sha256 = (data: Uint8Array | string): Buffer => createHash("sha256").update(data).digest();

const { publicKey, secretKey } = ml_dsa44.keygen(new Uint8Array(sha256(kSeedLabel)));

const tx = {
  TransactionType: "Payment",
  Account: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  Destination: "rPMh7Pi9ct699iZUTWaytJUoHcJ7cgyziK",
  Amount: "1000000",
  Fee: "10",
  Sequence: 1,
  Flags: 0,
  SigningPubKey: hex(publicKey),
};

// STX\0 followed by the signing fields: what the WebAuthn challenge encodes.
const signingData = Buffer.from(encodeForSigning(tx), "hex");
const challenge = signingData.toString("base64url");
const clientDataJSON = Buffer.from(
  JSON.stringify({ type: "webauthn.get", challenge, origin: kOrigin, crossOrigin: false }),
  "utf8",
);
const authenticatorData = Buffer.concat([sha256(kRelyingPartyId), kFlagsAndCounter]);

// Pure ML-DSA-44, empty context (COSE -48), over authenticatorData || SHA-256(clientDataJSON).
const message = new Uint8Array(Buffer.concat([authenticatorData, sha256(clientDataJSON)]));
const signature = ml_dsa44.sign(message, secretKey);
if (!ml_dsa44.verify(signature, message, publicKey)) {
  throw new Error("passkey-mldsa-vector: the signature does not verify");
}

console.log(
  JSON.stringify({
    publicKey: hex(publicKey),
    signingData: hex(signingData),
    authenticatorData: hex(authenticatorData),
    clientDataJSON: hex(clientDataJSON),
    signature: hex(signature),
  }),
);
