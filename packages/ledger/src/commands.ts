/**
 * The client side of the device contract: classical public key and signature (as app-xrp does
 * today), and the ML-DSA-44 root key instructions of the device track (FIANSO-SPEC.md section 7.7).
 * Every command runs through Ledger's XRP signer kit, extended for this repository's app
 * (`./kit.ts`); this module keeps the contract's own checks and types.
 */

import { Curve } from "@carbs/device-signer-kit-xrp";
import {
  hexToBytes,
  kMlDsa44PublicKeyLength,
  kMlDsa44SignatureLength,
  kTxSignPrefix,
} from "@carbs/sessions";
import {
  kInsGetAppConfiguration,
  kInsGetPublicKey,
  kInsPqGetPublicKey,
  kInsPqSign,
  kInsSign,
  kMaxRawTx,
  kPqMaxMessage,
} from "./apdu.js";
import { kitFlows, kSkipOpenApp, runDeviceAction, type XrpTransport } from "./kit.js";

export type DeviceCurve = "secp256k1" | "ed25519";

export class DeviceContractError extends Error {
  override readonly name = "DeviceContractError";
}

function kitCurve(curve: DeviceCurve): Curve {
  return curve === "secp256k1" ? Curve.Secp256k1 : Curve.Ed25519;
}

export interface ClassicPublicKey {
  /** 33 bytes: compressed secp256k1, or `0xED ‖ key` for Ed25519. */
  publicKey: Uint8Array;
  address: string;
  chainCode: Uint8Array | undefined;
}

/**
 * `INS 0x02` (the kit's `getAddress`): answer `[33] pubkey [n] address [32 chain code]`
 * (`ledger-app/src/apdu/messages/get_public_key.c:38-50`).
 */
export async function getClassicPublicKey(
  transport: XrpTransport,
  path: string,
  curve: DeviceCurve,
  options: { confirm?: boolean; chainCode?: boolean } = {},
): Promise<ClassicPublicKey> {
  const address = await runDeviceAction(
    kitFlows(transport).getAddress(path, {
      checkOnDevice: options.confirm ?? false,
      returnChainCode: options.chainCode ?? false,
      skipOpenApp: kSkipOpenApp,
      curve: kitCurve(curve),
    }),
    kInsGetPublicKey,
  );
  return {
    publicKey: hexToBytes(address.publicKey),
    address: address.address,
    chainCode:
      options.chainCode && address.chainCode !== undefined
        ? hexToBytes(address.chainCode)
        : undefined,
  };
}

/**
 * `INS 0x04` (the kit's `signTransaction`): the serialized transaction **without** `STX\0` (the
 * app prepends it, `ledger-app/src/apdu/messages/sign_transaction.c:251-263`, and the kit forwards
 * the bytes unchanged), the first chunk led by the BIP32 path. Answers a DER secp256k1 signature
 * or a 64-byte Ed25519 signature.
 */
export async function signClassic(
  transport: XrpTransport,
  path: string,
  curve: DeviceCurve,
  transaction: Uint8Array,
): Promise<Uint8Array> {
  if (transaction.length + kTxSignPrefix.length > kMaxRawTx) {
    throw new DeviceContractError(`the app buffers at most ${kMaxRawTx} bytes`);
  }
  if (
    transaction.length >= kTxSignPrefix.length &&
    kTxSignPrefix.every((b, i) => transaction[i] === b)
  ) {
    throw new DeviceContractError("the classical path takes the fields without the STX\\0 prefix");
  }
  return runDeviceAction(
    kitFlows(transport).signTransaction(path, transaction, {
      skipOpenApp: kSkipOpenApp,
      curve: kitCurve(curve),
    }),
    kInsSign,
  );
}

/** `INS 0x10` (the kit's `getPqPublicKey`): the 1 312-byte ML-DSA-44 public key in 250-byte chunks. */
export async function getMlDsaPublicKey(transport: XrpTransport): Promise<Uint8Array> {
  const publicKey = await runDeviceAction(
    kitFlows(transport).getPqPublicKey({ skipOpenApp: kSkipOpenApp }),
    kInsPqGetPublicKey,
  );
  if (publicKey.length !== kMlDsa44PublicKeyLength) {
    throw new DeviceContractError(
      `expected a ${kMlDsa44PublicKeyLength}-byte ML-DSA-44 key, the device gave ${publicKey.length}`,
    );
  }
  return publicKey;
}

/**
 * `INS 0x11` then `0x12` (the kit's `signTransactionPq`): send `STX\0 ‖ fields` (at most 2 048
 * bytes, the 1 312-byte `SigningPubKey` included), the device reviews it through the app's parser,
 * answers the signature length on the last chunk, then the 2 420-byte signature is read in 250-byte
 * chunks. A status word of either instruction is reported against `0x11`.
 */
export async function signMlDsa(
  transport: XrpTransport,
  signingData: Uint8Array,
): Promise<Uint8Array> {
  if (!kTxSignPrefix.every((b, i) => signingData[i] === b)) {
    throw new DeviceContractError("the ML-DSA path takes the signing data with its STX\\0 prefix");
  }
  if (signingData.length > kPqMaxMessage) {
    throw new DeviceContractError(`the device signs at most ${kPqMaxMessage} bytes with ML-DSA`);
  }
  const signature = await runDeviceAction(
    kitFlows(transport).signTransactionPq(signingData, { skipOpenApp: kSkipOpenApp }),
    kInsPqSign,
  );
  if (signature.length !== kMlDsa44SignatureLength) {
    throw new DeviceContractError(
      `expected a ${kMlDsa44SignatureLength}-byte signature, the device gave ${signature.length}`,
    );
  }
  return signature;
}

/**
 * `INS 0x06` (the kit's `getAppConfig`): the version of the open XRP app. Only on a real Ledger
 * from `connectLedger()`: the kit exports no device action for it to run over another
 * transport, and the SIMULATED device does not answer `0x06`.
 */
export async function getAppConfig(transport: XrpTransport): Promise<{ version: string }> {
  if (transport.signer === undefined) {
    throw new DeviceContractError(
      "the app configuration is read through the kit's signer of a connected Ledger",
    );
  }
  return runDeviceAction(
    transport.signer.getAppConfig({ skipOpenApp: kSkipOpenApp }),
    kInsGetAppConfiguration,
  );
}
