// Signing XRPL transactions on the device: the classical account key (clear signing
// through the signer kit) and the post-quantum root (ML-DSA-44, FIANSO-SPEC 7.7).
// Every signature is verified locally before it is used.

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { type XrplDefinitionsBase, encodeForSigning } from "ripple-binary-codec";
import { deriveAddress, verify } from "ripple-keypairs";

import { type LedgerAccount, type LedgerXrp, send } from "./device.ts";

export type TxJson = Record<string, unknown>;

/** XRPL single-signing prefix STX\0: 4 bytes the XRP app adds itself before signing. */
const SIGNING_PREFIX_BYTES = 4;
const CLA = 0xe0;
/** ML-DSA instructions of the carbs XRP app (ledger-app/src/pq): public key, sign, signature. */
const INS_PQ_PUBLIC_KEY = 0x10;
const INS_PQ_SIGN = 0x11;
const INS_PQ_SIGNATURE = 0x12;
/** The app sends and receives ML-DSA data in chunks of this size. */
const PQ_CHUNK = 250;
const MLDSA44_PUBLIC_KEY_BYTES = 1312;
const MLDSA44_SIGNATURE_BYTES = 2420;

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function apdu(
  ins: number,
  p1: number,
  p2: number,
  data: Uint8Array = new Uint8Array(0),
): Uint8Array {
  return Uint8Array.of(CLA, ins, p1, p2, data.length, ...data);
}

/** Fields the device adds to a transaction it signs. */
export interface SignatureFields {
  SigningPubKey: string;
  TxnSignature: string;
}

/** Signs with the account key; the device shows the transaction in clear. */
export async function signWithLedger<T extends TxJson>(
  ledger: LedgerXrp,
  defs: XrplDefinitionsBase,
  tx: T,
): Promise<T & SignatureFields> {
  const unsigned = { ...tx, SigningPubKey: ledger.account.publicKey };
  const signingData = encodeForSigning(unsigned, defs);
  const signature = bytesToHex(
    await ledger.signTransaction(hexToBytes(signingData).subarray(SIGNING_PREFIX_BYTES)),
  );
  if (!verify(signingData, signature, ledger.account.publicKey)) {
    throw new Error("the Ledger signature does not verify under the account key");
  }
  return { ...unsigned, TxnSignature: signature };
}

/** The device's ML-DSA-44 public key and the XRPL address it hashes to. */
export async function getPqAccount(ledger: LedgerXrp): Promise<LedgerAccount> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let index = 0; length < MLDSA44_PUBLIC_KEY_BYTES; index++) {
    const chunk = await send(ledger, apdu(INS_PQ_PUBLIC_KEY, index, 0));
    chunks.push(chunk);
    length += chunk.length;
  }
  const publicKey = bytesToHex(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
  return { address: deriveAddress(publicKey), publicKey };
}

/**
 * Signs with the ML-DSA-44 root: the device parses the signing data and shows it in clear,
 * then signs with pure ML-DSA and an empty context, as the node verifies it.
 */
export async function signWithLedgerPq<T extends TxJson>(
  ledger: LedgerXrp,
  defs: XrplDefinitionsBase,
  pqKey: LedgerAccount,
  tx: T,
): Promise<T & SignatureFields> {
  const unsigned = { ...tx, SigningPubKey: pqKey.publicKey };
  const message = hexToBytes(encodeForSigning(unsigned, defs));
  for (let offset = 0; offset < message.length; offset += PQ_CHUNK) {
    const first = offset === 0 ? 0 : 1;
    const last = offset + PQ_CHUNK >= message.length ? 1 : 0;
    await send(ledger, apdu(INS_PQ_SIGN, first, last, message.subarray(offset, offset + PQ_CHUNK)));
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (let index = 0; length < MLDSA44_SIGNATURE_BYTES; index++) {
    const chunk = await send(ledger, apdu(INS_PQ_SIGNATURE, index, 0));
    chunks.push(chunk);
    length += chunk.length;
  }
  const signature = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
  if (!ml_dsa44.verify(signature, message, hexToBytes(pqKey.publicKey))) {
    throw new Error("the ML-DSA signature of the Ledger does not verify under its public key");
  }
  return { ...unsigned, TxnSignature: bytesToHex(signature) };
}
