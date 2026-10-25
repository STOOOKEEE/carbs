// WebAuthn passkeys (Touch ID / Face ID) as XRPL signers.
// Node rules (rippled STTx.cpp verifyPasskeySignature, PublicKey.cpp publicKeyType):
// - the passkey public key is 65 bytes, 0xF6 ‖ X ‖ Y (P-256);
// - the WebAuthn challenge is the transaction's signing data (STX\0 ‖ fields), base64url;
// - the signature travels in PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}.

import { bytesToHex, hexToBytes } from "./hex.ts";
import type { TxJson } from "./ledger.ts";

/** COSE algorithm -7: ECDSA with P-256 and SHA-256 (ES256), the only passkey type the node accepts. */
const ES256 = -7;
/** An uncompressed P-256 point: 0x04 ‖ X (32) ‖ Y (32), the tail of the SPKI public key. */
const UNCOMPRESSED_POINT_LENGTH = 65;
const UNCOMPRESSED_POINT_PREFIX = 0x04;
/** The node's prefix for a P-256 public key, in place of 0x04. */
const XRPL_P256_PREFIX = 0xf6;
const USER_ID_LENGTH = 16;
const REGISTRATION_CHALLENGE_LENGTH = 32;
const RELYING_PARTY_NAME = "carbs";

export interface Passkey {
  /** Credential id, hex: the PasskeyID on the ledger. */
  id: string;
  /** 0xF6 ‖ X ‖ Y, hex: the SigningPubKey of passkey-signed transactions. */
  publicKey: string;
}

function credentialResponse<T extends AuthenticatorResponse>(
  credential: Credential | null,
  isExpected: (response: AuthenticatorResponse) => response is T,
): { credential: PublicKeyCredential; response: T } {
  if (!(credential instanceof PublicKeyCredential)) throw new Error("no passkey was returned");
  const response = credential.response;
  if (!isExpected(response)) throw new Error("the passkey returned an unexpected response");
  return { credential, response };
}

export async function createPasskey(accountName: string): Promise<Passkey> {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { name: RELYING_PARTY_NAME, id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(USER_ID_LENGTH)),
        name: accountName,
        displayName: accountName,
      },
      challenge: crypto.getRandomValues(new Uint8Array(REGISTRATION_CHALLENGE_LENGTH)),
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      attestation: "none",
    },
  });
  const { credential: created, response } = credentialResponse(
    credential,
    (r): r is AuthenticatorAttestationResponse => r instanceof AuthenticatorAttestationResponse,
  );
  if (response.getPublicKeyAlgorithm() !== ES256)
    throw new Error("the passkey is not a P-256 (ES256) key");
  const spki = response.getPublicKey();
  if (spki === null) throw new Error("the browser did not expose the passkey public key");
  const point = new Uint8Array(spki).slice(-UNCOMPRESSED_POINT_LENGTH);
  if (point[0] !== UNCOMPRESSED_POINT_PREFIX)
    throw new Error("unexpected passkey public key encoding");
  point[0] = XRPL_P256_PREFIX;
  return { id: bytesToHex(new Uint8Array(created.rawId)), publicKey: bytesToHex(point) };
}

/**
 * Signs a transaction with the passkey. `signingDataHex` must be computed with
 * SigningPubKey already set to the passkey key: the key is part of the signed data.
 */
export async function signWithPasskey(
  passkey: Passkey,
  tx: TxJson,
  signingDataHex: string,
): Promise<TxJson> {
  if (tx["SigningPubKey"] !== passkey.publicKey)
    throw new Error("SigningPubKey must be the passkey key");
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(signingDataHex),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: hexToBytes(passkey.id) }],
      userVerification: "required",
    },
  });
  const { response } = credentialResponse(
    credential,
    (r): r is AuthenticatorAssertionResponse => r instanceof AuthenticatorAssertionResponse,
  );
  return {
    ...tx,
    PasskeySignature: {
      PasskeyID: passkey.id,
      AuthenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
      ClientDataJSON: bytesToHex(new Uint8Array(response.clientDataJSON)),
      Signature: bytesToHex(new Uint8Array(response.signature)),
    },
  };
}
