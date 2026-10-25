# @carbs/ledger (`packages/ledger`)

Library on top of the Ledger Device Management Kit and Ledger's XRP signer kit: the commands for the post-quantum root (ML-DSA public key and signature, FIANSO-SPEC.md section 7.7), the session policy, a signing preview (`clear`, `blind` or `refused`) for an XRPL transaction, and session opening on the device. P-256 commands are a later item.

Status: used by the web app and the test wallet. `connectLedger` (`src/webhid.ts`) opens a real device over WebHID with the Device Management Kit 1.11.0 and binds to it `@carbs/device-signer-kit-xrp`: Ledger's `@ledgerhq/device-signer-kit-xrp` 0.3.0, imported unmodified into `packages/signer-kit-xrp` and extended there, in the kit's own style, with the instructions of this repository's XRP app (`getPqPublicKey`, `signTransactionPq`, `getSessionPolicy`, the session status words). Device Management Kit only, never the legacy ledgerjs packages.

Every command runs one of the kit's device actions (`src/kit.ts`):

| Function                                        | Kit                                      | Instructions        |
| ----------------------------------------------- | ---------------------------------------- | ------------------- |
| `getClassicPublicKey(device, path, curve, opt)` | `getAddress`                             | `0x02`              |
| `signClassic(device, path, curve, fields)`      | `signTransaction`                        | `0x04`              |
| `getAppConfig(device)`                          | `getAppConfig` (a connected Ledger only) | `0x06`              |
| `getSessionPolicy(device)`                      | `getSessionPolicy`                       | `0x08`              |
| `getMlDsaPublicKey(device)`                     | `getPqPublicKey`                         | `0x10`              |
| `signMlDsa(device, signingData)`                | `signTransactionPq`                      | `0x11`, then `0x12` |

On a `LedgerDevice` from `connectLedger()` they call the kit's `SignerXrp` (`device.signer`), so the DMK runs them on its session (`dmk.executeDeviceAction`, the kit's OpenApp step skipped: the XRP app must be open). On any other `ApduTransport`, they run the kit's exported device action factories over `exchange`: the SIMULATED device of `src/simulated-device.ts`, which follows the same contract, the session policy and the per-app profiles included, sees the bytes the kit sends to a Stax. A status word is a `DeviceError` (`kind` `sessionPolicyRefused` for `0x6986`, `sessionBlindRefused` for `0x6815`); `describeLedgerError` turns it, or a DMK error, into a message.

Tests: the device contract against the simulated device (review lines, signatures verified with `@noble/post-quantum` and `ripple-keypairs`, the session policy), the APDU framing over a fake DMK session, and the real-device path through a real `SignerXrp` built on a `DeviceManagementKit` whose `executeDeviceAction` runs each action against the simulated device (`src/kit.test.ts`). **Nothing here ran on a device**: the kit path was not tried on a Stax yet.
