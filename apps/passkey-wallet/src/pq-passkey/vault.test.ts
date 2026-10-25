import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import {
  addressFromPublicKey,
  kMlDsa44PublicKeyLength,
  kMlDsa44SeedLength,
  kMlDsa44SignatureLength,
  mlDsaKeyPairFromSeed,
} from "@carbs/sessions";
import { standaloneDefinitions } from "@carbs/sessions/testing";
import { encodeForSigning } from "ripple-binary-codec";
import { describe, expect, it } from "vitest";

import { bytesToHex, hexToBytes } from "../hex.ts";
import type { TxJson } from "../ledger.ts";
import { type PqVault, openSeed, sealSeed, signTxMlDsa } from "./vault.ts";

const PRF_SECRET_LENGTH = 32;
const PRF_SALT_LENGTH = 32;
const ACCOUNT = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const OTHER_ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const CREDENTIAL_ID = "Y3JlZGVudGlhbA";

const random = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

async function sealed(): Promise<{ prfSecret: Uint8Array; seed: Uint8Array; vault: PqVault }> {
  const prfSecret = random(PRF_SECRET_LENGTH);
  const seed = random(kMlDsa44SeedLength);
  const vault = await sealSeed(prfSecret, seed, {
    credentialId: CREDENTIAL_ID,
    account: ACCOUNT,
    salt: random(PRF_SALT_LENGTH),
  });
  return { prfSecret, seed, vault };
}

describe("PQ vault", () => {
  it("opens what it sealed and records the ML-DSA key of the seed", async () => {
    const { prfSecret, seed, vault } = await sealed();
    const { publicKey } = mlDsaKeyPairFromSeed(seed);
    expect(vault.version).toBe(1);
    expect(vault.account).toBe(ACCOUNT);
    expect(vault.credentialId).toBe(CREDENTIAL_ID);
    expect(vault.publicKey).toBe(bytesToHex(publicKey));
    expect(vault.mlDsaAddress).toBe(addressFromPublicKey(publicKey));
    expect(hexToBytes(vault.iv)).toHaveLength(12);
    expect(vault.ciphertext).not.toContain(bytesToHex(seed));
    expect(await openSeed(prfSecret, vault)).toEqual(seed);
  });

  it("refuses another PRF secret", async () => {
    const { vault } = await sealed();
    await expect(openSeed(random(PRF_SECRET_LENGTH), vault)).rejects.toThrow();
  });

  it("refuses a tampered ciphertext", async () => {
    const { prfSecret, vault } = await sealed();
    const bytes = hexToBytes(vault.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    await expect(
      openSeed(prfSecret, { ...vault, ciphertext: bytesToHex(bytes) }),
    ).rejects.toThrow();
  });

  it("binds the record to its account (AAD)", async () => {
    const { prfSecret, vault } = await sealed();
    await expect(openSeed(prfSecret, { ...vault, account: OTHER_ACCOUNT })).rejects.toThrow();
  });

  it("signs with ML-DSA-44 over the bytes the node verifies", () => {
    const defs = standaloneDefinitions().codec;
    const seed = random(kMlDsa44SeedLength);
    const tx: TxJson = {
      TransactionType: "AccountSet",
      Account: ACCOUNT,
      Fee: "10",
      Sequence: 1,
    };
    const signed = signTxMlDsa(defs, tx, seed);
    const publicKeyHex = signed["SigningPubKey"];
    const signatureHex = signed["TxnSignature"];
    if (typeof publicKeyHex !== "string" || typeof signatureHex !== "string") {
      throw new Error("signTxMlDsa left SigningPubKey or TxnSignature out");
    }
    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(signatureHex);
    expect(publicKey).toHaveLength(kMlDsa44PublicKeyLength);
    expect(signature).toHaveLength(kMlDsa44SignatureLength);
    expect(publicKey).toEqual(mlDsaKeyPairFromSeed(seed).publicKey);
    // encodeForSigning keeps only the signing fields: TxnSignature is left out.
    const message = hexToBytes(encodeForSigning(signed, defs));
    expect(ml_dsa44.verify(signature, message, publicKey)).toBe(true);
  });
});
