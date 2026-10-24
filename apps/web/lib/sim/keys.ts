/**
 * SIMULATED key material. Nothing here is cryptography: hashes are FNV-based mixers,
 * "signatures" are keyed digests that the simulated node recomputes. The sizes follow
 * the spec (P-256 key 65 bytes with the 0xF6 prefix, ML-DSA-44 key 1 312 bytes and
 * signature 2 420 bytes, spec 6.14) so that the screens show honest lengths.
 */
import type { KeyAlgorithm, TxJson } from "../ports";

const HEX = "0123456789abcdef";
const ADDRESS_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const DIGEST_BYTES = 32;

export const SIM_ADDRESS_PREFIX = "rSim";
const ADDRESS_BODY_LENGTH = 27;

export const KEY_BYTES: Record<KeyAlgorithm, number> = {
  secp256k1: 33,
  p256: 65,
  mldsa44: 1312,
};
export const SIGNATURE_BYTES: Record<KeyAlgorithm, number> = {
  secp256k1: 71,
  p256: 71,
  mldsa44: 2420,
};
const P256_PREFIX = "F6";
const SECP256K1_PREFIX = "03";

function fnv(input: string, seed: number): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** 32-byte digest as 64 lowercase hex characters. Deterministic, not cryptographic. */
export function simDigest(input: string): string {
  let out = "";
  for (let word = 0; word < DIGEST_BYTES / 4; word += 1) {
    const h = fnv(input, Math.imul(word + 1, 0x9e3779b1));
    for (let shift = 28; shift >= 0; shift -= 4) {
      out += HEX[(h >>> shift) & 0xf];
    }
  }
  return out;
}

/** `bytes` bytes of deterministic filler as hex, derived from `seed`. */
export function simBytesHex(seed: string, bytes: number): string {
  let out = "";
  let counter = 0;
  while (out.length < bytes * 2) {
    out += simDigest(`${seed}#${counter}`);
    counter += 1;
  }
  return out.slice(0, bytes * 2);
}

/** A hash shown as a transaction hash (uppercase, 64 characters). */
export function simTxHash(tx: TxJson): string {
  return simDigest(canonicalJson(tx)).toUpperCase();
}

/** JSON with sorted keys, without the signature fields. */
export function canonicalJson(tx: TxJson): string {
  const { TxnSignature: _sig, PasskeySignature: _pk, ...rest } = tx;
  return stableStringify(rest);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** A fresh simulated public key (hex) for `algorithm`, from a caller-chosen seed. */
export function simPublicKey(algorithm: KeyAlgorithm, seed: string): string {
  const body = simBytesHex(`${algorithm}:${seed}`, KEY_BYTES[algorithm]);
  if (algorithm === "p256") {
    return P256_PREFIX + body.slice(P256_PREFIX.length);
  }
  if (algorithm === "secp256k1") {
    return SECP256K1_PREFIX + body.slice(SECP256K1_PREFIX.length);
  }
  return body;
}

export function algorithmOfPublicKey(publicKey: string): KeyAlgorithm | null {
  const bytes = publicKey.length / 2;
  if (bytes === KEY_BYTES.mldsa44) return "mldsa44";
  if (bytes === KEY_BYTES.p256 && publicKey.startsWith(P256_PREFIX)) return "p256";
  if (bytes === KEY_BYTES.secp256k1 && publicKey.startsWith(SECP256K1_PREFIX)) return "secp256k1";
  return null;
}

/** The account address of a public key. In the real ledger: RIPEMD160(SHA256(key)). */
export function accountIdOf(publicKey: string): string {
  const digest = simDigest(`account:${publicKey}`);
  let body = "";
  for (let i = 0; i < ADDRESS_BODY_LENGTH; i += 1) {
    const byte = Number.parseInt(digest.slice((i * 2) % 62, ((i * 2) % 62) + 2), 16);
    body += ADDRESS_ALPHABET[(byte + i) % ADDRESS_ALPHABET.length];
  }
  return SIM_ADDRESS_PREFIX + body;
}

/** The signature a holder of `publicKey` would produce for `tx`. */
export function simSignature(publicKey: string, tx: TxJson): string {
  const algorithm = algorithmOfPublicKey(publicKey);
  const bytes = algorithm === null ? SIGNATURE_BYTES.secp256k1 : SIGNATURE_BYTES[algorithm];
  return simBytesHex(
    `sig:${publicKey}:${canonicalJson({ ...tx, SigningPubKey: publicKey })}`,
    bytes,
  ).toUpperCase();
}

export function signWith(publicKey: string, tx: TxJson): TxJson {
  const withKey: TxJson = { ...tx, SigningPubKey: publicKey };
  return { ...withKey, TxnSignature: simSignature(publicKey, withKey) };
}

export function verifySignature(tx: TxJson): boolean {
  const key = tx.SigningPubKey;
  const signature = tx.TxnSignature;
  if (typeof key !== "string" || key === "" || typeof signature !== "string") return false;
  if (algorithmOfPublicKey(key) === null) return false;
  return simSignature(key, tx) === signature;
}

export function isAddress(value: string): boolean {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value);
}
