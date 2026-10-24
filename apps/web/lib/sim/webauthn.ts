/**
 * The simulated node's check of a WebAuthn assertion, mirroring what the real node does
 * (`rippled/src/libxrpl/protocol/STTx.cpp:455-517`, as cited in `packages/core/src/keys/passkey.ts`):
 * `type` is `webauthn.get`, `challenge` is base64url of the whole signing data, and the P-256
 * signature covers `authenticatorData ‖ SHA-256(clientDataJSON)`. The signature check is real
 * P-256; only the signing data (canonical JSON, keys.ts) differs from the binary encoding,
 * which the simulation does not do. SIMULATED node.
 */
import { base64UrlEncode, concatBytes, hexToBytes, utf8ToBytes } from "@carbs/sessions";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { TxJson } from "../ports";
import { canonicalJson } from "./keys";

const XRPL_P256_PREFIX = 0xf6;
const SEC1_UNCOMPRESSED = 0x04;
const WEBAUTHN_GET = "webauthn.get";

function field(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^([0-9a-fA-F]{2})+$/.test(value)) return null;
  return hexToBytes(value);
}

/** The bytes the authenticator is asked to sign: the challenge of the assertion. */
export function simSigningData(tx: TxJson): Uint8Array {
  return utf8ToBytes(canonicalJson(tx));
}

export function verifyPasskeyAssertion(tx: TxJson): boolean {
  const passkey = tx.PasskeySignature;
  if (typeof passkey !== "object" || passkey === null) return false;
  const parts = passkey as Record<string, unknown>;
  const authenticatorData = field(parts["AuthenticatorData"]);
  const clientData = field(parts["ClientDataJSON"]);
  const signature = field(parts["Signature"]);
  const publicKey = field(tx.SigningPubKey);
  if (!authenticatorData || !clientData || !signature || !publicKey) return false;
  if (publicKey[0] !== XRPL_P256_PREFIX || publicKey.length !== 65) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientData));
  } catch {
    return false;
  }
  const info = parsed as { type?: unknown; challenge?: unknown };
  if (info.type !== WEBAUTHN_GET) return false;
  if (info.challenge !== base64UrlEncode(simSigningData(tx))) return false;

  const sec1 = concatBytes(Uint8Array.of(SEC1_UNCOMPRESSED), publicKey.subarray(1));
  try {
    return p256.verify(signature, concatBytes(authenticatorData, sha256(clientData)), sec1, {
      prehash: true,
      lowS: false,
      format: "der",
    });
  } catch {
    return false;
  }
}
