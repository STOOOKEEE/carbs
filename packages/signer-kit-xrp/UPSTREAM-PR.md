# Draft: an upstream pull request to `LedgerHQ/device-sdk-ts`

**Not sent.** A draft for the owner, who decides whether and when to open it. Base: `develop` at `8ab7cdcaac6330ae6667a9b47cefe152c4968308` (`@ledgerhq/device-signer-kit-xrp` 0.3.0).

Our commits on top of the import are in this repository (`git log <import commit>..HEAD -- packages/signer-kit-xrp`, see `UPSTREAM.md`). Only the `src/` changes and their tests belong in an upstream pull request; the build and config copies of `scripts/` and `config/`, `UPSTREAM-PR.md` and the carbs section of the README are ours alone.

## Suggested title

`✨ (signer-xrp): Add the ML-DSA-44 root, the session policy and the session status words for XRP app forks`

(their gitmoji convention; one pull request per feature may be easier to review, in the order below)

## Motivation

XRPL signing sessions (an amendment draft, `SigningSessions`) and a post-quantum root key (ML-DSA-44, which the XRPL AlphaNet already verifies as `KeyType::Dilithium`) need three things from the XRP app that the official app does not have yet: a second key type, guardrails for session transactions, and a user policy edited on the device. The carbs fork of app-xrp (2.8.2) implements them; the client needed the matching commands. Instead of sending those APDUs by hand next to the kit, we added them to the kit, in its layers: commands with `getApdu`/`parseResponse` and typed errors, tasks for the chunked exchanges, device actions and their factories, use cases, DI modules and `SignerXrp` methods with JSDoc. Nothing in the upstream methods changes, and the kit's 106 tests pass unedited.

We know these instructions exist only in a fork of app-xrp today, so the commands are opt-in: on the official app they answer `6d00`, which the kit already maps. If app-xrp gains an equivalent, the commands would follow its numbering; we would rather align than diverge.

## What it adds

| `SignerXrp` method                         | APDUs                                                                                                                                                     | Layers                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPqPublicKey(options?)`                 | `E0 10 <chunk> 00`, chunks 0 to 5 of the 1,312-byte key (250-byte answers; chunk 0 derives it from the seed)                                              | `GetPqPublicKeyCommand`, `ReadPqChunksTask`, `GetPqPublicKeyTask`, `GetPqPublicKeyDeviceActionFactory` (`CallTaskInAppDeviceAction`), `GetPqPublicKeyUseCase`                                         |
| `signTransactionPq(signingData, options?)` | `E0 11` in 255-byte chunks (P1 `00` first then `01`, P2 `01` on the last), the review, then `E0 12 <chunk> 00`, chunks 0 to 9 of the 2,420-byte signature | `SignTransactionPqCommand`, `GetPqSignatureCommand`, `SendSignTransactionPqTask`, `SignTransactionPqDeviceAction` (built like `SignTransactionDeviceAction`), its factory, `SignTransactionPqUseCase` |
| `getSessionPolicy(options?)`               | `E0 08 00 00`, a 175-byte answer (format version 2) parsed into a typed `SessionPolicy`                                                                   | `GetSessionPolicyCommand`, `GetSessionPolicyDeviceActionFactory` (`SendCommandInAppDeviceAction`), `GetSessionPolicyUseCase`                                                                          |

Also:

- A separate map, `XRP_SESSION_APP_ERRORS` (which spreads `XRP_APP_ERRORS`, left unchanged), maps for the ML-DSA sign command `6815` (a session transaction the app cannot show in full: never blind-signed) and `6986` (refused by the session policy), with messages; on `INS 0x12` only, `6982` means that no signature is waiting.
- `SignerXrp.signTransaction` and the README now say that the app prepends `STX\0` itself and that the kit forwards the bytes unchanged, which our integration log found missing (a client passing `encodeForSigning` output gets the prefix signed twice). This part applies to the official app and could be its own small pull request.
- `signTransactionPq` takes the signing data **with** `STX\0`, since the node verifies pure ML-DSA-44 over the whole buffer; the task refuses data without the prefix or above 2,048 bytes before any APDU.

## Tests

Vitest, next to the sources, in the kit's style: the APDU bytes of every command and chunk position, response parsing and its refusals, chunking and reassembly (including a short or long chunk refused), errors stopping each exchange, the new device action's states (as the upstream `SignTransactionDeviceAction` tests do), and the wiring of factories, use cases, binder and signer. 205 tests in all, 106 of them upstream's, unedited.

Run on Vitest 3.2.6, as the monorepo pins it: on Vitest 4 the upstream `SignTransactionDeviceAction` tests (and ours, built the same way) fail with "is not a constructor", because `vi.fn(() => ({ ... }))` is used as a class mock.

## Not done, and what a reviewer should know

- **No device test.** Nothing of this extension was run on a real device: the commands were tested against mocks and against carbs' software double of the app contract. The same instructions, sent by an earlier hand-written client (in 250-byte `0x11` chunks where the kit sends 255; the app accepts any chunk size up to 255), were proven on a Stax with the carbs app: its ML-DSA-44 signatures were accepted by the public AlphaNet.
- ESLint was not run: the monorepo's ESLint config is private. Import order and lint rules may need fixes. Prettier 3.5.3 with the monorepo's settings passes.
- Adding methods to the `SignerXrp` interface is a breaking change for anyone who implements it (a mock, a wrapper); callers are not affected.
- The extension targets a fork of app-xrp. Its instructions (`0x08`, `0x10` to `0x12`) and status words (`6815`, `6986`) are documented in carbs' `docs/device-contract.md`.

## Checklist before sending

- [ ] Rebase on the current `develop` and re-run the kit's tests, lint and Prettier inside the monorepo.
- [ ] Add a changeset (`minor`) per feature.
- [ ] Decide with Ledger whether fork-only commands belong in the official kit, or as a separate package.
- [ ] Remove carbs-specific wording (`ledger-app/`, the fork's name) from the JSDoc if they prefer neutral references.
