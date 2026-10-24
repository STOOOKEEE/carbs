# 0008. A post-quantum root on the device; session keys are P-256 by default and ML-DSA when asked

**Status:** Accepted (2026-10-24). Superseded in part by [0011](0011-two-account-profiles.md): the session key follows the account profile (ML-DSA-44 on a Ledger account, P-256 on a Mac account) instead of a default.

**Context.** A public key becomes visible once an account has signed, and a quantum computer could later forge signatures for it. XRPL can rotate keys without changing the address. ML-DSA signatures are large (2 420 bytes for ML-DSA-44) and the Stax has 36 KB of SRAM, so signing on the device is the expensive step, while a browser can sign with ML-DSA cheaply. Ledger's own note says the pre-hash ML-DSA variant does not fit clear signing.

**Decision.** The long-lived root key is an ML-DSA-44 key held by the Stax, which parses and displays the transaction, then signs it with pure ML-DSA over the fully buffered message. Daily use goes through sessions: the session key is a non-extractible P-256 WebCrypto key by default (cheap, bounded by the ledger), and can be an ML-DSA key generated in the client (`@noble/post-quantum`) when the whole path must be post-quantum. If the device cannot hold ML-DSA in RAM (spike K4), signing falls back to the client, and every document says so.

**Consequences.** The device needs a smaller-buffer build variant for the post-quantum path. The root key must be recoverable from the 24 words, which depends on the internal deterministic key generation of the SDK; if it is not, we say it. Ledger's v1 ML-DSA has no side-channel or fault-injection countermeasures, and we state that wherever we describe the root key.
