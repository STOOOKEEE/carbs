// Passkey used only as a WebAuthn PRF oracle: it is never registered on the ledger.
// After a Touch ID, the PRF extension returns a per-credential 32-byte secret,
// HMAC(credential secret, salt), that unlocks the ML-DSA-44 seed (see vault.ts).
//
// PRF support (état connu, à confirmer sur la machine cible) :
// - Safari 18+ / macOS 15+ avec passkeys iCloud Keychain : supporté.
// - Chrome récent (≥ 116 pour le PRF ; passkeys iCloud Keychain sur macOS depuis ~Chrome 132) :
//   supporté — non vérifié pour la combinaison Chrome + iCloud Keychain.
// - Gestionnaire de mots de passe Google, clés de sécurité FIDO2 avec hmac-secret : supporté.
// - Firefox récent (≥ 135 ?) : non vérifié.
// - Tests automatisés : authentificateur virtuel CDP (WebAuthn.addVirtualAuthenticator,
//   protocol "ctap2", hasPrf: true, hasUserVerification: true, isUserVerified: true).
// Certaines plateformes (iCloud Keychain notamment) renvoient `prf.enabled: true` à la
// création sans résultats : le secret n'est alors disponible qu'à get(), d'où evaluatePrf.

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
    message = "Ce navigateur ou cet authentificateur ne prend pas en charge l'extension PRF des passkeys.",
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
  if (/[^A-Za-z0-9_-]/.test(text))
    throw new Error("identifiant de passkey invalide (base64url attendu)");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / BASE64_BLOCK) * BASE64_BLOCK, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Runs a WebAuthn ceremony, turning a cancel / timeout into a clear French error. */
async function ceremony(run: () => Promise<Credential | null>): Promise<Credential | null> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DOMException && error.name === NOT_ALLOWED_ERROR) {
      throw new Error("Touch ID annulé, refusé ou expiré : la passkey n'a pas répondu.", {
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
      "La passkey a été créée mais l'authentificateur n'active pas l'extension PRF : impossible d'y protéger la clé post-quantique.",
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
    throw new PrfUnsupportedError(
      "La passkey n'a pas renvoyé de secret PRF : déverrouillage impossible.",
    );
  }
  const secret =
    first instanceof ArrayBuffer
      ? new Uint8Array(first.slice(0))
      : new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice();
  if (secret.length !== PRF_SECRET_LENGTH) {
    secret.fill(0);
    throw new PrfUnsupportedError(
      `Secret PRF de taille inattendue (${secret.length} octets au lieu de ${PRF_SECRET_LENGTH}).`,
    );
  }
  return secret;
}
