# 0002. The session predicate replaces `checkSign`

**Status:** Accepted (2026-10-24)

**Context.** In `invokePreclaim` the signature authorization (`T::checkSign`, which ends in `checkSingleSign`) accepts only the master key, the regular key, a passkey or the beneficiary key, and otherwise returns `tefBAD_AUTH`. A session key is none of those. Everything up to and including `checkSign` must return `NotTEC`: a `tec` there would charge a fee before authorization.

**Decision.** One predicate, `isSessionSigned(view, tx)`, true when the transaction is single-signed, carries no `Delegate`, `Sponsor`, `SponsorSignature`, `CounterpartySignature`, is not an inner Batch transaction, and a `SigningSession` exists for (`Account`, `AccountID(SigningPubKey)`). When it holds, a templated `invokeCheckSession<T>` **replaces** `T::checkSign`, between `invokeCheckPermission<T>` and `checkFirewall`. The same predicate drives accounting and the invariant.

**Consequences.** A session-signed transaction is authorized only by its session, so a key that later becomes a `RegularKey` stays bounded until its session is deleted. Replacing `checkSign` drops its pseudo-account and key-type checks, which the hook redoes. The hook is templated because granular permissions need `T::checkGranularSemantics`. A test enumerates every transaction type and fails when a delegable type has no explicit decision.
