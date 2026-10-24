/**
 * SIMULATED browser wallet: master key of a Mac account, passkey, session keys. The
 * passkey is a real P-256 key held by the software authenticator of @carbs/sessions (no
 * prompt, no device); master and session keys come from keys.ts. The live wallet (M2) uses packages/core: a non-extractible P-256 WebCrypto key
 * for a Mac account's session, an ML-DSA-44 key generated in the client for a Ledger
 * account's.
 */
import { SoftwareAuthenticator } from "@carbs/sessions";
import type { KeyAlgorithm, KeyHandle, TxJson, WalletPort } from "../ports";
import { passkeyKeyHandle } from "../wallets/passkey";
import { accountIdOf, signWith, simPublicKey } from "./keys";

function handle(algorithm: KeyAlgorithm, publicKey: string): KeyHandle {
  return {
    algorithm,
    publicKey,
    address: accountIdOf(publicKey),
    async sign(tx: TxJson): Promise<TxJson> {
      return signWith(publicKey, tx);
    },
  };
}

const SIM_RP_ID = "carbs.invalid";

export class SimulatedWallet implements WalletPort {
  readonly mode = "simulated" as const;
  private counter = 0;

  private next(label: string): string {
    this.counter += 1;
    return `wallet:${label}:${this.counter}`;
  }

  async createMasterKey(): Promise<KeyHandle> {
    return handle("secp256k1", simPublicKey("secp256k1", this.next("master")));
  }

  async createPasskey(): Promise<KeyHandle> {
    // A real WebAuthn assertion from the software authenticator: SIMULATED device, real P-256.
    this.next("passkey");
    const authenticator = new SoftwareAuthenticator(`https://${SIM_RP_ID}`);
    return passkeyKeyHandle(authenticator.credential, authenticator, SIM_RP_ID);
  }

  async createSessionKey(algorithm: "p256" | "mldsa44"): Promise<KeyHandle> {
    return handle(algorithm, simPublicKey(algorithm, this.next("session")));
  }
}
