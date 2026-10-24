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
- **Post-quantum root on the Stax, first proof (spike K4 / L2).** A throw-away app built from `LedgerHQ/app-boilerplate` derived an ML-DSA-44 key on the device and signed on the public AlphaNet (network 24100): fresh account `rs3drHLeUPmQmnYNmeVGnFwY68xDnA5G8T`; `SetRegularKey` to the device's ML-DSA key (`E3D53D69…`, master key); `AccountSet asfDisableMaster` (`80D644C8…`, master key: the node answers `tecNEED_MASTER_KEY` when the regular key signs it); a 1 XRP `Payment` signed with ML-DSA-44 on the Stax and verified with `@noble/post-quantum` before submission, `tesSUCCESS` (`B55E26D1E387C2D277A9EA8F7AE4AC1F98FEFE6A28796DB51F4EFD30710C698D`); the old classical key then gets `tefMASTER_DISABLED`. The spike screen showed the message size and a SHA-256 prefix, **not** the decoded transaction (blind), and derived the key from a BIP32 key (not allowed by section 7.7 of the spec); that spike is not part of this repository.
- The feature is moved into `ledger-app/` (`src/pq/`, instructions `0x10` to `0x12`, Stax / Flex / Apex P only): SLIP-21 derivation (label `carbs ML-DSA-44`), low-RAM ML-DSA, working buffers overlaid on the transaction context (`.bss` ≈ 25 KB instead of ≈ 31 KB). It builds for Stax and Nano S Plus.
- **Loaded on the Stax and proven on the AlphaNet** with the XRP app itself (host side still a local script, not the DMK): fresh account `rpxMtodcdjFGpssK5k7D4CixifFBCLS7eV`, ML-DSA key account `rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2`; `SetRegularKey` `0CBD8C74…`; `asfDisableMaster` `B9EB8FB4…` (master key); 1 XRP `Payment` signed with ML-DSA-44 on the device, verified with `@noble/post-quantum`, `tesSUCCESS` (`7654683C8DBBD091941A6BBD369DA25F0E5888B2C5C21A1340DFDCD6C652436B`); the classical key then gets `tefMASTER_DISABLED`. The review screen is still blind (size and SHA-256 prefix).
- Friction met with the Ledger SDK and tools is logged in `docs/ledger-dx-feedback.md` (fifteen entries today).
