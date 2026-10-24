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
- **Passkey defect P6, verified on the public AlphaNet** (FIANSO-SPEC 6.14): a second `PasskeyListSet` on the same account fails with `tefEXCEPTION` (`A3E31459…`, after a first `tesSUCCESS` `8AC8B117…`), so a passkey can be neither rotated nor revoked. Found by reading `SetPasskeyList.cpp`, then tested with a fresh faucet account and random P-256 keys (throw-away script). Not reported upstream (D7); a decision is needed on whether we carry a fix for W2.
- **Key migration in one `Batch` does not work**: an all-or-nothing `Batch` with `SetRegularKey` + `asfDisableMaster`, master-signed, returns `tesSUCCESS` (`16A5CA91…`) but applies neither; the same `Batch` with `asfDefaultRipple` applies (`828DAF98…`). The post-quantum migration stays two clear-signed transactions.
