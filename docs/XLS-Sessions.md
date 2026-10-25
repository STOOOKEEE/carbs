# XLS draft: Signing Sessions

|                    |                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Title**          | Signing Sessions: short-lived keys bounded by the ledger                                                                                                                                                                                         |
| **Amendment**      | `SigningSessions` (`Supported::Yes`, `VoteBehavior::DefaultNo`)                                                                                                                                                                                  |
| **Requires**       | `PermissionDelegationV1_1` (XLS-75)                                                                                                                                                                                                              |
| **Status**         | Draft, written from the implementation in this repository (`rippled/`, task N10 of `FIANSO-SPEC.md`)                                                                                                                                             |
| **Implementation** | `rippled/include/xrpl/tx/SigningSession.h`, `rippled/src/libxrpl/tx/SigningSession.cpp`, `rippled/src/libxrpl/tx/transactors/session/`, `rippled/src/libxrpl/tx/Transactor.cpp`, `rippled/src/libxrpl/tx/invariants/SigningSessionInvariant.cpp` |
| **Tests**          | `rippled/src/test/app/SigningSessions_test.cpp` (suite `SigningSessions`), `rippled/src/test/app/invariants/InvariantsSigningSession_test.cpp` (suite `InvariantsSigningSession`)                                                                |

Every reference to code below is a `path:line` of this repository. The numbered cases are those of the test plan, `FIANSO-SPEC.md` section 6.15.

## 1. Abstract

An account opens a **signing session**: it names a key, the **session key**, that may sign transactions for the account without further approval. The ledger itself bounds what that key can do:

- **in time**: at most 600 seconds, measured on the ledger's parent close time;
- **in scope**, through exactly one of three modes:
  - **A**, all delegable transaction types except three;
  - **P**, a list of XLS-75 permissions;
  - **C**, direct XRP payments up to a total cap, fees included;
- **in fees**: a ceiling on what each session-signed transaction may pay.

A session can never change who controls the account. A session-signed transaction is authorized by its session alone: the master key, the `RegularKey`, the passkey list and the beneficiary are not consulted for it.

## 2. Motivation

XLS-75 delegation gives rights to another _account_. That account must be funded, and the rights have neither an expiry nor an amount cap.

Signing sessions answer a different need: let a device or an application sign for a few minutes, with a key the account never has to fund, within limits the ledger enforces even if the key leaks. Two cases drive it:

- **Ledger account.** The account's own authority lives on a hardware wallet. The wallet opens a session once, and the session key signs the next payments without prompting.
- **Mac account.** A passkey opens a session for a WebCrypto key that cannot be extracted.

## 3. Identifiers

| Item              | Value                                                                                                                                  | Where                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Amendment         | `SigningSessions`, at the top of the list                                                                                              | `rippled/include/xrpl/protocol/detail/features.macro:18`                                           |
| `SessionKey`      | ACCOUNT 34                                                                                                                             | `rippled/include/xrpl/protocol/detail/sfields.macro:582`                                           |
| `SessionCap`      | AMOUNT 47                                                                                                                              | `rippled/include/xrpl/protocol/detail/sfields.macro:583`                                           |
| `SessionSpent`    | AMOUNT 48                                                                                                                              | `rippled/include/xrpl/protocol/detail/sfields.macro:584`                                           |
| `SessionDuration` | UINT32 114                                                                                                                             | `rippled/include/xrpl/protocol/detail/sfields.macro:585`                                           |
| Reused fields     | `Expiration` (UINT32 10), `Permissions` (ARRAY 29) of `Permission` (OBJECT 15) with `PermissionValue` (UINT32 52), `Owner` (ACCOUNT 2) |                                                                                                    |
| Ledger entry      | `ltSIGNING_SESSION` = `0x009A`, RPC name `signing_session`                                                                             | `rippled/include/xrpl/protocol/detail/ledger_entries.macro:962`                                    |
| Keylet            | `SHA512Half(0x007A ‖ Account ‖ SessionKey)`, namespace `'z'`                                                                           | `rippled/src/libxrpl/protocol/Indexes.cpp:122`, `:562`                                             |
| Transactions      | `SigningSessionSet` = 130, `SigningSessionDelete` = 131                                                                                | `rippled/include/xrpl/protocol/detail/transactions.macro:1629`, `:1642`                            |
| Flags             | `tfAllTransactions` = `0x00010000` on `SigningSessionSet`; `lsfAllTransactions` = `0x00010000` on the entry                            | `rippled/include/xrpl/protocol/TxFlags.h:264`, `rippled/include/xrpl/protocol/LedgerFormats.h:229` |
| Result codes      | `tefSESSION_EXPIRED` (-172), `tefSESSION_LIMIT` (-171), `tefSESSION_TX_NOT_ALLOWED` (-170), at the end of `TEFcodes`                   | `rippled/include/xrpl/protocol/TER.h:188-190`, `rippled/src/libxrpl/protocol/TER.cpp:151-153`      |
| Constants         | `kMaxSessionDuration` = 600, `kSessionFeeMultiple` = 1000, `kSessionMaxLedgerWindow` = 256                                             | `rippled/include/xrpl/protocol/Protocol.h:504`, `:510`, `:516`                                     |
| Excluded types    | `PasskeyListSet`, `SponsorshipSet`, `SubscriptionSet`                                                                                  | `rippled/include/xrpl/tx/SigningSession.h:21`                                                      |

## 4. The `SigningSession` ledger entry

| Field                                             | Required | Meaning                                                                               |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `Account`                                         | yes      | The owner                                                                             |
| `SessionKey`                                      | yes      | AccountID of the session key: `RIPEMD160(SHA256(public key))`, whatever the key type  |
| `Expiration`                                      | yes      | `parentCloseTime + SessionDuration` at creation, in seconds since the Ripple epoch    |
| `Permissions`                                     | mode P   | 1 to 10 XLS-75 permission values                                                      |
| `SessionCap`                                      | mode C   | A positive XRP amount: the total the session may take from the account, fees included |
| `SessionSpent`                                    | mode C   | 0 at creation; only increases                                                         |
| `Flags`                                           | yes      | `lsfAllTransactions` in mode A                                                        |
| `OwnerNode`, `PreviousTxnID`, `PreviousTxnLgrSeq` | yes      | Standard                                                                              |

Each session takes one owner reserve. It is never reserve-sponsored: `SigningSessionSet` is not on the reserve-sponsorship list. A fee sponsor may pay the opening's fee (case 24).

An expired session stays in the ledger, unusable, until something deletes it. `AccountDelete` deletes an account's sessions, since they are not obligations (`rippled/src/libxrpl/tx/transactors/account/AccountDelete.cpp:242`, case 19).

## 5. Transactions

### 5.1 `SigningSessionSet` (not delegable, never signed by a session)

| Field               | Required | Notes            |
| ------------------- | -------- | ---------------- |
| `SessionKey`        | yes      | The new key      |
| `SessionDuration`   | yes      | 1 to 600 seconds |
| `Permissions`       | mode P   | 1 to 10 values   |
| `SessionCap`        | mode C   | Positive XRP     |
| `tfAllTransactions` | mode A   |                  |

**Preflight** (`rippled/src/libxrpl/tx/transactors/session/SigningSessionSet.cpp:49`). These checks are stateless, and every refusal is a `tem`:

| Condition                                                                                     | Result               |
| --------------------------------------------------------------------------------------------- | -------------------- |
| Unknown flag bits                                                                             | `temINVALID_FLAG`    |
| Not exactly one mode                                                                          | `temMALFORMED`       |
| `SessionKey` equals `Account`                                                                 | `temMALFORMED`       |
| Duration 0 or above 600                                                                       | `temBAD_EXPIRATION`  |
| `Permissions` empty                                                                           | `temARRAY_EMPTY`     |
| `Permissions` above 10 values                                                                 | `temARRAY_TOO_LARGE` |
| A permission that is duplicated, not delegable, or whose type a mode-A session could not sign | `temMALFORMED`       |
| `SessionCap` that is not positive XRP                                                         | `temBAD_AMOUNT`      |

The permission check applies to transaction-level and granular permissions alike. A granular permission of a non-delegable type, such as the `AccountSet` permissions `AccountDomainSet` or `AccountTransferRateSet`, is therefore refused.

`SigningSessionSet` also requires `PermissionDelegationV1_1` (`checkExtraFeatures`). Without it, or without `SigningSessions`, the result is `temDISABLED` (case 7).

**Preclaim** (`rippled/src/libxrpl/tx/transactors/session/SigningSessionSet.cpp:117`) refuses a key that already has full authority over the account, with `tecNO_PERMISSION`:

- the `RegularKey`;
- the AccountID of a key in the passkey list;
- the beneficiary.

A session for an existing (`Account`, `SessionKey`) pair is `tecDUPLICATE`; a session cannot be updated, only deleted and opened again. An account without the reserve gets `tecINSUFFICIENT_RESERVE`, judged on its balance before the fee.

### 5.2 `SigningSessionDelete` (not delegable)

| Field        | Required | Notes                                         |
| ------------ | -------- | --------------------------------------------- |
| `SessionKey` | yes      | The session to delete                         |
| `Owner`      | no       | The owner, when the submitter is someone else |

**Without `Owner`**, the account's own session is deleted. Any key with full authority may sign this, and so may **the session key itself**: the _own close_ (§6). **With `Owner`**, any account may delete the session once it has expired, so that the reserve can be reclaimed. Before expiry the result is `tecNO_PERMISSION`.

Other results:

- `Owner` equal to `Account`: `temMALFORMED`;
- a missing session: `tecNO_ENTRY`;
- without `SigningSessions` or `PermissionDelegationV1_1`: `temDISABLED` (case 7).

The rules are at `rippled/src/libxrpl/tx/transactors/session/SigningSessionDelete.cpp:28`, `:41`, and the tests are case 18.

## 6. The session-signed predicate

One function decides whether a transaction is session-signed: `signingSessionOf` / `isSessionSigned` (`rippled/src/libxrpl/tx/SigningSession.cpp:78`, `:88`). Authorization and accounting ask it, and the invariant asks its shape test (§9), so they cannot disagree. A transaction is session-signed when all of the following hold:

1. `SigningSessions` is enabled (before that, no ledger read happens);
2. the transaction carries no `Delegate`, `Sponsor`, `SponsorSignature` or `CounterpartySignature`, and it is not a Batch inner transaction;
3. it is single-signed with a key of a known type (secp256k1, Ed25519, P-256 or ML-DSA-44) and has no `Signers`;
4. a session exists for (`Account`, `AccountID(SigningPubKey)`).

Every other shape follows the existing rules, and a session key meets the ordinary signature check there (case 14): used with a `Delegate`, with a fee sponsor, as a counterparty signer or as a Batch inner signer it gets `tefBAD_AUTH`; as a multi-signer, which is not in the account's signer list, it gets `tefBAD_SIGNATURE`. A session key signing for another account gets `tefBAD_AUTH` (case 15).

The **own close** is a session-signed `SigningSessionDelete` without `Owner` whose `SessionKey` is the signer (`rippled/src/libxrpl/tx/SigningSession.cpp:94`).

## 7. Authorization

In `invokePreclaim`, when the predicate holds, `Transactor::invokeCheckSession<T>` replaces `T::checkSign` (`rippled/src/libxrpl/tx/applySteps.cpp:195-199`). It sits between `invokeCheckPermission<T>` and `checkFirewall`, so the firewall still applies to the account whatever key signed (case 16). The hook returns `NotTEC`, so a refusal is never included in a ledger and never claims a fee.

Its rules apply in this order (`rippled/src/libxrpl/tx/Transactor.cpp:1055`, comments at `:1073-1131`):

0. **Not a pseudo-account**, else `tefBAD_AUTH` (`rippled/src/libxrpl/tx/Transactor.cpp:1066-1069`, case 24): the refusal of `Transactor::checkSign` that this path replaces.
1. **Eligibility**, else `tefSESSION_TX_NOT_ALLOWED`:
   - the own close is always eligible;
   - otherwise, a type that checks its own signature (`Batch`, `LoanSet`) is never eligible, whatever the mode;
   - mode A: a delegable type that is not excluded;
   - mode P: the same type condition, then the XLS-75 sequence of `checkPermission` with the session entry in place of the delegate entry, then `T::checkGranularSemantics`; every refusal there is mapped to the `tef`, because a retriable `ter` would keep the transaction in the node's retry loop;
   - mode C: a direct XRP `Payment` from a closed whitelist (`rippled/src/libxrpl/tx/SigningSession.cpp:104`). Its only flag may be `tfFullyCanonicalSig`, and its only fields besides the common ones are `Destination`, `DestinationTag` and `Amount`. `SendMax`, `Paths`, `DeliverMin`, partial payments, `tfSponsorCreatedAccount`, `InvoiceID` and every other type are refused (case 12);
2. **`LastLedgerSequence`** is present and at most 256 ledgers ahead, else `tefSESSION_TX_NOT_ALLOWED` (case 17b). A transaction that was refused, held and retried must not land under a later session opened with the same key.
3. **Expiry**: the session signs strictly before `Expiration`, else `tefSESSION_EXPIRED`. The own close is exempt (case 10).
4. **Fee ceiling**: `Fee ≤ base fee of the type + 1000 × base fee unit`, else `tefSESSION_LIMIT`. This applies in every mode, the own close included. Types whose required fee is the owner-reserve increment (`AMMCreate`, `LedgerStateFix`) stay usable (case 13).
5. **Cap**, mode C only, the own close excepted: `Fee + Amount ≤ SessionCap − SessionSpent`, else `tefSESSION_LIMIT` (case 11).

Replacing `T::checkSign` drops two checks, and the hook redoes them: the refusal of pseudo-accounts (rule 0), and the unknown key type, which is part of the predicate.

The 68 transaction types a session may sign in mode A, and the 7 granular permissions it may hold in mode P, are pinned by test 9b. A new delegable type fails that test until someone decides on it.

## 8. Accounting (mode C)

`chargeSession` adds to `SessionSpent` the fee claimed, plus the `Amount` on `tesSUCCESS` (`rippled/src/libxrpl/tx/Transactor.cpp:1144`). It runs in `Transactor::operator()`, at exactly two places:

1. **Before the first invariant pass, after the `canApply` block** (`rippled/src/libxrpl/tx/Transactor.cpp:1885`). Every fee-claiming `tec` goes through that block's reset.
2. **Right after the fee-claim reset** that follows a failed invariant pass (`rippled/src/libxrpl/tx/Transactor.cpp:1904`). That reset erases the first count.

The session's keylet is read at the top of `operator()` (`rippled/src/libxrpl/tx/Transactor.cpp:1835`), before `apply()`, because an own close erases the entry. The own close is exempt by shape, and a session that no longer exists is skipped.

The count cannot live in `apply()`, for two reasons:

- a `tec` from `preclaim` never reaches `apply()`;
- a `tec` result discards the changes of `doApply`.

Case 23 exercises each path on a real transaction:

- `tecNO_DST_INSUF_XRP` from preclaim counts the fee;
- `tecUNFUNDED_PAYMENT` from doApply counts the fee;
- the `tecINVARIANT_FAILED` reset path counts the fee again.

A leaked mode-C key can burn fees only until the cap stops it: the anti-drain loop test ends in `tefSESSION_LIMIT` after ten fee-burning payments.

The transaction queue may admit several session transactions against the same `SessionSpent`. Each one is checked again when it is applied (`rippled/src/xrpld/app/misc/detail/TxQ.cpp:342`, `:632`), so the extra ones end in `tefSESSION_LIMIT`. A queued transaction whose session has expired, or has been deleted, is dropped without claiming a fee (case 22). `SigningSessionDelete` is a queue blocker, like `SetRegularKey`: it is queued only alone in its account's queue, and nothing of the account queues behind it; a close that pays the open ledger's fee still applies at once. `SigningSessionSet` is not a blocker, since an opening removes no authority.

## 9. The `ValidSigningSession` invariant

`ValidSigningSession` is a member of the `InvariantChecks` tuple (`rippled/include/xrpl/tx/invariants/InvariantCheck.h:566`), so it runs in both passes, including the one after a reset. It is implemented at `rippled/src/libxrpl/tx/invariants/SigningSessionInvariant.cpp:70`, `:98`.

1. Only `SigningSessionSet` creates a session, and only `SigningSessionDelete` or `AccountDelete` removes one. The owner count moves by one with each, or one less on the account when a ticket is consumed; for `AccountDelete`, which deletes the account root as well, the count is not checked.
2. `Account`, `SessionKey`, `Expiration`, `Permissions`, `SessionCap` and the mode flag never change. At creation, a session has exactly one mode, and `SessionSpent` exists only with `SessionCap`, at 0; later, the fixed fields above keep the mode, and `SessionSpent` moves only under rule 3. `Expiration` lies within 600 seconds of the parent close time when the session is created.
3. `SessionSpent` only increases, never above `SessionCap`, and only in a transaction its session signed and that is not its own close: the own close is never counted and never moves it.
4. A mode-C session transaction other than the own close that does not delete its session takes no more XRP from the account than `SessionSpent` counts. It raises no owner count and changes no sponsoring count. This ties the counter to the real outflow rather than to declared fields.
5. A session-signed transaction never changes the account's `RegularKey`, master-disable flag, signer list, passkey list, delegate entries, beneficiary or firewall, nor another session of the account.

The invariant recognizes a session-signed transaction even after its own close has erased the session. It uses the predicate without the existence test (`sessionKeyletOf`, `rippled/src/libxrpl/tx/SigningSession.cpp:57`): the session counts as pre-existing if it was visited with a `before` state, or was not visited and still exists. Each rule has a test on a mutated view (case 21).

**Cost.** Once the amendment is enabled, every single-signed transaction reads one session keylet that usually does not exist: once in preclaim, once at the top of `operator()` and once in the invariant. The signing key is hashed to an AccountID each time, which costs more for a 1 312-byte ML-DSA-44 key. This is the price of an invariant that also catches a mode-C transaction that skipped its count.

## 10. RPC

`ledger_entry` accepts a `signing_session` field, either as an index (a hex string) or as `{ "account": …, "session_key": … }` (`rippled/src/xrpld/rpc/handlers/ledger/LedgerEntry.cpp:956`). `account_objects` accepts the type `signing_session`. `server_definitions` exposes the types, fields and codes of §3. The changes are listed in `rippled/API-CHANGELOG.md`.

## 11. Security considerations

- **Least privilege.** A key that later becomes the `RegularKey` stays bounded by its session until the session is deleted (case 17). Creating a session for a key that already has full authority is refused. Wallets should not make a session key a `RegularKey`.
- **Documented limitation (case 17b).** With a fee sponsor, or as a Batch inner signer, a key that is both the `RegularKey` and a session key follows the existing rules and acts with the `RegularKey`'s authority.
- **What modes A and P bound.** They bound _when_ the key can sign, not what the signed transactions leave behind: an escrow, check, channel or offer outlives the session. Only mode C bounds the XRP that leaves the account.
- **Fees in modes A and P (limitation, deviation from the wording of case 13).** The fee ceiling bounds the fee of _each_ session-signed transaction (`base fee of the type + 1000 × base fee unit`), not their number. A mode A or mode P session, even one limited to `TicketCreate`, can therefore pay fees up to the ceiling on every transaction it signs within its 600 seconds (the test `fee ceiling` shows a ticket creation at the ceiling being accepted), and a loop of refusals charges nothing. Only mode C counts fees against a total (`SessionCap`). The specification's case 13 reads "a mode-P session limited to `TicketCreate` cannot burn the balance"; it holds per transaction, not in total, and the DEVLOG records it as a deviation.
- **Excluded types.** `PasskeyListSet`, `SponsorshipSet` and `SubscriptionSet` are delegable but grant open-ended rights to a new key or a third party, so no session signs them. Every non-delegable type (`AccountSet`, `SetRegularKey`, `SignerListSet`, `AccountDelete`, `DelegateSet`, `Batch`, `FirewallSet`, `BeneficiarySet`, the two session types…) is out of reach, including their granular permissions.
- **Key types.** The amendment depends on no key type. P-256, Ed25519, secp256k1 and ML-DSA-44 session keys are tested (case 20). A P-256 session key may also sign through WebAuthn, and stays bounded by its session; that test used a software authenticator.

## 12. Test coverage

| Suite                      | Contents                                         |
| -------------------------- | ------------------------------------------------ |
| `SigningSessions`          | Cases 1 to 20 and 22 to 24                       |
| `InvariantsSigningSession` | Case 21                                          |
| `LedgerEntry`              | `testSigningSession`                             |
| `MPToken`                  | `testMPTInvalidInTx` refuses an MPT `SessionCap` |

The generated `protocol_autogen` tests of the three new types run in `xrpl_tests`. Results and mutation checks are recorded in `docs/DEVLOG.md`.

## 13. Not specified here

- The ticket coordination for multi-signing proposed in `docs/adr/0010-tickets-for-multisig-coordination.md`, still Proposed.
- The per-payment cap and the witness co-signature of a device-track draft. Both await the owner's decision, and their codes are free.
