# 0004. Session keys are non-extractible P-256 WebCrypto keys, fresh per session

**Status:** Accepted (2026-10-24). Superseded in part by [0011](0011-two-account-profiles.md): this applies to Mac accounts; a Ledger account's session key is ML-DSA-44.

**Context.** The session key lives in the browser and signs without a prompt. alphanet verifies raw P-256 signatures (SHA-256, DER, no low-S rule). The `LastLedgerSequence` window (256 ledgers) can exceed a session's lifetime, so a held transaction could land under a later session opened with the same key.

**Decision.** `crypto.subtle.generateKey` ECDSA P-256, `extractable: false`, public key `0xF6 ‖ X ‖ Y`, signature normalized to low-S and strict DER. A new key for every session. Every session transaction carries `LastLedgerSequence` (about +150).

**Consequences.** A script in the page can still ask the key to sign, so the ledger-side bounds are what limit the damage (CSP `script-src 'self'`, short duration). If the P-256 spike fails, the fallback is a WebCrypto Ed25519 key.
