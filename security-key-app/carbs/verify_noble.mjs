// carbs: cross-check the output of mldsa_passkey_test.py (--out file) with @noble/post-quantum,
// the ML-DSA-44 library @carbs/core pins: pure ML-DSA-44, empty context, over
// AuthenticatorData || SHA-256(ClientDataJSON), key SigningPubKey.
// Usage: node verify_noble.mjs passkey-signature.json   (with @noble/post-quantum@0.7.1 installed)
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";

const json = JSON.parse(readFileSync(process.argv[2], "utf8"));
const hex = (s) => Uint8Array.from(Buffer.from(s, "hex"));
const publicKey = hex(json.SigningPubKey);
const { AuthenticatorData, ClientDataJSON, Signature } = json.PasskeySignature;
const message = Buffer.concat([
  hex(AuthenticatorData),
  createHash("sha256").update(hex(ClientDataJSON)).digest(),
]);
const ok = publicKey.length === 1312 && hex(Signature).length === 2420 && ml_dsa44.verify(hex(Signature), message, publicKey);
console.log(ok ? "@noble/post-quantum: signature verifies" : "@noble/post-quantum: signature does NOT verify");
process.exit(ok ? 0 : 1);
