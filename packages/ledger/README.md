# @carbs/ledger (`packages/ledger`)

Library on top of the Ledger Device Management Kit: the custom commands for the post-quantum root (ML-DSA public key and signature, FIANSO-SPEC.md section 7.7), a signing preview (`clear`, `blind` or `refused`) for an XRPL transaction, and session opening on the device. P-256 commands are a later item.

Status: used by the web app and the test wallet. `connectLedger` (`src/webhid.ts`) opens a real device over WebHID with the Device Management Kit 1.11.0, and a SIMULATED device follows the same contract, the session policy and the per-app profiles included. Device Management Kit only, never the legacy ledgerjs packages.
