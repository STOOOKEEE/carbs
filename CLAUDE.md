# carbs: notes for coding agents

Ledger-enforced signing sessions for the XRP Ledger (a rippled amendment `SigningSessions`, a Ledger app extension with an ML-DSA-44 root key, a quantum exposure check, a TypeScript client). Read `FIANSO-SPEC.md` first (it is the reference), then `docs/ARCHITECTURE.md`.

## Rules

- `rippled/` and `ledger-app/` are **unmodified upstream imports** up to their import commits (`UPSTREAM.md`). A commit that touches them is ours: one upstream defect per commit, never mixed with the amendment. Never remove or edit an upstream test to make it pass.
- Protocol codes are never copied by hand into TypeScript: they come from `server_definitions`. Verify the codes of the spec on the imported tree before using them (spike K5).
- TypeScript strict, no `as any`, named constants (`packages/core/src/constants.ts`), low-S strict-DER signatures, `LastLedgerSequence` on every session transaction, a fresh session key per session, WebCrypto keys non-extractible.
- Ledger access is the **Device Management Kit only** (no legacy ledgerjs packages). Anything shown on a device is shown on the real Stax; anything simulated is said so in the DEVLOG.
- Use a fresh account for every spike on the public AlphaNet, never call the node's `sign` RPC with a P-256 key, never commit a secret. No third-party script in the web app.
- No security claim without a test that proves it.
- Commits and pull requests follow rippled's conventions (section 14 of the spec): `type: Imperative subject`, at most 72 characters, a body that says what and why, tests with the code they cover, PR template filled in. Squash-merge, except the documented multi-commit cases.
- Every friction with the XRPL or Ledger documentation, SDKs or the node goes in `docs/ledger-dx-feedback.md` (and `/xrpl-feedback` if the DevEx hook is installed), with honest minutes lost.
- Never send a message to a third party (mentors, reviewers, other teams) without a human reading and sending it.

## Commands

`pnpm install`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`. Daemon, protocol tests and Ledger app: see `docs/ARCHITECTURE.md`.
