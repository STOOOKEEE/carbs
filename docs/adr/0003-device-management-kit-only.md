# 0003. Device Management Kit only for Ledger access

**Status:** Accepted (2026-10-24)

**Context.** Two stacks reach a Ledger from a browser: the legacy ledgerjs packages (`@ledgerhq/hw-app-xrp`, `@ledgerhq/hw-transport-webhid`) and Ledger's Device Management Kit (DMK). Ledger's developer resources point to the DMK and its XRP signer. `device-signer-kit-xrp` 0.3.0 forwards the raw transaction bytes, so a transaction type the app clear-signs needs no custom command.

**Decision.** Use `@ledgerhq/device-management-kit`, `@ledgerhq/device-signer-kit-xrp` and `@ledgerhq/device-transport-kit-web-hid`. No legacy ledgerjs package in this repository. Custom APDUs (ML-DSA, P-256) are sent through the DMK.

**Consequences.** `xrpl-connect`'s current Ledger adapter is on the legacy stack; a DMK adapter is a possible contribution. The kit limits P2 to secp256k1 and Ed25519, so the stretch items need custom commands. The exact send-APDU API is confirmed in spike K6.
