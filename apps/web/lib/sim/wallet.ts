/**
 * SIMULATED browser wallet: master key of a Mac account, passkey, session keys. No
 * WebAuthn prompt is ever shown and no WebCrypto key is made: the keys come from
 * keys.ts. The live wallet (M2) uses packages/core: a non-extractible P-256 WebCrypto key
 * for a Mac account's session, an ML-DSA-44 key generated in the client for a Ledger
 * account's.
 */
import type { KeyAlgorithm, KeyHandle, TxJson, WalletPort } from "../ports";
import { accountIdOf, signWith, simPublicKey } from "./keys";

function handle(algorithm: KeyAlgorithm, publicKey: string, passkey: boolean): KeyHandle {
  return {
    algorithm,
    publicKey,
    address: accountIdOf(publicKey),
    async sign(tx: TxJson): Promise<TxJson> {
      const signed = signWith(publicKey, tx);
      if (!passkey) return signed;
      return {
        ...signed,
        PasskeySignature: {
          simulated: true,
          PasskeyID: publicKey.slice(0, 16),
          AuthenticatorData: "SIMULATED",
          ClientDataJSON: "SIMULATED",
        },
      };
    },
  };
}

export class SimulatedWallet implements WalletPort {
  readonly mode = "simulated" as const;
  private counter = 0;

  private next(label: string): string {
    this.counter += 1;
    return `wallet:${label}:${this.counter}`;
  }

  async createMasterKey(): Promise<KeyHandle> {
    return handle("secp256k1", simPublicKey("secp256k1", this.next("master")), false);
  }

  async createPasskey(): Promise<KeyHandle> {
    return handle("p256", simPublicKey("p256", this.next("passkey")), true);
  }

  async createSessionKey(algorithm: "p256" | "mldsa44"): Promise<KeyHandle> {
    return handle(algorithm, simPublicKey(algorithm, this.next("session")), false);
  }
}
