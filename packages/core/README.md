# @carbs/sessions (`packages/core`)

Client library for signing sessions and the quantum exposure check (FIANSO-SPEC.md sections 8.2, 8.3 and 8.7). No DOM state, no framework; WebCrypto, `fetch` and `WebSocket` are the only platform APIs it uses.

| Module                 | What it does                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `constants.ts`         | Limits of the protocol, key formats, offsets; never a protocol code                                                                                                                                                            |
| `definitions.ts`       | `loadDefinitions(node)` / `parseDefinitions(answer)`: codec, transaction types, result codes and flags by name, from `server_definitions`                                                                                      |
| `encode.ts`            | `encodeForSigning` (`STX\0` prefix, for WebCrypto, passkeys, ML-DSA), `encodeForDevice` (no prefix, for the Ledger app), `encodeTx`, tx id                                                                                     |
| `der.ts`               | WebCrypto `r ‖ s` → low-S → strict DER                                                                                                                                                                                         |
| `keys/p256-session.ts` | `createSessionKey()`: non-extractible P-256, `0xF6 ‖ X ‖ Y`, fresh per session                                                                                                                                                 |
| `keys/passkey.ts`      | `PasskeyListSet`, `signWithPasskey` (WebAuthn challenge = signing data), `browserAuthenticator`, `SoftwareAuthenticator` (tests, SIMULATED)                                                                                    |
| `keys/mldsa.ts`        | ML-DSA-44 with `@noble/post-quantum` 0.7.1: pure, empty context, over the full signing data                                                                                                                                    |
| `keys/classic.ts`      | secp256k1 / Ed25519 from an XRPL seed (master-signed steps, tests)                                                                                                                                                             |
| `session.ts`           | `buildSessionSet` (optional `maxPerTxDrops` in mode C, optional `witness`), `buildSessionDelete`, `signWithSessionKey` (refuses a missing `LastLedgerSequence`), `signAsWitness` (`WTS\0` co-signature), `signingSessionIndex` |
| `node.ts`              | `JsonRpcClient`, `WebSocketClient` (public methods only), `fetchCommonFields`, `submitAndWait`, `getLedgerEntry`, `getAccountObjects`                                                                                          |
| `errors.ts`            | `NodeResultError` and the four `tefSESSION_*` errors (`tefSESSION_NO_WITNESS` included), with the rule that produced each                                                                                                      |
| `quantum/exposure.ts`  | `checkExposure(address, node, defs)`: `exposed`, `no-exposure-found` or `unknown`, with the transaction that first revealed each key                                                                                           |
| `quantum/migration.ts` | `buildPqMigration` (SetRegularKey by the master, proof by the ML-DSA key, asfDisableMaster by the master) and `runPqMigration` with its guards                                                                                 |
| `testing/`             | `RecordedNode`, `RecordingNode`, SIMULATED session definitions (`@carbs/sessions/testing`)                                                                                                                                     |

```ts
import {
  createSessionKey,
  buildSessionSet,
  signWithSessionKey,
  loadDefinitions,
  JsonRpcClient,
} from "@carbs/sessions";
import { checkExposure } from "@carbs/sessions/quantum";
```

Every session transaction carries `LastLedgerSequence`; a session key is never reused; codes come from the node. `pnpm --filter @carbs/sessions test` runs the unit tests (recorded node answers, no network).
