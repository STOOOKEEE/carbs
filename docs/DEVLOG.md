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
- **Not done yet**: the Ledger app has not been built or loaded on the Stax; no spike (K1 to K8) has run; the protocol codes have not been re-checked on the imported tree (spike K5).
- **Simulated**: nothing.

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

These are the base failures. A later run counts a failure as ours only if it is not in this list.
