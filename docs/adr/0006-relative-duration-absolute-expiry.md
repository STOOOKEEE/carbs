# 0006. Relative duration in the transaction, absolute expiry in the entry

**Status:** Accepted (2026-10-24)

**Context.** A hardware wallet has no clock, so an absolute timestamp in the signed blob cannot be checked by the user. XRPL entries conventionally carry an absolute `Expiration`. Discussion #657 asks for one clock, not two.

**Decision.** `SigningSessionSet` carries `SessionDuration` in seconds, `1..600` (a decision of 2026-10-24: ten minutes). The entry stores `Expiration = parentCloseTime + SessionDuration`. Expiry is time only, never ledger sequence. A session cannot be updated: delete it and open another.

**Consequences.** The device can show "Valid for 10 minutes". In standalone, time advances only when a ledger closes, so a single process closes ledgers every 1 to 3 seconds. Anyone can delete an expired session and return the reserve.
