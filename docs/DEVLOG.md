# DEVLOG

What was done, removed, ignored or simulated, dated (New York time). This is the source of the README's "before / during" table and of the honesty slide.

## 2026-10-24

- **08:32** (before the kickoff) The v3 preparation dossier is committed in `STOOOKEEE/TTT` (`docs/carbs/`, branch `fianso`). The v2 prototype of 21-23 Oct stays where it is and is **not reused**.
- **10:42-12:06** The dossier is confronted with the team device (a Ledger Stax, firmware 1.11 = `API_LEVEL` 27, side-loading allowed), reviewed twice by an independent reviewer, and amended with the team's decisions (restart from scratch, latest XRPLF alphanet base, 10-minute sessions, opt-ins Protocol Innovation and Ledger Protocol Innovation, passkey defects in the presentation only).
- **11:24-11:34** `FIANSO-SPEC.md` (the build specification, an English consolidation of the dossier) is pushed to this repository, then the Ledger documentation feedback requirement announced at the Ledger workshop is added (section 7.6).
- **12:08** Upstream imports, unmodified: `XRPLF/rippled` alphanet at `68bd02b647` (the branch head, unchanged since 2026-10-16) and `LedgerHQ/app-xrp` master at `7b5185ff`; file counts match upstream (2300 and 6763). `UPSTREAM.md` records them.
- **12:08-12:30** Workspace skeleton, CI, pull request template, architecture and decision records (PRs #1 to #3), README. CI passes on the TypeScript side; the daemon and the Ledger app are not built in CI.
- **Installed locally** (not committed): the Ripple DevRel DevEx capture hook, team `carbs`.
- **Not done yet**: the daemon has not been built on this machine; the Ledger app has not been built or loaded on the Stax; no spike (K1 to K6) has run; the protocol codes have not been re-checked on the imported tree (spike K5).
- **Simulated**: nothing.
