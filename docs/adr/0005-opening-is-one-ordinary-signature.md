# 0005. Opening a session is one ordinary signature, not a multisig

**Status:** Accepted (2026-10-24)

**Context.** The Ledger and the passkey both open sessions, and the session key then acts, which can look like multi-signing.

**Decision.** `SigningSessionSet` is a normal single-signed transaction from a key that already has full authority (master, `RegularKey`, passkey). No signer list and no quorum are involved. The session key signs later transactions, one after the other, never the same transaction as the opener. A transaction with `Signers` is never session-signed.

**Consequences.** The Ledger shows the rules once, at opening. The device does not sign the actions that follow. Creating a session for a key that already has full authority is refused.
