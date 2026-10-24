/**
 * The device of the live backend: the contract-following software double of `@carbs/ledger`
 * (APDU by APDU) with a random seed made in this page. **SIMULATED**: it is not a Stax, and
 * the real device needs the device track's real flow. Reviews are shown by the page's
 * simulated Stax screen. Signatures are over the binary signing data of the node's
 * definitions.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  generateClassicSeed,
  signTransaction,
  type BytesSigner,
  type Definitions,
} from "@carbs/sessions";
import {
  DeviceError,
  SimulatedDevice as ContractDevice,
  deviceClassicSigner,
  deviceMlDsaSigner,
  kSw,
  reviewLines,
} from "@carbs/ledger";
import {
  DeviceRejectedError,
  type DeviceApprover,
  type DeviceKey,
  type DevicePort,
  type DeviceReview,
  type TxJson,
} from "../ports";
import { fromCoreTx } from "./result";

const DEVICE_SEED_BYTES = 64;
const MASTER_PATH = "44'/144'/0'/0/0";

type Algorithm = DeviceKey["algorithm"];

export function createLiveDevice(defs: Definitions, approver: () => DeviceApprover): DevicePort {
  function makeTransport(): ContractDevice {
    return new ContractDevice({
      defs,
      bip39Seed: crypto.getRandomValues(new Uint8Array(DEVICE_SEED_BYTES)),
      classicSeeds: {
        secp256k1: generateClassicSeed("ecdsa-secp256k1"),
        ed25519: generateClassicSeed("ed25519"),
      },
      approve: (review) =>
        approver()({
          title: review.kind === "blind" ? "Blind signing required" : "Review transaction",
          lines: review.lines.map((line) => ({ label: line.label, value: line.value })),
          simulated: true,
        }),
    });
  }
  let transport = makeTransport();
  let signers = new Map<Algorithm, Promise<BytesSigner>>();

  function signer(algorithm: Algorithm): Promise<BytesSigner> {
    let existing = signers.get(algorithm);
    if (existing === undefined) {
      existing =
        algorithm === "mldsa44"
          ? deviceMlDsaSigner(transport)
          : deviceClassicSigner(transport, MASTER_PATH, "secp256k1");
      signers.set(algorithm, existing);
    }
    return existing;
  }

  return {
    mode: "simulated",
    model: "SIMULATED Ledger Stax (software double of the device contract)",
    reset() {
      transport = makeTransport();
      signers = new Map();
    },
    async getPublicKey(algorithm) {
      const key = (await signer(algorithm)).publicKey;
      return {
        algorithm,
        publicKey: bytesToHex(key),
        address: addressFromPublicKey(key),
        publicKeyBytes: key.length,
      };
    },
    review(tx: TxJson): DeviceReview {
      const review = reviewLines(tx, defs);
      return {
        title: review.kind === "blind" ? "Blind signing required" : "Review transaction",
        lines: review.lines.map((line) => ({ label: line.label, value: line.value })),
        simulated: true,
      };
    },
    async signTransaction(algorithm, tx) {
      try {
        return fromCoreTx((await signTransaction(tx, await signer(algorithm), defs)).tx);
      } catch (error) {
        if (error instanceof DeviceError && error.statusWord === kSw.denied) {
          throw new DeviceRejectedError();
        }
        throw error;
      }
    },
  };
}
