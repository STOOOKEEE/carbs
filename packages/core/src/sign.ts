/** Single signatures: one shape for every key type the client holds. */

import { addressFromPublicKey, type KeyType } from "./address.js";
import { bytesToHex } from "./bytes.js";
import type { Definitions } from "./definitions.js";
import { encodeForSigning, encodeTx, transactionHash, type TxJson } from "./encode.js";

/** A key that signs raw bytes: the signing data `STX\0 ‖ fields` is what it receives. */
export interface BytesSigner {
  readonly keyType: KeyType;
  /** The public key as the node reads it from `SigningPubKey`. */
  readonly publicKey: Uint8Array;
  /** The signature placed in `TxnSignature` (DER for ECDSA, raw for Ed25519 and ML-DSA). */
  sign(signingData: Uint8Array): Promise<Uint8Array>;
}

export interface SignedTx {
  /** The transaction with `SigningPubKey` and its signature. */
  tx: TxJson;
  /** The blob to submit. */
  blob: string;
  /** The transaction id. */
  hash: string;
}

export function signerAddress(signer: Pick<BytesSigner, "publicKey">): string {
  return addressFromPublicKey(signer.publicKey);
}

/** Set `SigningPubKey`, sign `STX\0 ‖ fields`, and return the signed transaction. */
export async function signTransaction(
  tx: TxJson,
  signer: BytesSigner,
  defs: Definitions,
): Promise<SignedTx> {
  const unsigned: TxJson = { ...tx, SigningPubKey: bytesToHex(signer.publicKey) };
  delete unsigned["TxnSignature"];
  const signature = await signer.sign(encodeForSigning(unsigned, defs));
  const signed: TxJson = { ...unsigned, TxnSignature: bytesToHex(signature) };
  const blob = encodeTx(signed, defs);
  return { tx: signed, blob, hash: transactionHash(blob) };
}

/** Assemble a transaction whose signature was made elsewhere (for example on the device). */
export function assembleSigned(
  tx: TxJson,
  publicKey: Uint8Array,
  signature: Uint8Array,
  defs: Definitions,
): SignedTx {
  const signed: TxJson = {
    ...tx,
    SigningPubKey: bytesToHex(publicKey),
    TxnSignature: bytesToHex(signature),
  };
  const blob = encodeTx(signed, defs);
  return { tx: signed, blob, hash: transactionHash(blob) };
}
