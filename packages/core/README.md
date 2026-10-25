# @carbs/sessions (`packages/core`)

Client library for signing sessions and the quantum exposure check (FIANSO-SPEC.md sections 8.2, 8.3 and 8.7). No DOM state, no framework; WebCrypto, `fetch` and `WebSocket` are the only platform APIs it uses.

| Module                 | What it does                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants.ts`         | Limits of the protocol, key formats, offsets; never a protocol code                                                                                                                                                                                                                                                 |
| `definitions.ts`       | `loadDefinitions(node)` / `parseDefinitions(answer)`: codec, transaction types, result codes and flags by name, from `server_definitions`                                                                                                                                                                           |
| `encode.ts`            | `encodeForSigning` (`STX\0` prefix, for WebCrypto, passkeys, ML-DSA), `encodeForDevice` (no prefix, for the Ledger app), `encodeTx`, tx id                                                                                                                                                                          |
| `der.ts`               | WebCrypto `r ‖ s` → low-S → strict DER                                                                                                                                                                                                                                                                              |
| `keys/p256-session.ts` | `createSessionKey()`: non-extractible P-256, `0xF6 ‖ X ‖ Y`, fresh per session                                                                                                                                                                                                                                      |
| `keys/passkey.ts`      | `PasskeyListSet`, `signWithPasskey` (WebAuthn challenge = signing data; an ML-DSA-44 credential goes to `signWithMlDsaPasskey`), `browserAuthenticator` (optional transports and timeout), `SoftwareAuthenticator` (tests, SIMULATED)                                                                               |
| `keys/pq-passkey.ts`   | Post-quantum passkeys (COSE -48, amendment `PasskeyMLDSA`): `browserCreateMlDsaPasskey`, `mlDsaPasskeyFromAttestation`, `parseAttestationObject`, `parseAuthenticatorData`, `mlDsa44PublicKeyFromCose`, `signWithMlDsaPasskey`, `mlDsaAssertionProblem`, `SoftwareMlDsaAuthenticator` (tests, SIMULATED). See below |
| `cbor.ts`              | The CBOR subset WebAuthn needs (`attestationObject`, COSE keys): `decodeCbor`, `decodeCborItem`, `encodeCbor`                                                                                                                                                                                                       |
| `keys/mldsa.ts`        | ML-DSA-44 with `@noble/post-quantum` 0.7.1: pure, empty context, over the full signing data                                                                                                                                                                                                                         |
| `keys/classic.ts`      | secp256k1 / Ed25519 from an XRPL seed (master-signed steps, tests)                                                                                                                                                                                                                                                  |
| `session.ts`           | `buildSessionSet` (optional `maxPerTxDrops` in mode C, optional `witness`), `buildSessionDelete`, `signWithSessionKey` (needs the current ledger; refuses a missing `LastLedgerSequence` or one beyond the node's window), `signAsWitness` (`WTS\0` co-signature), `signingSessionIndex`                            |
| `node.ts`              | `JsonRpcClient`, `WebSocketClient` (public methods only), `fetchCommonFields`, `submitAndWait`, `getLedgerEntry`, `getAccountObjects`                                                                                                                                                                               |
| `errors.ts`            | `NodeResultError` and the four `tefSESSION_*` errors (`tefSESSION_NO_WITNESS` included), with the rule that produced each                                                                                                                                                                                           |
| `quantum/exposure.ts`  | `checkExposure(address, node, defs)`: `exposed`, `no-exposure-found` or `unknown`, with the transaction that first revealed each key                                                                                                                                                                                |
| `quantum/migration.ts` | `buildPqMigration` (SetRegularKey by the master, proof by the ML-DSA key, asfDisableMaster by the master) and `runPqMigration` with its guards                                                                                                                                                                      |
| `testing/`             | `RecordedNode`, `RecordingNode`, SIMULATED session definitions, the two software authenticators (`@carbs/sessions/testing`)                                                                                                                                                                                         |

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

## Post-quantum passkeys (client side of `PasskeyMLDSA`)

The node side is PR #113 (amendment `PasskeyMLDSA`, ID `AB013F4537CED2FB1AC4C784B59DA5CB5FC41A753EF2D5EFFE7A96275D1BB1AC`, which needs `Passkey` and `Quantum`); its specification, `docs/XLS-PQ-Passkeys.md` section 6, is on that branch until it merges. These notes are the client side of that section. The amendment adds no field, transaction type or result code, so nothing new is read from `server_definitions`: `PasskeyListSet`, `Passkeys`, `PasskeySignature` and its members are the alphanet `Passkey` names the codec already gets from the node.

**Register.**

```ts
const credential = await browserCreateMlDsaPasskey(navigator.credentials, {
  rpId: location.hostname,
  rpName: "carbs",
  userName: "alice",
}); // pubKeyCredParams [{alg: -48}], authenticatorAttachment "cross-platform"
const tx = buildPasskeyListSet(account, [credential]); // signed by a key the account trusts
```

`browserCreateMlDsaPasskey` reads the key from the `attestationObject`, not from `getPublicKey()`, which gives no SPKI for -48. `mlDsaPasskeyFromAttestation` parses the CBOR `attestationObject` and the attested credential of its `authenticatorData`, checks that the credential id equals `rawId` and that `rpIdHash` is `SHA-256(rpId)`, and requires a COSE AKP key (`kty` 7, `alg` -48, `pub` of 1,312 bytes, no `priv`). `pub` goes into `PublicKey` as it is, and the credential id becomes `PasskeyID`. The attestation statement (`packed` ES256 on the Stax, `none` in the software authenticator) is not verified. The ledger does not use it: the key counts because the account's own key signed the `PasskeyListSet`.

**Sign.**

```ts
const signed = await signWithPasskey(
  tx,
  credential,
  browserAuthenticator(navigator.credentials, { transports: ["usb"] }),
  rpId,
  defs,
);
```

`signWithPasskey` sends a 1,312-byte key to `signWithMlDsaPasskey`. That function:

1. sets `SigningPubKey` to the key and removes any `TxnSignature`;
2. passes `encodeForSigning(tx)` (`STX\0 ‖ fields`, about 1.4 KB) as the raw WebAuthn challenge;
3. writes `PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}` with the 2,420 raw signature bytes, with no DER and no low-S rewriting.

Before it returns, `mlDsaAssertionProblem` runs the node's stateless checks: `clientDataJSON` is an object, `type` is `webauthn.get`, `challenge` decodes byte for byte to the signing data, and the signature is pure ML-DSA-44 with an empty context over `authenticatorData ‖ SHA-256(clientDataJSON)`. A faulty authenticator is therefore reported in the client, not as the node's bare "Invalid signature.". `verify: false` and `passkeyId` exist only to build transactions the node must refuse. P-256 passkeys take the same path as before.

**Tested** (`keys/pq-passkey.test.ts`, `cbor.test.ts`, SIMULATED authenticator):

- COSE parsing and the exact AKP header bytes;
- the refusal of ES256, ML-DSA-65, a wrong size or a private part;
- `packed` and `none` attestations, extensions after the key, a mismatched `rawId` or relying party;
- the challenge equal to the signing data, with no padding;
- the signature verified with `@noble/post-quantum` (and failing with a context, over the bare signing data or with another key);
- `PasskeyID` equal to the listed id;
- nine assertions the node would refuse, each named by the client check (the node's own answers are in the live run);
- P-256 and ML-DSA-44 keys in one list.

Mutations of the alg check, the `rawId` check, the challenge comparison and the `PasskeyID` each fail a test. Against a live node, `apps/passkey-wallet/scripts/pq-passkey-demo.ts` runs registration, payment, three forged assertions, a session and the lock.

**Not verified:** whether a browser forwards `alg: -48` to a roaming authenticator and accepts the credential, and whether a 1.4 KB challenge passes every browser. The software authenticator stands in for the device in every test. The Ledger Stax path (PR #109's Security Key app) has not been run.
