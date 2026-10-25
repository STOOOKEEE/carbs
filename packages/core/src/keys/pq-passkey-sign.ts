/**
 * Signing with an ML-DSA-44 passkey, with the options negative tests need. The public entry point
 * is `signWithMlDsaPasskey` (`pq-passkey.ts`, always checked, always the credential's own
 * `PasskeyID`); the options are exported only from `@carbs/sessions/testing`, as
 * `signWithMlDsaPasskeyForTests`, to build transactions the node must refuse.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { keyTypeOf } from "../address.js";
import { base64UrlDecode, bytesToHex, concatBytes, equalBytes } from "../bytes.js";
import {
  kMlDsa44PublicKeyLength,
  kMlDsa44SignatureLength,
  kWebAuthnGetType,
} from "../constants.js";
import type { Definitions } from "../definitions.js";
import { encodeForSigning, encodeTx, transactionHash, type TxJson } from "../encode.js";
import type { SignedTx } from "../sign.js";
import { KeyError } from "./classic.js";
import { verifyMlDsa } from "./mldsa.js";
import type { Authenticator, PasskeyCredential, WebAuthnAssertion } from "./passkey.js";

/**
 * Why the node would refuse this assertion for `signingData`, or `undefined` when none of the
 * stateless checks of `STTx::checkSign` this client mirrors fails (`docs/XLS-PQ-Passkeys.md`
 * section 5.2): `clientDataJSON` is an object, `type` is `webauthn.get`, `challenge` decodes byte
 * for byte to `signingData`, and the 2 420-byte signature verifies as pure ML-DSA-44 (empty
 * context) over `authenticatorData ‖ SHA-256(clientDataJSON)`. It is a mirror, not the node: the
 * JSON parser and the base64url decoder differ (this one, built on `atob`, tolerates whitespace in
 * the challenge, for example), so `undefined` is a strong hint, and the node's answer is the proof.
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
  /** Check the assertion as the node will before returning (default true). */
  verify?: boolean;
  /** `PasskeySignature.PasskeyID` to write (default: the credential id). */
  passkeyId?: Uint8Array;
}

/** `signWithMlDsaPasskey` with options; tests only (`@carbs/sessions/testing`). */
export async function signWithMlDsaPasskeyForTests(
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
