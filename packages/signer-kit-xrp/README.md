# Signer xrp

This package provides a signer implementation for xrp.

## Installation

```bash
pnpm add @ledgerhq/device-signer-kit-xrp
```

## Usage

```typescript
import { SignerXrpBuilder } from "@ledgerhq/device-signer-kit-xrp";

const signer = new SignerXrpBuilder({ dmk, sessionId }).build();

// Get address
const address = await signer.getAddress("m/44'/0'/0'/0/0");

// Sign transaction
const signature = await signer.signTransaction(
  "m/44'/0'/0'/0/0",
  transactionBytes,
);
```

### Curves

The signer uses secp256k1 by default, like Ledger Wallet. For an account created with Ed25519, pass the same `curve` to both calls: on another curve, the same derivation path is a different XRPL account, and a signature made with the wrong curve is rejected by the network.

```typescript
import { Curve, SignerXrpBuilder } from "@ledgerhq/device-signer-kit-xrp";

const signer = new SignerXrpBuilder({ dmk, sessionId }).build();
const path = "44'/144'/0'/0/0";

const { observable: address$ } = signer.getAddress(path, {
  curve: Curve.Ed25519,
});

const { observable: signature$ } = signer.signTransaction(
  path,
  transactionBytes,
  { curve: Curve.Ed25519 },
);
```

With Ed25519, the public key starts with `ED` and the signature is 64 raw bytes instead of a DER signature. In both cases, its uppercase hex goes in `TxnSignature`.

Getting an Ed25519 address requires XRP app 2.8.0 or later: older versions answer `6f88`. Signing with Ed25519 works on older versions too.

### The signing prefix

`signTransaction` takes the transaction's signing fields **without** the XRPL signing prefix: the XRP app prepends `STX\0` itself (`SMT\0` for a multi-signature, when `SigningPubKey` is empty), and the kit forwards the bytes unchanged. Passing the output of an encoder that already adds the prefix (for example `encodeForSigning` of `ripple-binary-codec`) gets a signature over the prefix twice, which the network rejects. Strip the first 4 bytes, or use the encoder's form without the prefix.

## carbs extension: the ML-DSA-44 root and signing sessions

This copy of the kit (`@carbs/device-signer-kit-xrp`, imported from `LedgerHQ/device-sdk-ts` at `8ab7cdc`, see `UPSTREAM.md` at the repository root) adds the instructions of the XRP app of the carbs repository (`ledger-app/`, a fork of `LedgerHQ/app-xrp` 2.8.2): a post-quantum root key and guardrails for XRPL signing sessions. On the official app these instructions answer `6d00`. Every APDU is described in `docs/device-contract.md`.

```typescript
import { SignerXrpBuilder } from "@carbs/device-signer-kit-xrp";

const signer = new SignerXrpBuilder({ dmk, sessionId }).build();

// The 1,312-byte ML-DSA-44 public key (INS 0x10), derived on the device from the 24 words.
const { observable: publicKey$ } = signer.getPqPublicKey();

// Sign with it (INS 0x11 in chunks, the review on the device, then INS 0x12).
// Unlike signTransaction, the signing data carries STX\0: the node verifies
// pure ML-DSA-44 over the whole buffer. At most 2,048 bytes, SigningPubKey
// being the 1,312-byte key; the signature is 2,420 bytes.
const { observable: signature$ } = signer.signTransactionPq(signingData);

// The session policy set on the device (INS 0x08): default limits and profiles.
const { observable: policy$ } = signer.getSessionPolicy();
```

| Method                                     | Instructions                                                                        | Output                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `getPqPublicKey(options?)`                 | `0x10`, chunks 0 to 5 (`GetPqPublicKeyTask`)                                        | `PqPublicKey`, 1,312 bytes                                 |
| `signTransactionPq(signingData, options?)` | `0x11` in 255-byte chunks, then `0x12`, chunks 0 to 9 (`SendSignTransactionPqTask`) | `PqSignature`, 2,420 bytes                                 |
| `getSessionPolicy(options?)`               | `0x08`                                                                              | `SessionPolicy`: flags, limits in drops, the five profiles |

The matching device action factories are exported too (`GetPqPublicKeyDeviceActionFactory`, `SignTransactionPqDeviceActionFactory`, `GetSessionPolicyDeviceActionFactory`), so the flows can be nested in another device action, as the upstream factories can.

Status words added to the error mapping, answered on both signing paths before any review:

- `6815`: a session transaction (`SigningSessionSet`, `SigningSessionDelete`, or a `Batch` holding one) that the app cannot show in full; session transactions are never blind-signed, whatever the setting.
- `6986`: a session the user's session policy refuses; the device shows why.
- On `INS 0x12` only, `6982` means that no ML-DSA-44 signature is waiting.

Nothing in this extension changes the upstream methods' behaviour; the upstream tests run unedited next to the new ones.

### Building in the carbs workspace

`pnpm install` builds the kit (`scripts/build.mjs`: esbuild bundles `src/index.ts` into `lib/esm/index.js` with the path aliases resolved, tsc and tsc-alias emit `lib/types`). Tests run on upstream's Vitest 3.2.6 and the format check on upstream's Prettier 3.5.3 and settings (`config/`), so that this code stays ready for an upstream pull request (`UPSTREAM-PR.md`).

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test
pnpm test

# Lint
pnpm lint
```
