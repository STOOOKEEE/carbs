/**
 * The client side of the device contract: classical public key and signature (as app-xrp does
 * today), and the ML-DSA-44 root key instructions of the device track (FIANSO-SPEC.md section 7.7).
 */

import { kMlDsa44PublicKeyLength, kMlDsa44SignatureLength, kTxSignPrefix } from "@carbs/sessions";
import {
  encodeBip32Path,
  exchangeOk,
  kApduMaxData,
  kCla,
  kInsGetPublicKey,
  kInsPqGetPublicKey,
  kInsPqGetSignature,
  kInsPqSign,
  kInsSign,
  kMaxRawTx,
  kP1Confirm,
  kP1MaskMore,
  kP1MaskOrder,
  kP1NonConfirm,
  kP2ChainCode,
  kP2Ed25519,
  kP2NoChainCode,
  kP2Secp256k1,
  kPqChunk,
  kPqMaxMessage,
  kPqP1First,
  kPqP1Next,
  kPqP2Last,
  kPqP2More,
  type ApduTransport,
} from "./apdu.js";

export type DeviceCurve = "secp256k1" | "ed25519";

export class DeviceContractError extends Error {
  override readonly name = "DeviceContractError";
}

function curveP2(curve: DeviceCurve): number {
  return curve === "secp256k1" ? kP2Secp256k1 : kP2Ed25519;
}

export interface ClassicPublicKey {
  /** 33 bytes: compressed secp256k1, or `0xED ‖ key` for Ed25519. */
  publicKey: Uint8Array;
  address: string;
  chainCode: Uint8Array | undefined;
}

/** `INS 0x02`: answer `[33] pubkey [n] address [32 chain code]` (`ledger-app/src/apdu/messages/get_public_key.c:38-50`). */
export async function getClassicPublicKey(
  transport: ApduTransport,
  path: string,
  curve: DeviceCurve,
  options: { confirm?: boolean; chainCode?: boolean } = {},
): Promise<ClassicPublicKey> {
  const data = await exchangeOk(transport, {
    cla: kCla,
    ins: kInsGetPublicKey,
    p1: options.confirm ? kP1Confirm : kP1NonConfirm,
    p2: curveP2(curve) | (options.chainCode ? kP2ChainCode : kP2NoChainCode),
    data: encodeBip32Path(path),
  });
  const keyLength = data[0] ?? 0;
  const publicKey = data.slice(1, 1 + keyLength);
  const addressLength = data[1 + keyLength] ?? 0;
  const addressStart = 2 + keyLength;
  const address = new TextDecoder().decode(data.slice(addressStart, addressStart + addressLength));
  const rest = data.slice(addressStart + addressLength);
  return { publicKey, address, chainCode: options.chainCode ? rest.slice(0, 32) : undefined };
}

/**
 * `INS 0x04`: the serialized transaction **without** `STX\0` (the app prepends it,
 * `ledger-app/src/apdu/messages/sign_transaction.c:251-263`), the first chunk led by the BIP32 path.
 * Answers a DER secp256k1 signature or a 64-byte Ed25519 signature.
 */
export async function signClassic(
  transport: ApduTransport,
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
  const pathBytes = encodeBip32Path(path);
  const payload = new Uint8Array(pathBytes.length + transaction.length);
  payload.set(pathBytes);
  payload.set(transaction, pathBytes.length);
  let answer: Uint8Array = new Uint8Array();
  for (let offset = 0, index = 0; offset < payload.length; offset += kApduMaxData, index += 1) {
    const chunk = payload.slice(offset, offset + kApduMaxData);
    const more = offset + kApduMaxData < payload.length;
    answer = await exchangeOk(transport, {
      cla: kCla,
      ins: kInsSign,
      p1: (index === 0 ? 0 : kP1MaskOrder) | (more ? kP1MaskMore : 0),
      p2: curveP2(curve),
      data: chunk,
    });
  }
  return answer;
}

/** `INS 0x10`: the 1 312-byte ML-DSA-44 public key in 250-byte chunks; chunk 0 derives it. */
export async function getMlDsaPublicKey(transport: ApduTransport): Promise<Uint8Array> {
  const out = new Uint8Array(kMlDsa44PublicKeyLength);
  const chunks = Math.ceil(kMlDsa44PublicKeyLength / kPqChunk);
  for (let index = 0; index < chunks; index += 1) {
    const chunk = await exchangeOk(transport, {
      cla: kCla,
      ins: kInsPqGetPublicKey,
      p1: index,
      p2: 0,
      data: new Uint8Array(),
    });
    out.set(chunk, index * kPqChunk);
  }
  return out;
}

/**
 * `INS 0x11` then `0x12`: send `STX\0 ‖ fields` (at most 2 048 bytes, the 1 312-byte `SigningPubKey`
 * included), the device reviews it through the app's parser, answers the signature length on the
 * last chunk, then the 2 420-byte signature is read in 250-byte chunks.
 */
export async function signMlDsa(
  transport: ApduTransport,
  signingData: Uint8Array,
): Promise<Uint8Array> {
  if (!kTxSignPrefix.every((b, i) => signingData[i] === b)) {
    throw new DeviceContractError("the ML-DSA path takes the signing data with its STX\\0 prefix");
  }
  if (signingData.length > kPqMaxMessage) {
    throw new DeviceContractError(`the device signs at most ${kPqMaxMessage} bytes with ML-DSA`);
  }
  let lengthAnswer: Uint8Array = new Uint8Array();
  for (let offset = 0; offset < signingData.length; offset += kApduMaxData) {
    const last = offset + kApduMaxData >= signingData.length;
    lengthAnswer = await exchangeOk(transport, {
      cla: kCla,
      ins: kInsPqSign,
      p1: offset === 0 ? kPqP1First : kPqP1Next,
      p2: last ? kPqP2Last : kPqP2More,
      data: signingData.slice(offset, offset + kApduMaxData),
    });
  }
  const length = ((lengthAnswer[0] ?? 0) << 8) | (lengthAnswer[1] ?? 0);
  if (length !== kMlDsa44SignatureLength) {
    throw new DeviceContractError(
      `expected a ${kMlDsa44SignatureLength}-byte signature, the device announced ${length}`,
    );
  }
  const signature = new Uint8Array(length);
  for (let index = 0; index * kPqChunk < length; index += 1) {
    const chunk = await exchangeOk(transport, {
      cla: kCla,
      ins: kInsPqGetSignature,
      p1: index,
      p2: 0,
      data: new Uint8Array(),
    });
    signature.set(chunk, index * kPqChunk);
  }
  return signature;
}
