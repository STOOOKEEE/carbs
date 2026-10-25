/**
 * The device's ML-DSA-44 key derivation, reproduced for vectors and the simulated device
 * (`ledger-app/src/pq/pq_root.c:4-11`, `:60-110`):
 *   seed = BIP39(mnemonic)                          (PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic")
 *   m    = HMAC-SHA512("Symmetric key seed", seed)   (SLIP-21 master node)
 *   node = HMAC-SHA512(m[0..32], 0x00 ‖ "carbs ML-DSA-44")
 *   xi   = node[32..64]                              (FIPS 204 ML-DSA.KeyGen_internal seed)
 * Verified on Speculos against the app with the SLIP-21 seed fix (two mnemonics,
 * `docs/device-contract.md` section 4); not yet on the real Stax. Builds before that fix derived
 * KeyGen_internal(32 zero bytes) on every device, so they never matched this derivation.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha512 } from "@noble/hashes/sha2.js";

const kBip39Rounds = 2048;
const kSlip21MasterKey = new TextEncoder().encode("Symmetric key seed");
/** `PQ_SLIP21_LABEL` without its leading 0x00. */
export const kPqSlip21Label = "carbs ML-DSA-44";

export function bip39Seed(mnemonic: string, passphrase = ""): Uint8Array {
  const encoder = new TextEncoder();
  return pbkdf2(
    sha512,
    encoder.encode(mnemonic.normalize("NFKD")),
    encoder.encode(`mnemonic${passphrase}`.normalize("NFKD")),
    {
      c: kBip39Rounds,
      dkLen: 64,
    },
  );
}

/** SLIP-21 node of a label path: 64 bytes, the last 32 are the key (SLIP-0021, "Key derivation"). */
export function slip21Node(seed: Uint8Array, labels: readonly string[]): Uint8Array {
  let node = hmac(sha512, kSlip21MasterKey, seed);
  for (const label of labels) {
    const message = new Uint8Array([0, ...new TextEncoder().encode(label)]);
    node = hmac(sha512, node.subarray(0, 32), message);
  }
  return node;
}

/** The 32-byte ML-DSA seed the device derives. */
export function deviceMlDsaSeed(seed: Uint8Array): Uint8Array {
  return slip21Node(seed, [kPqSlip21Label]).slice(32, 64);
}
