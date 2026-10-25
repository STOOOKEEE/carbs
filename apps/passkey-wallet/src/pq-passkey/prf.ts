// Passkey used only as a WebAuthn PRF oracle: it is never registered on the ledger.
// After a Touch ID, the PRF extension returns a per-credential 32-byte secret,
// HMAC(credential secret, salt), that unlocks the ML-DSA-44 seed (see vault.ts).
//
// PRF support (known state, to be confirmed on the target machine):
// - Safari 18+ / macOS 15+ with iCloud Keychain passkeys: supported.
// - Recent Chrome (≥ 116 for PRF; iCloud Keychain passkeys on macOS since ~Chrome 132):
//   supported — not verified for the Chrome + iCloud Keychain combination.
// - Google Password Manager, FIDO2 security keys with hmac-secret: supported.
// - Recent Firefox (≥ 135?): not verified.
// - Automated tests: CDP virtual authenticator (WebAuthn.addVirtualAuthenticator,
//   protocol "ctap2", hasPrf: true, hasUserVerification: true, isUserVerified: true).
// Some platforms (iCloud Keychain in particular) return `prf.enabled: true` at creation
// without results: the secret is then only available at get(), hence evaluatePrf.

import {
  credentialResponse,
  REGISTRATION_CHALLENGE_LENGTH,
  RELYING_PARTY_NAME,
  USER_ID_LENGTH,
} from "../passkey.ts";

/** COSE algorithms offered at creation; the key itself is never used to sign anything. */
const ES256 = -7;
const RS256 = -257;
/** Ceremony timeout, milliseconds. */
const CEREMONY_TIMEOUT_MS = 60_000;
/** The assertion challenge is unused (nothing verifies it): random bytes only. */
const ASSERTION_CHALLENGE_LENGTH = 32;
/** The PRF output is HMAC-SHA-256: 32 bytes. */
const PRF_SECRET_LENGTH = 32;
const PRF_CAPABILITY = "extension:prf";
const NOT_ALLOWED_ERROR = "NotAllowedError";

export interface PrfPasskey {
  /** Credential id, base64url. */
  credentialId: string;
}

export class PrfUnsupportedError extends Error {
  constructor(
    message = "This browser or authenticator does not support the passkey PRF extension.",
  ) {
    super(message);
    this.name = "PrfUnsupportedError";
  }
}

function bytesToBase64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64 text comes in 4-character blocks; base64url drops the "=" padding. */
const BASE64_BLOCK = 4;

function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (/[^A-Za-z0-9_-]/.test(text)) throw new Error("invalid passkey id (base64url expected)");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / BASE64_BLOCK) * BASE64_BLOCK, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Runs a WebAuthn ceremony, turning a cancel / timeout into a clear error. */
async function ceremony(run: () => Promise<Credential | null>): Promise<Credential | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DOMException && error.name === NOT_ALLOWED_ERROR) {
      throw new Error("Touch ID cancelled, refused or timed out: the passkey did not answer.", {
        cause: error,
      });
    }
    throw error;
  }
}

export async function prfAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined") return false;
  // getClientCapabilities is recent: without it, let the ceremony tell.
  if (!("getClientCapabilities" in PublicKeyCredential)) return true;
  const capabilities = await PublicKeyCredential.getClientCapabilities();
  return capabilities[PRF_CAPABILITY] ?? true;
}

export async function createPrfPasskey(accountName: string): Promise<PrfPasskey> {
  const credential = await ceremony(() =>
    navigator.credentials.create({
      publicKey: {
        rp: { name: RELYING_PARTY_NAME, id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(USER_ID_LENGTH)),
          name: accountName,
          displayName: accountName,
        },
        challenge: crypto.getRandomValues(new Uint8Array(REGISTRATION_CHALLENGE_LENGTH)),
        pubKeyCredParams: [
          { type: "public-key", alg: ES256 },
          { type: "public-key", alg: RS256 },
        ],
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        attestation: "none",
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: { prf: {} },
      },
    }),
  );
  const { credential: created } = credentialResponse(
    credential,
    (r): r is AuthenticatorAttestationResponse => r instanceof AuthenticatorAttestationResponse,
  );
  if (created.getClientExtensionResults().prf?.enabled !== true) {
    throw new PrfUnsupportedError(
      "The passkey was created but the authenticator does not enable the PRF extension: the post-quantum key cannot be protected with it.",
    );
  }
  return { credentialId: bytesToBase64url(new Uint8Array(created.rawId)) };
}

export async function evaluatePrf(passkey: PrfPasskey, salt: Uint8Array): Promise<Uint8Array> {
  const credential = await ceremony(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(ASSERTION_CHALLENGE_LENGTH)),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: base64urlToBytes(passkey.credentialId) }],
        userVerification: "required",
        timeout: CEREMONY_TIMEOUT_MS,
        extensions: { prf: { eval: { first: new Uint8Array(salt) } } },
      },
    }),
  );
  const { credential: asserted } = credentialResponse(
    credential,
    (r): r is AuthenticatorAssertionResponse => r instanceof AuthenticatorAssertionResponse,
  );
  const first = asserted.getClientExtensionResults().prf?.results?.first;
  if (first === undefined) {
    throw new PrfUnsupportedError("The passkey returned no PRF secret: cannot unlock.");
  }
  const secret =
    first instanceof ArrayBuffer
      ? new Uint8Array(first.slice(0))
      : new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice();
  if (secret.length !== PRF_SECRET_LENGTH) {
    secret.fill(0);
    throw new PrfUnsupportedError(
      `PRF secret of unexpected size (${secret.length} bytes instead of ${PRF_SECRET_LENGTH}).`,
    );
  }
  return secret;
}
