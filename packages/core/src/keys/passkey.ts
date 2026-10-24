/**
 * Passkeys (FIANSO-SPEC.md section 6.14). A passkey is a P-256 key in the account's `PasskeyList`.
 * The node verifies a WebAuthn assertion (`rippled/src/libxrpl/protocol/STTx.cpp:455-517`):
 * - `clientDataJSON.type` is `webauthn.get`;
 * - `clientDataJSON.challenge` is base64url of the **whole** signing data `STX\0 ‖ fields`;
 * - the signature covers `authenticatorData ‖ SHA-256(clientDataJSON)`.
 * `PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}`
 * (`rippled/src/libxrpl/protocol/InnerObjectFormats.cpp:163-170`) is not a signing field, so it is
 * added after the signing data is computed. The signature is normalized to low-S strict DER.
 */

import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { addressFromPublicKey } from "../address.js";
import {
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  equalBytes,
  toArrayBufferView,
  utf8ToBytes,
} from "../bytes.js";
import { kP256PublicKeyLength } from "../constants.js";
import type { Definitions } from "../definitions.js";
import { canonicalizeDer } from "../der.js";
import { encodeForSigning, encodeTx, transactionHash, type TxJson } from "../encode.js";
import type { BytesSigner, SignedTx } from "../sign.js";
import { KeyError } from "./classic.js";
import { xrplP256PublicKey } from "./p256-session.js";

export interface PasskeyCredential {
  /** The WebAuthn credential id, stored as `PasskeyID`. */
  credentialId: Uint8Array;
  /** `0xF6 ‖ X ‖ Y`, stored as `PublicKey` in the passkey list. */
  publicKey: Uint8Array;
}

export interface AssertionRequest {
  challenge: Uint8Array;
  credentialId: Uint8Array;
  rpId: string;
}

export interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  /** DER, as authenticators return it (possibly high-S). */
  signature: Uint8Array;
}

/** Anything that answers `navigator.credentials.get` for one credential. */
export interface Authenticator {
  getAssertion(request: AssertionRequest): Promise<WebAuthnAssertion>;
}

/** Length of the SPKI header of an uncompressed P-256 key (`SubjectPublicKeyInfo`, 91 bytes total). */
const kP256SpkiLength = 91;

/** The XRPL key of a credential from its SPKI (`AuthenticatorAttestationResponse.getPublicKey()`). */
export function passkeyPublicKeyFromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length !== kP256SpkiLength) {
    throw new KeyError(`expected a ${kP256SpkiLength}-byte P-256 SubjectPublicKeyInfo`);
  }
  return xrplP256PublicKey(spki.subarray(spki.length - kP256PublicKeyLength));
}

/** A `PasskeyListSet` with every passkey of the account (the list cannot be replaced later: P6). */
export function buildPasskeyListSet(
  account: string,
  passkeys: readonly PasskeyCredential[],
): TxJson {
  if (passkeys.length === 0) throw new KeyError("a passkey list holds at least one passkey");
  return {
    TransactionType: "PasskeyListSet",
    Account: account,
    Passkeys: passkeys.map((p) => ({
      Passkey: { PasskeyID: bytesToHex(p.credentialId), PublicKey: bytesToHex(p.publicKey) },
    })),
  };
}

/** Sign `tx` with a passkey through WebAuthn and return the signed transaction. */
export async function signWithPasskey(
  tx: TxJson,
  credential: PasskeyCredential,
  authenticator: Authenticator,
  rpId: string,
  defs: Definitions,
): Promise<SignedTx> {
  const unsigned: TxJson = { ...tx, SigningPubKey: bytesToHex(credential.publicKey) };
  delete unsigned["TxnSignature"];
  delete unsigned["PasskeySignature"];
  const challenge = encodeForSigning(unsigned, defs);
  const assertion = await authenticator.getAssertion({
    challenge,
    credentialId: credential.credentialId,
    rpId,
  });
  const signed: TxJson = {
    ...unsigned,
    PasskeySignature: {
      PasskeyID: bytesToHex(credential.credentialId),
      AuthenticatorData: bytesToHex(assertion.authenticatorData),
      ClientDataJSON: bytesToHex(assertion.clientDataJSON),
      Signature: bytesToHex(canonicalizeDer(assertion.signature)),
    },
  };
  const blob = encodeTx(signed, defs);
  return { tx: signed, blob, hash: transactionHash(blob) };
}

/**
 * The browser authenticator: `navigator.credentials.get` for one credential. The library never
 * calls it on its own; the page passes `navigator.credentials` when the user asks to sign.
 */
export function browserAuthenticator(container: CredentialsContainer): Authenticator {
  return {
    async getAssertion({ challenge, credentialId, rpId }) {
      const credential = await container.get({
        publicKey: {
          challenge: toArrayBufferView(challenge),
          rpId,
          allowCredentials: [{ type: "public-key", id: toArrayBufferView(credentialId) }],
          userVerification: "preferred",
        },
      });
      if (!(credential instanceof PublicKeyCredential)) {
        throw new KeyError("the authenticator returned no public-key credential");
      }
      const response = credential.response;
      if (!(response instanceof AuthenticatorAssertionResponse)) {
        throw new KeyError("the authenticator returned no assertion");
      }
      return {
        authenticatorData: new Uint8Array(response.authenticatorData),
        clientDataJSON: new Uint8Array(response.clientDataJSON),
        signature: new Uint8Array(response.signature),
      };
    },
  };
}

/** WebAuthn flags in `authenticatorData`: user present and user verified. */
const kFlagUserPresent = 0x01;
const kFlagUserVerified = 0x04;
const kCredentialIdLength = 16;

/**
 * A software WebAuthn authenticator: no device, no prompt. Tests and spikes only, and every result
 * it produces is SIMULATED. It signs high-S on purpose half of the time (`lowS: false`), like a
 * real authenticator may, so the client's normalization is exercised.
 */
export class SoftwareAuthenticator implements Authenticator {
  readonly credential: PasskeyCredential;
  readonly origin: string;
  readonly #secretKey: Uint8Array;
  #signCount = 0;

  constructor(origin: string, secretKey: Uint8Array = p256.utils.randomSecretKey()) {
    this.origin = origin;
    this.#secretKey = secretKey;
    const raw = p256.getPublicKey(secretKey, false);
    this.credential = {
      credentialId: crypto.getRandomValues(new Uint8Array(kCredentialIdLength)),
      publicKey: xrplP256PublicKey(raw),
    };
  }

  get address(): string {
    return addressFromPublicKey(this.credential.publicKey);
  }

  /**
   * The same key signing raw ECDSA-SHA256 (no WebAuthn): the node also accepts that for a key of
   * the passkey list (FIANSO-SPEC.md section 6.14). Low-S strict DER.
   */
  rawSigner(): BytesSigner {
    return {
      keyType: "p256",
      publicKey: this.credential.publicKey,
      sign: async (data) =>
        p256.sign(data, this.#secretKey, { prehash: true, lowS: true, format: "der" }),
    };
  }

  async getAssertion({
    challenge,
    credentialId,
    rpId,
  }: AssertionRequest): Promise<WebAuthnAssertion> {
    if (!equalBytes(credentialId, this.credential.credentialId)) {
      throw new KeyError("unknown credential");
    }
    this.#signCount += 1;
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, this.#signCount);
    const authenticatorData = concatBytes(
      sha256(utf8ToBytes(rpId)),
      Uint8Array.of(kFlagUserPresent | kFlagUserVerified),
      counter,
    );
    const clientDataJSON = utf8ToBytes(
      JSON.stringify({
        type: "webauthn.get",
        challenge: base64UrlEncode(challenge),
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const signature = p256.sign(
      concatBytes(authenticatorData, sha256(clientDataJSON)),
      this.#secretKey,
      { prehash: true, lowS: false, format: "der" },
    );
    return { authenticatorData, clientDataJSON, signature };
  }
}
