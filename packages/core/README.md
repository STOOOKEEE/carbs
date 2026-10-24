# @carbs/sessions (`packages/core`)

Client library for signing sessions: definitions read from the node's `server_definitions`, transaction encoding, session key lifecycle (WebCrypto, non-extractible), `SigningSessionSet` / `SigningSessionDelete` builders, passkey and Ledger opening, node client, typed errors.

Status: skeleton. The module list and the rules (named constants, `LastLedgerSequence` on every session transaction, low-S strict-DER signatures, a fresh key per session) are in `FIANSO-SPEC.md` section 8.2 and in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md).
