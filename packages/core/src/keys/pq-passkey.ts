/**
 * Post-quantum passkeys: ML-DSA-44 WebAuthn credentials (COSE algorithm -48, RFC 9964), verified by
 * the node under the amendment `PasskeyMLDSA` (`docs/XLS-PQ-Passkeys.md` on the branch of PR #113,
 * section 6). The wire format:
 *
 * - **Register**: the credential's COSE key is `{1: 7 (AKP), 3: -48, -1: pub}`; `pub` is the raw
 *   1 312-byte FIPS 204 key, copied as is into `PasskeyListSet` `Passkeys[].Passkey.PublicKey`, with
 *   `PasskeyID` = the credential id.
 * - **Sign**: `SigningPubKey` = the same 1 312 bytes, no `TxnSignature`; the WebAuthn challenge is
 *   the whole signing data `STX\0 ‖ fields` (about 1.4 KB, since it holds the key); the
 *   authenticator signs `authenticatorData ‖ SHA-256(clientDataJSON)` with pure ML-DSA-44 and an
 *   empty context, 2 420 raw bytes (no DER, no low-S); `PasskeySignature.PasskeyID` must be the id
 *   registered with the key (`tefBAD_AUTH` otherwise).
 *
 * The node checks `clientDataJSON.type` and `challenge` only, not the origin, the relying party,
 * the flags or the counter; the client checks the same before submitting, so a refusal is explained
 * here rather than answered "Invalid signature." by the node.
 */

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { addressFromPublicKey, keyTypeOf } from "../address.js";
import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  concatBytes,
  equalBytes,
  toArrayBufferView,
  utf8ToBytes,
} from "../bytes.js";
import {
  CborError,
  decodeCbor,
  decodeCborItem,
  encodeCbor,
  isCborMap,
  type CborMap,
} from "../cbor.js";
import {
  kAuthDataAaguidLength,
  kAuthDataFlagAttestedCredential,
  kAuthDataFlagExtensions,
  kAuthDataFlagUserPresent,
  kAuthDataFlagUserVerified,
  kAuthDataMinLength,
  kAuthDataRpIdHashLength,
  kCoseAlgMlDsa44,
  kCoseKeyTypeAkp,
  kCoseLabelAkpPriv,
  kCoseLabelAkpPub,
  kCoseLabelAlg,
  kCoseLabelKty,
  kMlDsa44PublicKeyLength,
  kMlDsa44SignatureLength,
  kWebAuthnCreateType,
  kWebAuthnGetType,
} from "../constants.js";
import type { Definitions } from "../definitions.js";
import { encodeForSigning, encodeTx, transactionHash, type TxJson } from "../encode.js";
import type { SignedTx } from "../sign.js";
import { KeyError } from "./classic.js";
import { generateMlDsaSeed, mlDsaKeyPairFromSeed, verifyMlDsa } from "./mldsa.js";
import type {
  AssertionRequest,
  Authenticator,
  PasskeyCredential,
  WebAuthnAssertion,
} from "./passkey.js";

/** The attested credential of a registration's `authenticatorData`. */
export interface AttestedCredential {
  aaguid: Uint8Array;
  credentialId: Uint8Array;
  /** The COSE key, as the CBOR bytes the authenticator wrote. */
  credentialPublicKey: Uint8Array;
}

export interface ParsedAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attestedCredential: AttestedCredential | undefined;
  /** The CBOR extensions map, when the ED flag is set. */
  extensions: Uint8Array | undefined;
}

/** Bytes of the credential id length in `authenticatorData` (big-endian `uint16`). */
const kCredentialIdLengthBytes = 2;

/** Parse `authenticatorData` (WebAuthn Level 3, section 6.1). Refuses trailing bytes. */
export function parseAuthenticatorData(authData: Uint8Array): ParsedAuthenticatorData {
  if (authData.length < kAuthDataMinLength) {
    throw new KeyError(`authenticatorData is at least ${kAuthDataMinLength} bytes`);
  }
  const view = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  const rpIdHash = authData.slice(0, kAuthDataRpIdHashLength);
  const flags = authData[kAuthDataRpIdHashLength] ?? 0;
  const signCount = view.getUint32(kAuthDataRpIdHashLength + 1);
  let offset = kAuthDataMinLength;
  let attestedCredential: AttestedCredential | undefined;
  if ((flags & kAuthDataFlagAttestedCredential) !== 0) {
    if (authData.length < offset + kAuthDataAaguidLength + kCredentialIdLengthBytes) {
      throw new KeyError("authenticatorData: truncated attested credential data");
    }
    const aaguid = authData.slice(offset, offset + kAuthDataAaguidLength);
    offset += kAuthDataAaguidLength;
    const idLength = view.getUint16(offset);
    offset += kCredentialIdLengthBytes;
    if (idLength === 0 || authData.length < offset + idLength) {
      throw new KeyError("authenticatorData: bad credential id length");
    }
    const credentialId = authData.slice(offset, offset + idLength);
    offset += idLength;
    let end: number;
    try {
      end = decodeCborItem(authData, offset).end;
    } catch (error) {
      throw new KeyError(`authenticatorData: unreadable COSE key (${String(error)})`);
    }
    attestedCredential = { aaguid, credentialId, credentialPublicKey: authData.slice(offset, end) };
    offset = end;
  }
  let extensions: Uint8Array | undefined;
  if ((flags & kAuthDataFlagExtensions) !== 0) {
    const end = decodeCborItem(authData, offset).end;
    extensions = authData.slice(offset, end);
    offset = end;
  }
  if (offset !== authData.length) throw new KeyError("authenticatorData: trailing bytes");
  return { rpIdHash, flags, signCount, attestedCredential, extensions };
}

/**
 * The 1 312-byte ML-DSA-44 public key of a COSE key: `kty` 7 (AKP), `alg` -48, `pub` (label -1)
 * 1 312 bytes, and no private part. Anything else (an ES256 key, ML-DSA-65, a wrong size) is
 * refused: the node would not take it as an ML-DSA-44 passkey.
 */
export function mlDsa44PublicKeyFromCose(coseKey: Uint8Array | CborMap): Uint8Array {
  let map: CborMap;
  if (coseKey instanceof Uint8Array) {
    let decoded;
    try {
      decoded = decodeCbor(coseKey);
    } catch (error) {
      if (error instanceof CborError) throw new KeyError(`COSE key: ${error.message}`);
      throw error;
    }
    if (!isCborMap(decoded)) throw new KeyError("COSE key: not a CBOR map");
    map = decoded;
  } else {
    map = coseKey;
  }
  const kty = map.get(kCoseLabelKty);
  const alg = map.get(kCoseLabelAlg);
  if (kty !== kCoseKeyTypeAkp) {
    throw new KeyError(`COSE key: kty is ${String(kty)}, expected ${kCoseKeyTypeAkp} (AKP)`);
  }
  if (alg !== kCoseAlgMlDsa44) {
    throw new KeyError(`COSE key: alg is ${String(alg)}, expected ${kCoseAlgMlDsa44} (ML-DSA-44)`);
  }
  if (map.has(kCoseLabelAkpPriv)) throw new KeyError("COSE key: carries a private key");
  const pub = map.get(kCoseLabelAkpPub);
  if (!(pub instanceof Uint8Array) || pub.length !== kMlDsa44PublicKeyLength) {
    throw new KeyError(`COSE key: pub is not a ${kMlDsa44PublicKeyLength}-byte string`);
  }
  return pub;
}

/** The members of an `attestationObject` the client reads. */
export interface ParsedAttestation {
  fmt: string;
  authData: Uint8Array;
  parsed: ParsedAuthenticatorData;
}

/**
 * Parse an `attestationObject` (`{fmt, attStmt, authData}`). The attestation statement is not
 * verified: the ledger does not use it, and the credential's authority comes from the account's
 * own `PasskeyListSet`, signed by a key the account already trusts.
 */
export function parseAttestationObject(attestationObject: Uint8Array): ParsedAttestation {
  let decoded;
  try {
    decoded = decodeCbor(attestationObject);
  } catch (error) {
    if (error instanceof CborError) throw new KeyError(`attestationObject: ${error.message}`);
    throw error;
  }
  if (!isCborMap(decoded)) throw new KeyError("attestationObject: not a CBOR map");
  const fmt = decoded.get("fmt");
  const authData = decoded.get("authData");
  if (typeof fmt !== "string") throw new KeyError("attestationObject: no fmt");
  if (!(authData instanceof Uint8Array)) throw new KeyError("attestationObject: no authData");
  return { fmt, authData, parsed: parseAuthenticatorData(authData) };
}

export interface FromAttestationOptions {
  /** The credential's `rawId`; must equal the credential id in `authenticatorData`. */
  rawId?: Uint8Array;
  /** The relying party id; its SHA-256 must be the `rpIdHash` of `authenticatorData`. */
  rpId?: string;
}

/** The passkey of a registration: its credential id and its 1 312-byte ML-DSA-44 key. */
export function mlDsaPasskeyFromAttestation(
  attestationObject: Uint8Array,
  options: FromAttestationOptions = {},
): PasskeyCredential {
  const { parsed } = parseAttestationObject(attestationObject);
  const attested = parsed.attestedCredential;
  if (!attested) throw new KeyError("attestationObject: no attested credential (AT flag unset)");
  if ((parsed.flags & kAuthDataFlagUserPresent) === 0) {
    throw new KeyError("attestationObject: the user was not present (UP flag unset)");
  }
  if (options.rawId && !equalBytes(options.rawId, attested.credentialId)) {
    throw new KeyError("attestationObject: the credential id differs from rawId");
  }
  if (
    options.rpId !== undefined &&
    !equalBytes(parsed.rpIdHash, sha256(utf8ToBytes(options.rpId)))
  ) {
    throw new KeyError(`attestationObject: rpIdHash is not SHA-256("${options.rpId}")`);
  }
  return {
    credentialId: attested.credentialId,
    publicKey: mlDsa44PublicKeyFromCose(attested.credentialPublicKey),
  };
}

/**
 * Why the node would refuse this assertion for `signingData`, or `undefined` when it would accept
 * it (the stateless checks of `STTx::checkSign`, `docs/XLS-PQ-Passkeys.md` section 5.2):
 * `clientDataJSON` is an object, `type` is `webauthn.get`, `challenge` decodes byte for byte to
 * `signingData`, and the 2 420-byte signature verifies as pure ML-DSA-44 (empty context) over
 * `authenticatorData ‖ SHA-256(clientDataJSON)`.
 */
export function mlDsaAssertionProblem(
  assertion: WebAuthnAssertion,
  signingData: Uint8Array,
  publicKey: Uint8Array,
): string | undefined {
  let clientData: unknown;
  try {
    clientData = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(assertion.clientDataJSON),
    );
  } catch {
    return "clientDataJSON is not JSON";
  }
  if (typeof clientData !== "object" || clientData === null || Array.isArray(clientData)) {
    return "clientDataJSON is not an object";
  }
  const type: unknown = Reflect.get(clientData, "type");
  const challenge: unknown = Reflect.get(clientData, "challenge");
  if (type !== kWebAuthnGetType)
    return `clientDataJSON.type is ${String(type)}, not ${kWebAuthnGetType}`;
  if (typeof challenge !== "string") return "clientDataJSON.challenge is not a string";
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(challenge);
  } catch {
    return "clientDataJSON.challenge is not base64url";
  }
  if (!equalBytes(decoded, signingData)) {
    return "clientDataJSON.challenge is not the transaction's signing data";
  }
  if (assertion.signature.length !== kMlDsa44SignatureLength) {
    return `the signature is ${assertion.signature.length} bytes, not ${kMlDsa44SignatureLength}`;
  }
  const message = concatBytes(assertion.authenticatorData, sha256(assertion.clientDataJSON));
  if (!verifyMlDsa(assertion.signature, message, publicKey)) {
    return "the ML-DSA-44 signature does not verify over authenticatorData ‖ SHA-256(clientDataJSON)";
  }
  return undefined;
}

export interface MlDsaPasskeySignOptions {
  /**
   * Check the assertion as the node will before returning (default true). Off only to build a
   * transaction the node must refuse (negative tests).
   */
  verify?: boolean;
  /** `PasskeySignature.PasskeyID` to write (default: the credential id; negative tests only). */
  passkeyId?: Uint8Array;
}

/**
 * Sign `tx` with an ML-DSA-44 passkey through WebAuthn: `SigningPubKey` = the 1 312-byte key, the
 * challenge = `STX\0 ‖ fields`, and a `PasskeySignature` whose `Signature` is the raw 2 420 bytes.
 */
export async function signWithMlDsaPasskey(
  tx: TxJson,
  credential: PasskeyCredential,
  authenticator: Authenticator,
  rpId: string,
  defs: Definitions,
  options: MlDsaPasskeySignOptions = {},
): Promise<SignedTx> {
  if (keyTypeOf(credential.publicKey) !== "ml-dsa-44") {
    throw new KeyError(`an ML-DSA-44 passkey has a ${kMlDsa44PublicKeyLength}-byte public key`);
  }
  if (tx["Signers"] !== undefined)
    throw new KeyError("a passkey-signed transaction has no Signers");
  const unsigned: TxJson = { ...tx, SigningPubKey: bytesToHex(credential.publicKey) };
  delete unsigned["TxnSignature"];
  delete unsigned["PasskeySignature"];
  const signingData = encodeForSigning(unsigned, defs);
  const assertion = await authenticator.getAssertion({
    challenge: signingData,
    credentialId: credential.credentialId,
    rpId,
  });
  if (options.verify ?? true) {
    const problem = mlDsaAssertionProblem(assertion, signingData, credential.publicKey);
    if (problem !== undefined) {
      throw new KeyError(`the node would refuse this passkey assertion: ${problem}`);
    }
  }
  const signed: TxJson = {
    ...unsigned,
    PasskeySignature: {
      PasskeyID: bytesToHex(options.passkeyId ?? credential.credentialId),
      AuthenticatorData: bytesToHex(assertion.authenticatorData),
      ClientDataJSON: bytesToHex(assertion.clientDataJSON),
      Signature: bytesToHex(assertion.signature),
    },
  };
  const blob = encodeTx(signed, defs);
  return { tx: signed, blob, hash: transactionHash(blob) };
}

export interface MlDsaPasskeyCreateOptions {
  rpId: string;
  rpName: string;
  userName: string;
  /** The WebAuthn user handle (default: 16 random bytes). */
  userId?: Uint8Array;
  /** Default `cross-platform`: a roaming authenticator, such as a Ledger Stax over USB. */
  attachment?: AuthenticatorAttachment;
  /** Default 120 s: an ML-DSA-44 key generation on a hardware authenticator is slow. */
  timeoutMs?: number;
}

const kUserIdLength = 16;
const kRegistrationChallengeLength = 32;
const kDefaultCeremonyTimeoutMs = 120_000;

/**
 * `navigator.credentials.create` for an ML-DSA-44 credential (`alg` -48 only) and its passkey,
 * read from the `attestationObject` (`getPublicKey()` gives no SPKI for -48). The registration
 * challenge is random: the ledger never sees it, the `PasskeyListSet` is what makes the key count.
 * Whether a browser forwards -48 to the authenticator is for the caller's browser to show.
 */
export async function browserCreateMlDsaPasskey(
  container: CredentialsContainer,
  options: MlDsaPasskeyCreateOptions,
): Promise<PasskeyCredential> {
  const created = await container.create({
    publicKey: {
      rp: { id: options.rpId, name: options.rpName },
      user: {
        id: toArrayBufferView(
          options.userId ?? crypto.getRandomValues(new Uint8Array(kUserIdLength)),
        ),
        name: options.userName,
        displayName: options.userName,
      },
      challenge: toArrayBufferView(
        crypto.getRandomValues(new Uint8Array(kRegistrationChallengeLength)),
      ),
      pubKeyCredParams: [{ type: "public-key", alg: kCoseAlgMlDsa44 }],
      authenticatorSelection: {
        authenticatorAttachment: options.attachment ?? "cross-platform",
        residentKey: "discouraged",
        requireResidentKey: false,
        userVerification: "preferred",
      },
      attestation: "none",
      timeout: options.timeoutMs ?? kDefaultCeremonyTimeoutMs,
    },
  });
  if (!(created instanceof PublicKeyCredential)) {
    throw new KeyError("the authenticator returned no public-key credential");
  }
  const response = created.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) {
    throw new KeyError("the authenticator returned no attestation");
  }
  const algorithm = response.getPublicKeyAlgorithm();
  if (algorithm !== kCoseAlgMlDsa44) {
    throw new KeyError(
      `the authenticator made a COSE ${algorithm} credential, not ${kCoseAlgMlDsa44} (ML-DSA-44)`,
    );
  }
  return mlDsaPasskeyFromAttestation(new Uint8Array(response.attestationObject), {
    rawId: new Uint8Array(created.rawId),
    rpId: options.rpId,
  });
}

/** What the software authenticator returns for a registration (SIMULATED). */
export interface SoftwareRegistration {
  rawId: Uint8Array;
  attestationObject: Uint8Array;
  clientDataJSON: Uint8Array;
}

const kSoftwareCredentialIdLength = 16;

/**
 * A software ML-DSA-44 WebAuthn authenticator: no device, no prompt, and every result it produces
 * is SIMULATED. It answers like the modified Ledger Security Key app of PR #109 (a COSE AKP key,
 * pure ML-DSA-44 over `authenticatorData ‖ clientDataHash`, empty context) with `fmt: "none"`.
 */
export class SoftwareMlDsaAuthenticator implements Authenticator {
  readonly credential: PasskeyCredential;
  readonly origin: string;
  readonly #secretKey: Uint8Array;
  #signCount = 0;

  constructor(origin: string, seed: Uint8Array = generateMlDsaSeed()) {
    this.origin = origin;
    const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
    this.#secretKey = secretKey;
    this.credential = {
      credentialId: crypto.getRandomValues(new Uint8Array(kSoftwareCredentialIdLength)),
      publicKey,
    };
  }

  /** The AccountID of the key, were it used as an account's key (never needed by a passkey). */
  get address(): string {
    return addressFromPublicKey(this.credential.publicKey);
  }

  /** The credential's COSE key, `{1: 7, 3: -48, -1: pub}`, in CTAP2 canonical order. */
  coseKey(): Uint8Array {
    return encodeCbor(
      new Map<number, number | Uint8Array>([
        [kCoseLabelKty, kCoseKeyTypeAkp],
        [kCoseLabelAlg, kCoseAlgMlDsa44],
        [kCoseLabelAkpPub, this.credential.publicKey],
      ]),
    );
  }

  /** `navigator.credentials.create` for this credential (SIMULATED, attestation `none`). */
  makeCredential(challenge: Uint8Array, rpId: string): SoftwareRegistration {
    const idLength = new Uint8Array(kCredentialIdLengthBytes);
    new DataView(idLength.buffer).setUint16(0, this.credential.credentialId.length);
    const authData = concatBytes(
      sha256(utf8ToBytes(rpId)),
      Uint8Array.of(
        kAuthDataFlagUserPresent | kAuthDataFlagUserVerified | kAuthDataFlagAttestedCredential,
      ),
      new Uint8Array(4),
      new Uint8Array(kAuthDataAaguidLength),
      idLength,
      this.credential.credentialId,
      this.coseKey(),
    );
    const attestationObject = encodeCbor(
      new Map<string, string | CborMap | Uint8Array>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    const clientDataJSON = utf8ToBytes(
      JSON.stringify({
        type: kWebAuthnCreateType,
        challenge: base64UrlEncode(challenge),
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    return { rawId: this.credential.credentialId.slice(), attestationObject, clientDataJSON };
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
      Uint8Array.of(kAuthDataFlagUserPresent | kAuthDataFlagUserVerified),
      counter,
    );
    const clientDataJSON = utf8ToBytes(
      JSON.stringify({
        type: kWebAuthnGetType,
        challenge: base64UrlEncode(challenge),
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    // Pure ML-DSA-44, empty context (noble's default), hedged: what COSE -48 means (RFC 9964).
    const signature = ml_dsa44.sign(
      concatBytes(authenticatorData, sha256(clientDataJSON)),
      this.#secretKey,
    );
    return { authenticatorData, clientDataJSON, signature };
  }
}
