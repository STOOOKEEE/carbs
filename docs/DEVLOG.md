# DEVLOG

What was done, removed, ignored or simulated, dated. This is the source of the README's prior-work note and of the final presentation.

## 2026-10-24

- The specification (`FIANSO-SPEC.md`) is added, then amended with the Ledger documentation feedback requirement (section 7.6). It consolidates the preparation dossier kept in `STOOOKEEE/TTT` (`docs/carbs/`). The earlier prototype stays where it is and is **not reused**.
- The team device is a Ledger Stax, firmware 1.11 (`API_LEVEL` 27, the level of the SDK image), side-loading allowed.
- Upstream imports, unmodified: `XRPLF/rippled` alphanet at `68bd02b647` (the branch head, unchanged since 2026-10-16) and `LedgerHQ/app-xrp` master at `7b5185ff`. File counts match upstream (2300 and 6763). `UPSTREAM.md` records them.
- Workspace skeleton, CI, pull request template, architecture and decision records, README (pull requests #1 to #4). CI covers the TypeScript side only; the daemon and the Ledger app are not built in CI.
- The scope is widened to a post-quantum root on the device, a quantum exposure check with migration, and community tooling (a Device Management Kit adapter for `xrpl-connect`, a `create-xrp` template). The agent payment scene is reserved, not planned.
- Licence: Apache-2.0 for the code written here.
- Installed locally and not committed: the Ripple DevRel DevEx capture hook.
- The daemon of this repository is built from `rippled/` (Debug, with the existing Conan cache): `xrpld version 3.4.1+DEBUG`; the upstream `PasskeyListSet` suite passes on the imported tree (11 cases, 250 tests, 0 failures). Recipe in `docs/BUILDING.md`.
- **Not done yet**: the Ledger app has not been built or loaded on the Stax; no spike (K1 to K8) had run at that point; the protocol codes had not been re-checked on the imported tree (spike K5 has run since: see "Plan check, spike K5 and review gate 1").
- **Simulated**: nothing at that point; the entries below say what is simulated.

### N0: test baselines of the imported tree

Run on `rippled/` as imported (`git diff 516f6a5 HEAD -- rippled/` is empty, tree `3e3f112e`), Debug build, Apple clang 17, arm64 macOS, where `char` is signed. No test was edited, skipped or removed.

`./xrpld --unittest --unittest-jobs=6` (from `rippled/build`): 627.7 s, 280 suites, 5334 cases, 1,285,447 tests, **204 failures**, and `ValidatorSiteV2` did not complete ("The child process may have crashed"). Every suite with a failure was run again alone (`./xrpld --unittest=xrpl.app.<Suite>`):

| Suite                     | Failures (6 jobs) | Alone | First failure                                                                                                                                          |
| ------------------------- | ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AMMBinned`               | 152               | 152   | `tecINVARIANT_FAILED` instead of `tesSUCCESS` at `rippled/src/test/app/AMMBinned_test.cpp:313`; the log says "Invariant failed: a MPToken was created" |
| `AMMCurves`               | 41                | 41    | `tecPATH_DRY` instead of `tesSUCCESS` at `rippled/src/test/app/AMMCurves_test.cpp:1469`                                                                |
| `InvariantsVault`         | 2                 | 2     | `tecLIMIT_EXCEEDED` instead of `tesSUCCESS` at `rippled/src/test/app/invariants/InvariantsVault_test.cpp:3035`                                         |
| `ValidatorList_Dilithium` | 2                 | 2     | reads a validator list from an absolute path on the upstream author's machine (`rippled/src/test/app/ValidatorListDRandom_test.cpp:150-158`)           |
| `ValidatorListExpiration` | 2                 | 2     | "expires() returned nullopt" and "secp256k1 VL backward compatibility broken" (`rippled/src/test/app/ValidatorListExpiration_test.cpp:204`, `:383`)    |
| `Delegate`                | 1                 | 1     | the delegable-type counter: 71 counted, 60 pinned (`rippled/src/test/app/Delegate_test.cpp:2846-2855`)                                                 |
| `MPToken`                 | 1                 | 1     | `rippled/src/test/app/MPToken_test.cpp:2095`, in "MPT Issue Invalid in Transaction"                                                                    |
| `SignatureVerification`   | 1                 | 0     | passes alone                                                                                                                                           |
| `ValidatorSite`           | 1                 | 0     | "database is locked" with parallel jobs; passes alone                                                                                                  |
| `ValidatorSiteV2`         | did not complete  | 0     | passes alone (86 cases)                                                                                                                                |

201 failures repeat, in seven suites; the other three suites fail only when several jobs run at once. Of the upstream suites the specification names, `PasskeyListSet`, `AccountDelete` and `PassKey` pass and `Delegate` fails only its counter test, so for `Delegate` "green before and after" means "no new failure" (see `docs/PLAN-CHECK.md`). Suites the next tasks rely on pass: `Batch`, `Beneficiary`, `Firewall`, `Sponsor`, `InvariantsBeneficiary`, `HashRouter`, `NetworkOPs`, `STTx`, `Feature`, `ServerDefinitions`, `LedgerEntry`, `AccountObjects`, `TxQMetaInfo`, `TxQPosNegFlows`.

`./xrpl_tests` (the gtest binary, built with `cmake --build . --target xrpl_tests`): 1120 tests from 240 suites in 52 s, 1119 passed, **1 failed**: `VaultTests.BuilderFromSleRoundTrip` ("Field 'DealingInterval' may not be explicitly set to default.", `rippled/src/tests/libxrpl/protocol_autogen/ledger_entries/VaultTests.cpp:258`; `sfDealingInterval` is `SoeDefault` in `rippled/include/xrpl/protocol/detail/ledger_entries.macro:643`), the same when run alone; 3 upstream tests are disabled (`DISABLED_` consensus simulations).

Header levelization (rippled's `.github/scripts/levelization/generate.py`, run on a scratch copy so that its results folder in the tree is left alone): the imported tree has one dependency that the committed `results/ordering.txt` lacks, `test.server > xrpl.rdb`, from `rippled/src/test/server/Wallet_test.cpp:10`. Not ours; left as it is.

These are the base failures. `docs/base-failures.txt` lists them one failing assertion per line (file, line and message); a later run counts a failure as ours when it adds a line there.

### Plan check, spike K5 and review gate 1

- `docs/PLAN-CHECK.md` lists, for every task in scope, the files we will touch and the upstream code we mirror, each with the full `path:line` of the imported tree. Every citation was printed again and read (its section 6).
- **Spike K5, code part done.** Every code of spec section 6.1 is free on the imported tree and in the `server_definitions` answers of a standalone node of this build and of the public AlphaNet, which are identical (`hash` `34614C84…C3C5`). Nothing is renumbered. The device-track branch uses the same numbers for every field the app parses. The encode round trip of K5 waits for `packages/core` (task W1), once N2 exposes the new types.
- **Deviation: "green before and after" is judged per assertion.** Before any change, the upstream `Delegate` suite fails its delegable-type counter (71 counted, 60 pinned at `rippled/src/test/app/Delegate_test.cpp:2846`) and `MPToken` fails its completeness assertion (`rippled/src/test/app/MPToken_test.cpp:2095`). The spec asks these suites to stay green; they are not green before any change, so a run counts as clean when it adds no line to `docs/base-failures.txt`. Re-pinning the `Delegate` counter is not allowed: both session types are `NotDelegable` and leave it at 71. N2 adds a `SigningSessionSet` case to the `MPToken` completeness test, so that our type is covered instead of hidden in a set that is already not empty.
- **Deviation: the device track** (the Ledger app, loading it on the Stax, K4, K6, photographs of the screens) belongs to a teammate, the device-track owner (decision D5, partly settled). These goals build the protocol, the client, the device contract and a simulated device, and never touch a device.
- **Deviation, planned: the passkey wallet** (an account that signs with its passkey only, after `SetRegularKey` to the blackhole address and `asfDisableMaster`) is not in spec section 8.5. It is built with the client, and that spec section is updated in the pull request that adds it.
- **SIMULATED, P5 before any change.** With a software WebAuthn authenticator (no device, no browser ceremony), a payment from an account, signed through WebAuthn by a P-256 passkey of its list, was refused by the unchanged tree with `invalidTransaction`, "fails local checks: Invalid signature." `./xrpld --unittest=PasskeyWebAuthn` with the draft test gave: `#26 failed: apply (rippled/src/test/app/PasskeyWebAuthn_test.cpp:94): Got telENV_RPC_FAILED (Unit test RPC failure.); Expected tesSUCCESS`, `#27 failed: PasskeyWebAuthn_test.cpp(96)`, "1 suite, 2 cases, 65 tests total, 2 failures". The challenge it sent equals the signing data and holds bytes at or above `0x80`. `char` is signed on this machine. N1 records the fix.
- **Review gate 1, round 1** (an independent reviewer, model Opus, read-only, given `PLAN.md`, the spec and `docs/PLAN-CHECK.md`): `VERDICT: CHANGES REQUIRED`. Blocking: the `MPToken` completeness test would hide our type, and the "green before and after" reading needed this entry. Non-blocking: the activation of a P5 fix had to be argued in both directions and cover a third `BAD` site; N1 lands as a test pull request, then a fix pull request; rows for W3 and W7; N2 risks (generated code behind the macros, a hand-written `jss` name, transaction settings); the `feature` listing of N9 is unverified; the citation command missed short references; two line numbers were off. Applied in `docs/PLAN-CHECK.md`, in `docs/base-failures.txt` (the failures per assertion) and in this entry.
- **Review gate 1, round 2:** `VERDICT: APPROVED`. Its non-blocking findings are applied before merging: the **SIMULATED** labels and the output above; the cost and the rules each caller uses, worded exactly; the WebAuthn condition narrowed to a P-256 `SigningPubKey` with `sfPasskeySignature`; every refusal next to an accepted control; the preconditions of the peer test; the suites of the fix pull request and the full run for code in `apply.cpp`, `NetworkOPs.cpp` or `PeerImp.cpp`; raw messages in `docs/base-failures.txt`; small accuracy fixes. One is applied differently from its wording: the reviewer asked to document that a forced signature verdict is not honoured before the fix; it is honoured instead, with one more private router flag, because ledger replay would otherwise stop reproducing a pre-fix ledger that holds a WebAuthn transaction. Review gate 2 checks it on the fix pull request.
- **Process:** the N1 test was written and run once on this machine while round 1 ran, to learn whether a fix was needed. Nothing was committed or opened as a pull request before the verdict.

### N1: the WebAuthn challenge comparison (P5)

**SIMULATED:** every result here comes from a software WebAuthn authenticator (`rippled/src/test/jtx/webauthn.h`). No device and no browser ceremony was used.

- **Test first.** The authenticator and the refusals landed first (`test:` pull request). Before any change, on this machine (`char` signed), a valid WebAuthn payment was refused with `invalidTransaction`, "fails local checks: Invalid signature." (output in "Plan check, spike K5 and review gate 1"). P5 is confirmed.
- **Fix**, a separate `fix:` commit gated by a new amendment, `fixPasskeyChallenge` (top of `features.macro`, `Supported::Yes`, `DefaultNo`). With it, the challenge is compared with the signing data as two `Slice`s; without it, the old comparison stays. Only that comparison changes.
- **Activation.** While the amendment is disabled, a transaction signed through WebAuthn (a P-256 `SigningPubKey` with `sfPasskeySignature`) bypasses the signature cache of `checkValidity`, so no verdict crosses the activation in either direction. `NetworkOPs` and `PeerImp` do not mark it `BAD` either. A verdict forced by `forceValidity` (cluster relay, ledger replay, signature checks off) still holds: one more private router flag, `PRIVATE9` on the unused bit `0x0020`, records it. `isSignatureVerdictCacheable` holds the condition in one place. Cost: one WebAuthn verification per `checkValidity` call for such a transaction, until the amendment is enabled.
- **Tests** (suites `PasskeyWebAuthn` and `PasskeyRelay`):
  - a challenge with a byte at or above `0x80`, under both amendment states;
  - every refusal next to an accepted control;
  - the same signed blob refused before the amendment and accepted after it;
  - `checkValidity` with one router and the rules of both eras;
  - a forced verdict on both sides of the fix;
  - the condition itself;
  - `NetworkOPs::processTransaction`;
  - a copy relayed by an overlay test peer.

  Before the amendment, a signature is refused where `char` is signed and accepted where it is unsigned. The unsigned branch is **UNVERIFIED** here, since this machine has signed `char`.

- **Also in the fix:** an `API-CHANGELOG.md` entry for the `submit` error condition, and one new levelization dependency, `test.overlay > xrpl.core`.
- `infra/standalone.cfg` (N9) has to enable `fixPasskeyChallenge`, otherwise every WebAuthn transaction fails on that node. The public AlphaNet serves the definitions of the imported tree (K5) and has no such amendment, so its answer to a WebAuthn transaction may depend on its validators' platforms (**UNVERIFIED**; spike K2 is not run).
- Kept to the facts on purpose: no upstream pull request and no message about this defect (decision D7).
