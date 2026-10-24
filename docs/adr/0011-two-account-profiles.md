# 0011. Two account profiles; a Ledger account uses ML-DSA-44 session keys

**Status:** Accepted (2026-10-24). Supersedes in part [0004](0004-non-extractible-p256-session-keys.md) (now for Mac accounts only) and [0008](0008-post-quantum-root-classical-or-pq-sessions.md) (its choice of session key).

**Context.** The device holds an ML-DSA-44 key derived from its seed. A passkey on the Mac signs with P-256. A passkey has full authority: the node accepts any key of the account's passkey list, even once the master key is disabled (`rippled/src/libxrpl/tx/Transactor.cpp:1136-1160`). In this build a passkey list cannot be replaced or removed (P6). An account holding both keys would keep a classical key with full authority beside its post-quantum root. Session keys are generated in the browser, where WebCrypto offers P-256 but no ML-DSA.

**Decision.** Two account profiles share one session engine (D13):

- **Ledger account.** Its master key is disabled and its `RegularKey` is the device's ML-DSA-44 key; it never gets a passkey. Every transaction made with the account's own authority, session openings included, is signed on the device. Its session keys are ML-DSA-44 keys generated in the client, one per session.
- **Mac account.** It keeps its master key and has a passkey. The passkey opens its sessions, and its session key is a non-extractible P-256 WebCrypto key (0004).

The amendment accepts an ML-DSA-44 session key and has no code specific to it (D14):

- a 1 312-byte key is typed ML-DSA-44 by its size (`rippled/src/libxrpl/protocol/PublicKey.cpp:236-256`);
- its AccountID is `RIPEMD160(SHA256(public key))` over all its bytes (`rippled/src/libxrpl/protocol/AccountID.cpp:148-156`, `rippled/include/xrpl/protocol/digest.h:123-146`);
- its signature is verified as pure ML-DSA-44, with an empty context, over `STX\0` and the signed fields (`rippled/src/libxrpl/protocol/STTx.cpp:524-548`, `rippled/src/libxrpl/protocol/PublicKey.cpp:450-477`, `rippled/src/libxrpl/protocol/Sign.cpp:54-73`).

**Consequences.**

- Case 20 with an ML-DSA-44 key moves to N4 (MVP). What is still **UNVERIFIED**, and the test for each item, is listed in section 6.14 of the specification.
- A Ledger-account session key is extractable because it lives in page memory. Each Ledger-account transaction carries a 1 312-byte key and a 2 420-byte signature.
- A Mac account is not post-quantum, and every document says so.
- No protocol code changes: section 6.1 is unchanged.
