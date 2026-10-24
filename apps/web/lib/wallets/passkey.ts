/**
 * Passkey keys for the web app, built on the `Authenticator` of `@carbs/sessions`: the
 * browser's (`navigator.credentials`, only when the person presses the button) or the
 * software one (tests, SIMULATED). The page never calls WebAuthn on its own.
 */
import {
  bytesToHex,
  canonicalizeDer,
  passkeyPublicKeyFromSpki,
  browserAuthenticator,
  SoftwareAuthenticator,
  type Authenticator,
  type PasskeyCredential,
} from "@carbs/sessions";
import type { KeyHandle, TxJson } from "../ports";
import type { PasskeySource } from "./adapters";
import { accountIdOf } from "../sim/keys";
import { simSigningData } from "../sim/webauthn";

/** A passkey that signs transactions of the simulated node through `authenticator`. */
export function passkeyKeyHandle(
  credential: PasskeyCredential,
  authenticator: Authenticator,
  rpId: string,
): KeyHandle {
  const publicKey = bytesToHex(credential.publicKey);
  return {
    algorithm: "p256",
    publicKey,
    address: accountIdOf(publicKey),
    async sign(tx: TxJson): Promise<TxJson> {
      const unsigned: TxJson = { ...tx, SigningPubKey: publicKey };
      delete unsigned.TxnSignature;
      delete unsigned["PasskeySignature"];
      const assertion = await authenticator.getAssertion({
        challenge: simSigningData(unsigned),
        credentialId: credential.credentialId,
        rpId,
      });
      return {
        ...unsigned,
        PasskeySignature: {
          PasskeyID: bytesToHex(credential.credentialId),
          AuthenticatorData: bytesToHex(assertion.authenticatorData),
          ClientDataJSON: bytesToHex(assertion.clientDataJSON),
          Signature: bytesToHex(canonicalizeDer(assertion.signature)),
        },
      };
    },
  };
}

export interface PasskeyRelyingParty {
  id: string;
  name: string;
}

const CREATE_CHALLENGE_BYTES = 32;
const USER_ID_BYTES = 16;
const ES256 = -7;

/**
 * Create a passkey with the browser's authenticator. Real WebAuthn: it opens the platform
 * prompt (Touch ID, Face ID), so it runs only from a click, in a browser.
 */
export async function createBrowserPasskey(
  container: CredentialsContainer,
  rp: PasskeyRelyingParty,
): Promise<KeyHandle> {
  const created = await container.create({
    publicKey: {
      rp,
      user: {
        id: crypto.getRandomValues(new Uint8Array(USER_ID_BYTES)),
        name: "carbs",
        displayName: "carbs",
      },
      challenge: crypto.getRandomValues(new Uint8Array(CREATE_CHALLENGE_BYTES)),
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "preferred",
      },
    },
  });
  const response = (created as { response?: { getPublicKey?: () => ArrayBuffer | null } } | null)
    ?.response;
  const spki = response?.getPublicKey?.();
  const rawId = (created as { rawId?: ArrayBuffer } | null)?.rawId;
  if (!spki || !rawId) throw new Error("The authenticator returned no P-256 public key");
  const credential: PasskeyCredential = {
    credentialId: new Uint8Array(rawId),
    publicKey: passkeyPublicKeyFromSpki(new Uint8Array(spki)),
  };
  return passkeyKeyHandle(credential, browserAuthenticator(container), rp.id);
}

/** The browser's authenticator. Used only when the person asks to connect. */
export function browserPasskeySource(): PasskeySource {
  return {
    simulated: false,
    available: () =>
      typeof navigator !== "undefined" &&
      "credentials" in navigator &&
      typeof globalThis.PublicKeyCredential !== "undefined",
    create: () =>
      createBrowserPasskey(navigator.credentials, { id: location.hostname, name: "carbs" }),
  };
}

/** The software authenticator (tests, SIMULATED): a real P-256 key, no prompt. */
export function softwarePasskeySource(): PasskeySource {
  const rpId = "carbs.invalid";
  return {
    simulated: true,
    available: () => true,
    async create() {
      const authenticator = new SoftwareAuthenticator(`https://${rpId}`);
      return passkeyKeyHandle(authenticator.credential, authenticator, rpId);
    },
  };
}
