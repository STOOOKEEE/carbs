/**
 * An ML-DSA-44 signature as the XRP app returns it: 2,420 raw bytes, pure
 * ML-DSA-44 with an empty context over the whole signing data (`STX\0` and
 * the fields), which is what the XRPL node verifies. Its uppercase hex goes in
 * `TxnSignature`.
 */
export type PqSignature = Uint8Array;
