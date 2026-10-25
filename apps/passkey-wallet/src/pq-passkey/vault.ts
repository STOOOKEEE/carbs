// The ML-DSA-44 seed of the post-quantum account, sealed in this browser under a key derived
// from the passkey's PRF output (released only after Touch ID). The passkey itself is never on
// the ledger: the account's authority is the ML-DSA key (its RegularKey).

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import {
  addressFromPublicKey,
  kMlDsa44PublicKeyLength,
  kMlDsa44SeedLength,
  kMlDsa44SignatureLength,
  mlDsaKeyPairFromSeed,
} from "@carbs/sessions";
import { type XrplDefinitions, encodeForSigning } from "ripple-binary-codec";

import { bytesToHex, hexToBytes } from "../hex.ts";
import type { TxJson } from "../ledger.ts";

const STORAGE_KEY = "carbs.pqVault";
const VAULT_VERSION = 1;
const HKDF_INFO = new TextEncoder().encode("carbs pq vault v1");
/** No HKDF salt: the PRF output is already a uniform per-credential secret. */
const HKDF_SALT = new Uint8Array(0);
const PRF_SECRET_LENGTH = 32;
const PRF_SALT_LENGTH = 32;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const AES_KEY_BITS = 256;
const HEX_CHARS_PER_BYTE = 2;

export interface PqVault {
  version: 1;
  credentialId: string;
  account: string;
  mlDsaAddress: string;
  /** Hex, 1312 bytes. */
  publicKey: string;
  /** Hex, 32 bytes: the PRF input. */
  salt: string;
  /** Hex, 12 bytes. */
  iv: string;
  /** Hex: AES-256-GCM of the 32-byte seed (with its tag). */
  ciphertext: string;
}

function assertLength(bytes: Uint8Array, length: number, what: string): void {
  if (bytes.length !== length) throw new Error(`${what} must be ${length} bytes`);
}

/** HKDF-SHA256(prfSecret, info "carbs pq vault v1") -> non-extractable AES-256-GCM key. */
async function vaultKey(prfSecret: Uint8Array): Promise<CryptoKey> {
  assertLength(prfSecret, PRF_SECRET_LENGTH, "the PRF secret");
  const secret = new Uint8Array(prfSecret);
  try {
    const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
      material,
      { name: "AES-GCM", length: AES_KEY_BITS },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    secret.fill(0);
  }
}

export async function sealSeed(
  prfSecret: Uint8Array,
  seed: Uint8Array,
  meta: { credentialId: string; account: string; salt: Uint8Array },
): Promise<PqVault> {
  assertLength(seed, kMlDsa44SeedLength, "the ML-DSA seed");
  assertLength(meta.salt, PRF_SALT_LENGTH, "the PRF salt");
  const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
  secretKey.fill(0);
  const key = await vaultKey(prfSecret);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH));
  const plaintext = new Uint8Array(seed);
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(meta.account) },
      key,
      plaintext,
    );
    return {
      version: VAULT_VERSION,
      credentialId: meta.credentialId,
      account: meta.account,
      mlDsaAddress: addressFromPublicKey(publicKey),
      publicKey: bytesToHex(publicKey),
      salt: bytesToHex(meta.salt),
      iv: bytesToHex(iv),
      ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    };
  } finally {
    plaintext.fill(0);
  }
}

/** The 32-byte seed; throws when the secret, the account or the ciphertext does not match. */
export async function openSeed(prfSecret: Uint8Array, vault: PqVault): Promise<Uint8Array> {
  const key = await vaultKey(prfSecret);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: hexToBytes(vault.iv),
        additionalData: new TextEncoder().encode(vault.account),
      },
      key,
      hexToBytes(vault.ciphertext),
    );
  } catch (error) {
    throw new Error("the vault does not open with this passkey (wrong secret or altered record)", {
      cause: error,
    });
  }
  const seed = new Uint8Array(plaintext);
  if (seed.length !== kMlDsa44SeedLength) {
    seed.fill(0);
    throw new Error("the vault holds no ML-DSA seed");
  }
  return seed;
}

function isHexOfLength(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * HEX_CHARS_PER_BYTE &&
    /^[0-9a-fA-F]*$/.test(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPqVault(value: unknown): value is PqVault {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: keyof PqVault): unknown => Reflect.get(value, name);
  return (
    field("version") === VAULT_VERSION &&
    isNonEmptyString(field("credentialId")) &&
    isNonEmptyString(field("account")) &&
    isNonEmptyString(field("mlDsaAddress")) &&
    isHexOfLength(field("publicKey"), kMlDsa44PublicKeyLength) &&
    isHexOfLength(field("salt"), PRF_SALT_LENGTH) &&
    isHexOfLength(field("iv"), GCM_IV_LENGTH) &&
    isHexOfLength(field("ciphertext"), kMlDsa44SeedLength + GCM_TAG_LENGTH)
  );
}

export function loadVault(): PqVault | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!isPqVault(parsed))
    throw new Error("the stored PQ vault is unreadable; clear it to start again");
  return parsed;
}

export function saveVault(vault: PqVault): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

export function clearVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Signs with the ML-DSA-44 key of the seed: pure ML-DSA, empty context, over the bytes the node
 * verifies (`STX\0 ‖ signing fields`, i.e. encodeForSigning). The caller wipes the seed.
 */
export function signTxMlDsa(defs: XrplDefinitions, tx: TxJson, seed: Uint8Array): TxJson {
  const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
  try {
    const unsigned: TxJson = { ...tx, SigningPubKey: bytesToHex(publicKey) };
    const signature = ml_dsa44.sign(hexToBytes(encodeForSigning(unsigned, defs)), secretKey);
    assertLength(signature, kMlDsa44SignatureLength, "the ML-DSA-44 signature");
    return { ...unsigned, TxnSignature: bytesToHex(signature) };
  } finally {
    secretKey.fill(0);
  }
}
