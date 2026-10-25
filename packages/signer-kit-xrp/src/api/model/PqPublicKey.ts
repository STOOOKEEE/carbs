/**
 * The ML-DSA-44 public key of the XRP app's post-quantum root, 1,312 raw
 * bytes. Its uppercase hex is the `SigningPubKey` of a transaction the key
 * signs; the account it controls is the AccountID of that key, as for any
 * other key type.
 */
export type PqPublicKey = Uint8Array;
