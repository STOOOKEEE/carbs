/**
 * The wallet of the live backend, on `@carbs/sessions`: the keys are real keys and the
 * signatures are made over the binary signing data of the node's own definitions.
 * - master key: a secp256k1 key from a fresh family seed, kept in memory;
 * - passkey: the browser's WebAuthn (or the software authenticator in tests, SIMULATED),
 *   signing `encodeForSigning` as the challenge through `signWithPasskey`;
 * - session key: a non-extractible P-256 WebCrypto key (Mac account) or an ML-DSA-44 key
 *   generated here (Ledger account), a fresh one per session.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  classicSignerFromSeed,
  createSessionKey,
  generateClassicSeed,
  generateMlDsaSeed,
  mlDsaSignerFromSeed,
  signTransaction,
  signWithPasskey,
  type BytesSigner,
  type Definitions,
} from "@carbs/sessions";
import type { KeyAlgorithm, KeyHandle, WalletPort } from "../ports";
import type { PasskeySource } from "../wallets/adapters";
import { fromCoreTx } from "./result";

function handleFor(algorithm: KeyAlgorithm, signer: BytesSigner, defs: Definitions): KeyHandle {
  return {
    algorithm,
    publicKey: bytesToHex(signer.publicKey),
    address: addressFromPublicKey(signer.publicKey),
    async sign(tx) {
      return fromCoreTx((await signTransaction(tx, signer, defs)).tx);
    },
  };
}

export class LiveWallet implements WalletPort {
  readonly mode = "live" as const;

  constructor(
    private readonly defs: Definitions,
    private readonly passkeys: PasskeySource,
  ) {}

  async createMasterKey(): Promise<KeyHandle> {
    const signer = classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1"));
    return handleFor("secp256k1", signer, this.defs);
  }

  async createPasskey(): Promise<KeyHandle> {
    const { credential, authenticator, rpId } = await this.passkeys.material();
    const defs = this.defs;
    return {
      algorithm: "p256",
      credentialId: bytesToHex(credential.credentialId),
      publicKey: bytesToHex(credential.publicKey),
      address: addressFromPublicKey(credential.publicKey),
      async sign(tx) {
        return fromCoreTx((await signWithPasskey(tx, credential, authenticator, rpId, defs)).tx);
      },
    };
  }

  async createSessionKey(algorithm: "p256" | "mldsa44"): Promise<KeyHandle> {
    const signer =
      algorithm === "p256" ? await createSessionKey() : mlDsaSignerFromSeed(generateMlDsaSeed());
    return handleFor(algorithm, signer, this.defs);
  }
}
