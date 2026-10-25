/**
 * A `DevicePort` over the device contract of `@carbs/ledger`: the keys and signatures come from
 * whatever answers the APDUs, the software double (`device.ts`, SIMULATED) or a real Ledger
 * Stax over USB (`ledger-device.ts`). Signatures are over the binary signing data of the node's
 * definitions. A refusal on the device is `DeviceRejectedError`; any other device error reaches
 * the person through `describeLedgerError`.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  signTransaction,
  type BytesSigner,
  type Definitions,
} from "@carbs/sessions";
import {
  DeviceError,
  describeLedgerError,
  deviceClassicSigner,
  deviceMlDsaSigner,
  kDefaultXrpPath,
  kSw,
  reviewLines,
  type Review,
  type XrpTransport,
} from "@carbs/ledger";
import {
  DeviceRejectedError,
  type BackendMode,
  type DeviceKey,
  type DevicePort,
  type DeviceReview,
} from "../ports";
import { fromCoreTx } from "./result";

type Algorithm = DeviceKey["algorithm"];

/** The device contract reports a refusal on the screen as status word 0x6985. */
export function isDeviceRefusal(error: unknown): boolean {
  return (
    error instanceof DeviceRejectedError ||
    (error instanceof DeviceError && error.statusWord === kSw.denied)
  );
}

/**
 * What the page shows for an error a device call threw: `DeviceRejectedError` for a refusal on
 * the device, the error itself when it is already readable, else `describeLedgerError` (a status
 * word hint, or a Device Management Kit error, which is a plain object).
 */
export function toDeviceError(error: unknown): Error {
  if (isDeviceRefusal(error)) {
    return error instanceof DeviceRejectedError ? error : new DeviceRejectedError();
  }
  if (error instanceof Error && !(error instanceof DeviceError)) return error;
  return new Error(describeLedgerError(error), { cause: error });
}

export function deviceReview(review: Review, simulated: boolean): DeviceReview {
  return {
    title: review.kind === "blind" ? "Blind signing required" : "Review transaction",
    lines: review.lines.map((line) => ({ label: line.label, value: line.value })),
    simulated,
  };
}

export interface ContractDeviceOptions {
  defs: Definitions;
  mode: BackendMode;
  model: string;
  /** The review is shown by the page's simulated Stax screen (true) or by the Stax itself. */
  simulated: boolean;
  /** The device the next APDU goes to. */
  transport: () => XrpTransport;
  /** Called by `reset()` before the keys are read again. */
  onReset?: () => void;
}

export function createContractDevice(options: ContractDeviceOptions): DevicePort {
  const { defs } = options;
  let signers = new Map<Algorithm, Promise<BytesSigner>>();

  function signer(algorithm: Algorithm): Promise<BytesSigner> {
    const existing = signers.get(algorithm);
    if (existing !== undefined) return existing;
    const transport = options.transport();
    const pending =
      algorithm === "mldsa44"
        ? deviceMlDsaSigner(transport)
        : deviceClassicSigner(transport, kDefaultXrpPath, "secp256k1");
    const cache = signers;
    cache.set(algorithm, pending);
    // A failed read (app closed, device locked) must not be cached: the next call asks again.
    pending.catch(() => cache.delete(algorithm));
    return pending;
  }

  async function onDevice<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toDeviceError(error);
    }
  }

  return {
    mode: options.mode,
    model: options.model,
    reset() {
      options.onReset?.();
      signers = new Map();
    },
    getPublicKey(algorithm) {
      return onDevice(async () => {
        const key = (await signer(algorithm)).publicKey;
        return {
          algorithm,
          publicKey: bytesToHex(key),
          address: addressFromPublicKey(key),
          publicKeyBytes: key.length,
        };
      });
    },
    review(tx) {
      return deviceReview(reviewLines(tx, defs), options.simulated);
    },
    signTransaction(algorithm, tx) {
      return onDevice(async () =>
        fromCoreTx((await signTransaction(tx, await signer(algorithm), defs)).tx),
      );
    },
  };
}
