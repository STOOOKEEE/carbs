# XLS draft: Signing Sessions

|                    |                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Title**          | Signing Sessions: short-lived keys bounded by the ledger                                                                                                                                                                                                                                      |
| **Amendment**      | `SigningSessions` (`Supported::Yes`, `VoteBehavior::DefaultNo`)                                                                                                                                                                                                                               |
| **Requires**       | `PermissionDelegationV1_1` (XLS-75)                                                                                                                                                                                                                                                           |
| **Status**         | Draft, written from the implementation in this repository (`rippled/`, task N10 of `FIANSO-SPEC.md`)                                                                                                                                                                                          |
| **Implementation** | `rippled/include/xrpl/tx/SigningSession.h`, `rippled/src/libxrpl/tx/SigningSession.cpp`, `rippled/src/libxrpl/tx/transactors/session/`, `rippled/src/libxrpl/tx/Transactor.cpp`, `rippled/src/libxrpl/tx/invariants/SigningSessionInvariant.cpp`, `rippled/src/xrpld/app/misc/detail/TxQ.cpp` |
| **Tests**          | `rippled/src/test/app/SigningSessions_test.cpp` (suite `SigningSessions`), `rippled/src/test/app/SigningSessionsBatch_test.cpp` (suite `SigningSessionsBatch`), `rippled/src/test/app/invariants/InvariantsSigningSession_test.cpp` (suite `InvariantsSigningSession`)                        |

Every reference to code below is a `path:line` of this repository. The numbered cases are those of the test plan, `FIANSO-SPEC.md` section 6.15.

## 1. Abstract

An account opens a **signing session**: it names a key, the **session key**, that may sign transactions for the account without further approval. The ledger itself bounds what that key can do:

- **in time**: at most 600 seconds, measured on the ledger's parent close time;
- **in scope**, through exactly one of three modes:
  - **A**, all delegable transaction types except five;
  - **P**, a list of XLS-75 permissions;
  - **C**, direct XRP payments up to a total cap, fees included, optionally with a bound per payment (`SessionMaxPerTx`);
- **in number**, optionally, in any mode: at most `SessionMaxTxCount` transactions;
- **in fees**: a ceiling on what each session-signed transaction may pay;
- **by a second signer**, optionally, in any mode: a **witness** account that co-signs every session-signed transaction.

A session can never change who controls the account. A session-signed transaction is authorized by its session alone: the master key, the `RegularKey`, the passkey list and the beneficiary are not consulted for it.

## 2. Motivation

XLS-75 delegation gives rights to another _account_. That account must be funded, and the rights have neither an expiry nor an amount cap.

Signing sessions answer a different need: let a device or an application sign for a few minutes, with a key the account never has to fund, within limits the ledger enforces even if the key leaks. Two cases drive it:

- **Ledger account.** The account's own authority lives on a hardware wallet. The wallet opens a session once, and the session key signs the next payments without prompting.
- **Mac account.** A passkey opens a session for a WebCrypto key that cannot be extracted.

The witness covers a third case: an agent signs with the session key, and a policy service (the witness) co-signs each transaction it approves, so a leaked session key alone can sign nothing.

## 3. Identifiers

| Item                | Value                                                                                                                                                     | Where                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amendment           | `SigningSessions`, near the top of the list                                                                                                               | `rippled/include/xrpl/protocol/detail/features.macro:19`                                                                                                             |
| `SessionKey`        | ACCOUNT 34                                                                                                                                                | `rippled/include/xrpl/protocol/detail/sfields.macro:582`                                                                                                             |
| `SessionCap`        | AMOUNT 47                                                                                                                                                 | `rippled/include/xrpl/protocol/detail/sfields.macro:583`                                                                                                             |
| `SessionSpent`      | AMOUNT 48                                                                                                                                                 | `rippled/include/xrpl/protocol/detail/sfields.macro:584`                                                                                                             |
| `SessionDuration`   | UINT32 114                                                                                                                                                | `rippled/include/xrpl/protocol/detail/sfields.macro:585`                                                                                                             |
| `SessionMaxPerTx`   | AMOUNT 49                                                                                                                                                 | `rippled/include/xrpl/protocol/detail/sfields.macro:586`                                                                                                             |
| `SessionWitness`    | ACCOUNT 35                                                                                                                                                | `rippled/include/xrpl/protocol/detail/sfields.macro:587`                                                                                                             |
| `SessionMaxTxCount` | UINT32 115                                                                                                                                                | `rippled/include/xrpl/protocol/detail/sfields.macro:588`                                                                                                             |
| `SessionTxCount`    | UINT32 116                                                                                                                                                | `rippled/include/xrpl/protocol/detail/sfields.macro:589`                                                                                                             |
| `WitnessSignature`  | OBJECT 43, not a signing field, a common field of every transaction: `{SigningPubKey, TxnSignature}`                                                      | `rippled/include/xrpl/protocol/detail/sfields.macro:590`, `rippled/src/libxrpl/protocol/InnerObjectFormats.cpp:191`, `rippled/src/libxrpl/protocol/TxFormats.cpp:37` |
| Hash prefix         | `WitnessTxSign` = `WTS\0`                                                                                                                                 | `rippled/include/xrpl/protocol/HashPrefix.h:119`                                                                                                                     |
| Reused fields       | `Expiration` (UINT32 10), `Permissions` (ARRAY 29) of `Permission` (OBJECT 15) with `PermissionValue` (UINT32 52), `Owner` (ACCOUNT 2)                    |                                                                                                                                                                      |
| Ledger entry        | `ltSIGNING_SESSION` = `0x009A`, RPC name `signing_session`                                                                                                | `rippled/include/xrpl/protocol/detail/ledger_entries.macro:966`                                                                                                      |
| Keylet              | `SHA512Half(0x007A ‖ Account ‖ SessionKey)`, namespace `'z'`                                                                                              | `rippled/src/libxrpl/protocol/Indexes.cpp:122`, `:562`                                                                                                               |
| Transactions        | `SigningSessionSet` = 130, `SigningSessionDelete` = 131                                                                                                   | `rippled/include/xrpl/protocol/detail/transactions.macro:1629`, `:1645`                                                                                              |
| Flags               | `tfAllTransactions` = `0x00010000` on `SigningSessionSet`; `lsfAllTransactions` = `0x00010000` on the entry; no flag of its own on `SigningSessionDelete` | `rippled/include/xrpl/protocol/TxFlags.h:264`, `rippled/include/xrpl/protocol/LedgerFormats.h:229`                                                                   |
| Result codes        | `tefSESSION_EXPIRED` (-172), `tefSESSION_LIMIT` (-171), `tefSESSION_TX_NOT_ALLOWED` (-170), `tefSESSION_NO_WITNESS` (-169), at the end of `TEFcodes`      | `rippled/include/xrpl/protocol/TER.h:188-191`, `rippled/src/libxrpl/protocol/TER.cpp:151-154`                                                                        |
| Constants           | `kMaxSessionDuration` = 600, `kMaxSessionTxCount` = 100 000, `kSessionFeeMultiple` = 1000, `kSessionMaxLedgerWindow` = 256                                | `rippled/include/xrpl/protocol/Protocol.h:504`, `:509`, `:515`, `:523`                                                                                               |
| Excluded types      | `PasskeyListSet`, `SponsorshipSet`, `SubscriptionSet`, `CredentialCreate`, `DIDSet`                                                                       | `rippled/include/xrpl/tx/SigningSession.h:25`                                                                                                                        |

## 4. The `SigningSession` ledger entry

| Field                                             | Required                 | Meaning                                                                                                             |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `Account`                                         | yes                      | The owner                                                                                                           |
| `SessionKey`                                      | yes                      | AccountID of the session key: `RIPEMD160(SHA256(public key))`, whatever the key type                                |
| `Expiration`                                      | yes                      | `parentCloseTime + SessionDuration` at creation, in seconds since the Ripple epoch                                  |
| `Permissions`                                     | mode P                   | 1 to 10 XLS-75 permission values                                                                                    |
| `SessionCap`                                      | mode C                   | A positive XRP amount: the total the session may take from the account, fees included                               |
| `SessionSpent`                                    | mode C                   | 0 at creation; only increases                                                                                       |
| `SessionMaxPerTx`                                 | no (mode C only)         | A positive XRP amount, at most `SessionCap`: the most one payment may send, its fee not included                    |
| `SessionWitness`                                  | no                       | An account, neither the owner nor the session key, that co-signs every session-signed transaction but the own close |
| `SessionMaxTxCount`                               | no (any mode)            | 1 to 100 000: the most transactions the session may sign                                                            |
| `SessionTxCount`                                  | with `SessionMaxTxCount` | 0 at creation; one more for each session-signed transaction applied (`tes` or `tec`), the own close excepted        |
| `Flags`                                           | yes                      | `lsfAllTransactions` in mode A                                                                                      |
| `OwnerNode`, `PreviousTxnID`, `PreviousTxnLgrSeq` | yes                      | Standard                                                                                                            |

Every field but `SessionSpent` and `SessionTxCount` is fixed at creation. Each session takes one owner reserve. It is never reserve-sponsored: `SigningSessionSet` is not on the reserve-sponsorship list, so a reserve sponsor is refused with `temINVALID_FLAG`. A fee sponsor may pay the opening's fee (case 24).

An expired session stays in the ledger, unusable, until something deletes it. `AccountDelete` deletes an account's sessions, since they are not obligations (`rippled/src/libxrpl/tx/transactors/account/AccountDelete.cpp:242`, case 19).

## 5. Transactions

### 5.1 `SigningSessionSet` (not delegable, never signed by a session)

| Field               | Required | Notes                                           |
| ------------------- | -------- | ----------------------------------------------- |
| `SessionKey`        | yes      | The new key                                     |
| `SessionDuration`   | yes      | 1 to 600 seconds                                |
| `Permissions`       | mode P   | 1 to 10 values                                  |
| `SessionCap`        | mode C   | Positive XRP                                    |
| `tfAllTransactions` | mode A   |                                                 |
| `SessionMaxPerTx`   | no       | Mode C only; positive XRP, at most `SessionCap` |
| `SessionWitness`    | no       | The witness account                             |
| `SessionMaxTxCount` | no       | Any mode; 1 to 100 000                          |

**Preflight** (`rippled/src/libxrpl/tx/transactors/session/SigningSessionSet.cpp:49`). These checks are stateless, and every refusal is a `tem`:

| Condition                                                                                     | Result               |
| --------------------------------------------------------------------------------------------- | -------------------- |
| Flag bits other than `tfAllTransactions` and the universal flags                              | `temINVALID_FLAG`    |
| Not exactly one mode                                                                          | `temMALFORMED`       |
| `SessionKey` equals `Account`                                                                 | `temMALFORMED`       |
| Duration 0 or above 600                                                                       | `temBAD_EXPIRATION`  |
| `Permissions` empty                                                                           | `temARRAY_EMPTY`     |
| `Permissions` above 10 values                                                                 | `temARRAY_TOO_LARGE` |
| A permission that is duplicated, not delegable, or whose type a mode-A session could not sign | `temMALFORMED`       |
| `SessionCap` that is not positive XRP                                                         | `temBAD_AMOUNT`      |
| `SessionMaxPerTx` without `SessionCap`                                                        | `temMALFORMED`       |
| `SessionMaxPerTx` that is not positive XRP, or above `SessionCap`                             | `temBAD_AMOUNT`      |
| `SessionMaxTxCount` 0 or above 100 000                                                        | `temMALFORMED`       |
| `SessionWitness` equal to `Account` or to `SessionKey`                                        | `temMALFORMED`       |

The permission check applies to transaction-level and granular permissions alike. A granular permission of a non-delegable type, such as the `AccountSet` permissions `AccountDomainSet` or `AccountTransferRateSet`, is therefore refused.

`SigningSessionSet` also requires `PermissionDelegationV1_1` (`checkExtraFeatures`). Without it, or without `SigningSessions`, the result is `temDISABLED` (case 7).

**Preclaim** (`rippled/src/libxrpl/tx/transactors/session/SigningSessionSet.cpp:150`) refuses a key that already has full authority over the account, with `tecNO_PERMISSION`:

- the `RegularKey`;
- the AccountID of a key in the passkey list;
- the beneficiary.

A session for an existing (`Account`, `SessionKey`) pair is `tecDUPLICATE`; a session cannot be updated, only deleted and opened again. A `SessionWitness` that names no account is `tecNO_TARGET`. An account without the reserve gets `tecINSUFFICIENT_RESERVE`, judged on its balance before the fee (`doApply`, `:205`).

### 5.2 `SigningSessionDelete` (not delegable)

| Field        | Required | Notes                                         |
| ------------ | -------- | --------------------------------------------- |
| `SessionKey` | yes      | The session to delete                         |
| `Owner`      | no       | The owner, when the submitter is someone else |

**Without `Owner`**, the account's own session is deleted. Any key with full authority may sign this, and so may **the session key itself**: the _own close_ (§6). **With `Owner`**, any account may delete the session once it has expired, so that the reserve can be reclaimed. Before expiry the result is `tecNO_PERMISSION`.

Other results:

- any flag bit but the universal flags (`tfFullyCanonicalSig`, and `tfInnerBatchTxn` on a Batch inner transaction): `temINVALID_FLAG` (`getFlagsMask` returns `tfUniversalMask`);
- `Owner` equal to `Account`: `temMALFORMED`;
- a missing session: `tecNO_ENTRY`;
- without `SigningSessions` or `PermissionDelegationV1_1`: `temDISABLED` (case 7).

The rules are at `rippled/src/libxrpl/tx/transactors/session/SigningSessionDelete.cpp:31`, `:39`, `:52`, and the tests are case 18 and the `flags` test, which tries every non-universal bit.

## 6. The session-signed predicate

One function decides whether a transaction is session-signed: `signingSessionOf` / `isSessionSigned` (`rippled/src/libxrpl/tx/SigningSession.cpp:82`, `:92`). Authorization, accounting and the transaction queue ask it, and the invariant asks its shape test (`sessionKeyletOf`, `:61`, §9), so they cannot disagree. A transaction is session-signed when all of the following hold:

1. `SigningSessions` is enabled (before that, no ledger read happens);
2. the transaction carries no `Delegate`, `Sponsor`, `SponsorSignature` or `CounterpartySignature`, and it is not a Batch inner transaction (`tfInnerBatchTxn`);
3. it is single-signed with a key of a known type (secp256k1, Ed25519, P-256 or ML-DSA-44) and has no `Signers`;
4. a session exists for (`Account`, `AccountID(SigningPubKey)`).

Every other shape follows the existing rules, and a session key meets the ordinary signature check there (case 14): used with a `Delegate`, with a fee sponsor, as a counterparty signer or as a Batch inner signer it gets `tefBAD_AUTH`; as a multi-signer, which is not in the account's signer list, it gets `tefBAD_SIGNATURE`. A session key signing for another account gets `tefBAD_AUTH` (case 15).

The **own close** is a session-signed `SigningSessionDelete` without `Owner` whose `SessionKey` is the signer (`rippled/src/libxrpl/tx/SigningSession.cpp:98`).

**Batch.** A session key can neither sign nor co-sign a `Batch` (suite `SigningSessionsBatch`):

- as the outer signer: `Batch` overrides `checkSign`, so the hook of §7 refuses it before any mode rule, in every mode, with `tefSESSION_TX_NOT_ALLOWED`;
- as a `BatchSigner`: `Batch::checkBatchSign` runs the ordinary signature check of the account, which never consults sessions: `tefBAD_AUTH`, although the same key may sign the same payment on its own;
- a session-signed transaction carrying `tfInnerBatchTxn` is not session-signed (rule 2 of the predicate); without a parent Batch, `submit` refuses it in its local checks and preflight with `temINVALID_INNER_BATCH`.

The owner may open, use and revoke sessions inside a Batch it signs: the suite opens a mode-C session and pays in one all-or-nothing Batch, and revokes three sessions, one per mode, in another.

## 7. Authorization

In `invokePreclaim`, when the predicate holds, `Transactor::invokeCheckSession<T>` replaces `T::checkSign` (`rippled/src/libxrpl/tx/applySteps.cpp:193-199`, `rippled/include/xrpl/tx/Transactor.h:384`). It sits between `invokeCheckPermission<T>` and `checkFirewall`, so the firewall still applies to the account whatever key signed (case 16). The hook returns `NotTEC`, so a refusal is never included in a ledger and never claims a fee.

Its rules apply in this order (`Transactor::checkSession`, `rippled/src/libxrpl/tx/Transactor.cpp:1060`):

0. **Not a pseudo-account**, else `tefBAD_AUTH` (`:1072-1073`, case 24): the refusal of `Transactor::checkSign` that this path replaces. Then **a key type whose amendment is enabled**, else `tefSESSION_TX_NOT_ALLOWED`, the own close included (`:1078-1081`): a P-256 session key needs `Passkey`, an ML-DSA-44 one needs `Quantum`.
1. **Eligibility**, else `tefSESSION_TX_NOT_ALLOWED` (`:1085-1132`):
   - the own close is always eligible;
   - otherwise, a type that checks its own signature (`Batch`, `LoanSet`) is never eligible, whatever the mode, and a transaction that uses `TicketSequence` is never eligible: the tickets of the account stay for the owner, who may close the session by ticket while the key holds the sequence, and for multi-signed transactions;
   - mode A: a delegable type that is not excluded;
   - mode P: the same type condition, then the XLS-75 sequence of `checkPermission` with the session entry in place of the delegate entry, then `T::checkGranularSemantics`; every refusal there is mapped to the `tef`, because a retriable `ter` would keep the transaction in the node's retry loop;
   - mode C: a direct XRP `Payment` from a closed whitelist (`rippled/src/libxrpl/tx/SigningSession.cpp:108`). Its only flag may be `tfFullyCanonicalSig`, and its only fields besides the common ones are `Destination`, `DestinationTag` and `Amount`. `SendMax`, `Paths`, `DeliverMin`, partial payments, `tfSponsorCreatedAccount`, `InvoiceID` and every other type are refused (case 12);
2. **`LastLedgerSequence`** is present and at most 256 ledgers ahead, else `tefSESSION_TX_NOT_ALLOWED` (`:1142-1144`, case 17b). A transaction that was refused, held and retried must not land under a later session opened with the same key.
3. **Expiry**: the session signs strictly before `Expiration`, else `tefSESSION_EXPIRED` (`:1147-1148`). The own close is exempt (case 10).
4. **Fee ceiling**: `Fee ≤ base fee of the type + 1000 × base fee unit`, else `tefSESSION_LIMIT` (`:1157-1168`). This applies in every mode. The base fee comes from `xrpl::calculateBaseFee`, as in the fee check of `invokePreclaim`; its error is passed on when it is a `tem` or a `tef`, else `tefINTERNAL`. The own close gets no margin: `Fee ≤ base fee of the type`, so past the cap or the expiry it costs one base fee at most. Types whose required fee is the owner-reserve increment (`AMMCreate`, `LedgerStateFix`) stay usable (case 13).
5. **Cap**, mode C only, the own close excepted: `Fee + Amount ≤ SessionCap − SessionSpent`, and `Amount ≤ SessionMaxPerTx` when the session has one, else `tefSESSION_LIMIT` (`:1173-1183`, cases 11 and 25).
6. **Transaction count**, any mode, the own close excepted: `SessionTxCount < SessionMaxTxCount` when the session has one, else `tefSESSION_LIMIT` (`:1186-1188`, case 27).
7. **Witness**, any mode, the own close excepted: when the session has a `SessionWitness`, the transaction carries a `WitnessSignature` made by a key of the witness account, its master key if not disabled or its `RegularKey` (`isSessionWitnessed`, `rippled/src/libxrpl/tx/SigningSession.cpp:149`), else `tefSESSION_NO_WITNESS` (`:1193-1195`, case 26).

Replacing `T::checkSign` drops two checks, and the hook redoes them: the refusal of pseudo-accounts (rule 0), and the unknown key type, which is part of the predicate.

**The witness signature.** `WitnessSignature` holds one `SigningPubKey` and one `TxnSignature`; a multi-signed witness is not supported (an empty `SigningPubKey` fails the local checks). The signature is verified with the transaction's own, in `STTx::checkSign` (`rippled/src/libxrpl/protocol/STTx.cpp:307-314`), over `WTS\0` followed by the transaction's signing fields (`rippled/src/libxrpl/protocol/Sign.cpp:62-63`). `WitnessSignature` is not a signing field: the session key's signature does not cover it, and the witness signs the same fields as the session key, its `SigningPubKey` included. Its own prefix keeps a witness signature from being replayed as any other role's. A `WitnessSignature` on any transaction is `temDISABLED` in `preflight1` while `SigningSessions` is not enabled (`rippled/src/libxrpl/tx/Transactor.cpp:305-306`), so no node verifies one before the amendment.

The 68 transaction types a session may sign in mode A, and the 7 granular permissions it may hold in mode P, are pinned by test 9b. A new delegable type fails that test until someone decides on it.

## 8. Accounting

`chargeSession` (`rippled/src/libxrpl/tx/Transactor.cpp:1201`) counts a session-signed transaction that claims its fee:

- with `SessionCap` (mode C): adds the fee to `SessionSpent`, plus the `Amount` on `tesSUCCESS`;
- with `SessionMaxTxCount` (any mode): adds one to `SessionTxCount`, on `tes` and `tec` alike.

It runs in `Transactor::operator()`, at exactly two places:

1. **Before the first invariant pass, after the `canApply` block** (`rippled/src/libxrpl/tx/Transactor.cpp:1953`). Every fee-claiming `tec` goes through that block's reset.
2. **Right after the fee-claim reset** that follows a failed invariant pass (`rippled/src/libxrpl/tx/Transactor.cpp:1972`). That reset erases the first count.

Both count the fee the transaction actually claims, which a reset cuts to the balance when the balance cannot cover the declared fee (`tecINSUFF_FEE`).

The session's keylet is read at the top of `operator()` (`rippled/src/libxrpl/tx/Transactor.cpp:1903`), before `apply()`, because an own close erases the entry. The own close is exempt by shape, and a session that no longer exists is skipped. Since the own close pays at most its base fee (§7 rule 4), an account never loses more than `SessionCap` plus one base fee to a mode-C session.

The count cannot live in `apply()`, for two reasons:

- a `tec` from `preclaim` never reaches `apply()`;
- a `tec` result discards the changes of `doApply`.

Case 23 exercises each path on a real transaction:

- `tecNO_DST_INSUF_XRP` from preclaim counts the fee;
- `tecUNFUNDED_PAYMENT` from doApply counts the fee;
- the `tecINVARIANT_FAILED` reset path counts the fee, and the transaction, again.

A leaked mode-C key can burn fees only until the cap stops it: the anti-drain loop test ends in `tefSESSION_LIMIT` after ten fee-burning payments.

**Transaction queue.** The queue may admit several session transactions against the same `SessionSpent` or `SessionTxCount`. Each one is checked again when it is applied (`rippled/src/xrpld/app/misc/detail/TxQ.cpp:357`, `:647`), so the extra ones end in `tefSESSION_LIMIT`. A queued transaction whose session has expired, or has been deleted, is dropped without claiming a fee (case 22). `SigningSessionDelete` is a queue blocker, like `SetRegularKey`: it is queued only alone in its account's queue, and nothing of the account queues behind it; a close that pays the open ledger's fee still applies at once. `SigningSessionSet` is not a blocker, since an opening removes no authority.

A session-signed transaction never displaces a queued transaction of the same account and sequence (or ticket) that its key did not sign (`sessionDisplacesOther`, `rippled/src/xrpld/app/misc/detail/TxQ.cpp:113`): the queue refuses it with `telCAN_NOT_QUEUE_FEE` whatever its fee (`:956`), and the direct apply to the open ledger is skipped when it would replace such a transaction (`:1751-1761`). So a session key cannot outbid the owner's queued close of its session (case 22: neither at twice the base fee nor at the ceiling).

## 9. The `ValidSigningSession` invariant

`ValidSigningSession` is a member of the `InvariantChecks` tuple (`rippled/include/xrpl/tx/invariants/InvariantCheck.h:566`), so it runs in both passes, including the one after a reset. It is implemented at `rippled/src/libxrpl/tx/invariants/SigningSessionInvariant.cpp:79`, `:114`.

1. Only `SigningSessionSet` creates a session, and only `SigningSessionDelete` or `AccountDelete` removes one. The owner count moves by one with each, or one less on the account when a ticket is consumed; for `AccountDelete`, which deletes the account root as well, the count is not checked.
2. `Account`, `SessionKey`, `Expiration`, `Permissions`, `SessionCap`, `SessionMaxPerTx`, `SessionMaxTxCount`, `SessionWitness` and the mode flag never change. At creation, a session has exactly one mode, `SessionSpent` exists only with `SessionCap`, at 0, and `SessionTxCount` exists exactly with `SessionMaxTxCount` (within 1 to 100 000), at 0. `Expiration` lies within 600 seconds of the parent close time when the session is created.
3. `SessionSpent` only increases, never above `SessionCap`, and only in a transaction its session signed and that is not its own close: the own close is never counted and never moves it. `SessionTxCount` never appears or disappears, moves by exactly one in a transaction its session signs and keeps (the own close excepted) and by zero otherwise, and never exceeds `SessionMaxTxCount`; a session-signed transaction that keeps a counting session must count.
4. A mode-C session transaction other than the own close has the shape of a session cap payment, and counts at most `SessionMaxPerTx` beyond its fee when the session has one. When it does not delete its session, it takes no more XRP from the account than `SessionSpent` counts, raises no owner count and changes no sponsoring count. This ties the counter to the real outflow rather than to declared fields.
5. A session-signed transaction never changes the account's `RegularKey`, master-disable flag, signer list, passkey list, delegate entries, beneficiary or firewall, nor another session of the account, and creates no sponsorship, subscription, credential or DID entry (the excluded types).

The invariant recognizes a session-signed transaction even after its own close has erased the session. It uses the predicate without the existence test (`sessionKeyletOf`, `rippled/src/libxrpl/tx/SigningSession.cpp:61`): the session counts as pre-existing if it was visited with a `before` state, or was not visited and still exists. Each rule has a test on a mutated view (case 21).

**Cost.** Once the amendment is enabled, every single-signed transaction reads one session keylet that usually does not exist: once in preclaim, once at the top of `operator()` and once in the invariant. The signing key is hashed to an AccountID each time, which costs more for a 1 312-byte ML-DSA-44 key. This is the price of an invariant that also catches a mode-C transaction that skipped its count.

## 10. RPC

`ledger_entry` accepts a `signing_session` field, either as an index (a hex string) or as `{ "account": …, "session_key": … }` (`rippled/src/xrpld/rpc/handlers/ledger/LedgerEntry.cpp:956`). `account_objects` accepts the type `signing_session`. `server_definitions` exposes the types, fields and codes of §3. The changes are listed in `rippled/API-CHANGELOG.md`.

## 11. Security considerations

- **Least privilege.** A key that later becomes the `RegularKey` stays bounded by its session until the session is deleted (case 17). Creating a session for a key that already has full authority is refused. Wallets should not make a session key a `RegularKey`.
- **Documented limitation (case 17b).** With a fee sponsor, or as a Batch inner signer, a key that is both the `RegularKey` and a session key follows the existing rules and acts with the `RegularKey`'s authority.
- **Revocation cannot be outbid.** The owner closes a session with any full-authority key, by sequence or by ticket: a session-signed transaction never uses a ticket (only its own close may), and never displaces a queued transaction its key did not sign (§8).
- **What modes A and P bound.** They bound _when_ the key can sign, not what the signed transactions leave behind: an escrow, check, channel or offer outlives the session. Only mode C bounds the XRP that leaves the account. `SessionMaxTxCount` bounds how many transactions any mode signs, and a witness makes every one of them need a second signature.
- **Fees in modes A and P (limitation, deviation from the wording of case 13).** The fee ceiling bounds the fee of _each_ session-signed transaction (`base fee of the type + 1000 × base fee unit`), not their number. Without `SessionMaxTxCount`, a mode A or mode P session, even one limited to `TicketCreate`, can therefore pay fees up to the ceiling on every transaction it signs within its 600 seconds (the test `fee ceiling` shows a ticket creation at the ceiling being accepted), and a loop of refusals charges nothing. Only mode C counts fees against a total (`SessionCap`); `SessionMaxTxCount` bounds their number in every mode. The specification's case 13 reads "a mode-P session limited to `TicketCreate` cannot burn the balance"; it holds per transaction, not in total, and the DEVLOG records it as a deviation.
- **The witness.** The witness co-signs the same fields as the session key, under its own prefix, so a witness signature cannot be reused in another role. It is checked against the witness account's current keys when the transaction is applied: rotating the witness's `RegularKey` or disabling its master key takes effect at once. The own close needs no witness, so the session key can always give up its session.
- **Excluded types.** `PasskeyListSet`, `SponsorshipSet` and `SubscriptionSet` are delegable but grant open-ended rights to a new key or a third party, so no session signs them. `CredentialCreate` and `DIDSet` are excluded for the same reason: a credential is a lasting attestation about a third party that other accounts' deposit preauthorizations and permissioned domains accept, and a DID is the account's lasting identity document; both outlive the session and are bounded by no amount fixed at signing. Mode P cannot list them, and the exclusion is checked again when a session signs. Every non-delegable type (`AccountSet`, `SetRegularKey`, `SignerListSet`, `AccountDelete`, `DelegateSet`, `Batch`, `FirewallSet`, `BeneficiarySet`, the two session types…) is out of reach, including their granular permissions.
- **Key types.** The amendment depends on no key type. P-256, Ed25519, secp256k1 and ML-DSA-44 session keys are tested (case 20). A session key whose type belongs to an amendment that is not enabled cannot sign, the own close included (`tefSESSION_TX_NOT_ALLOWED`): P-256 needs `Passkey`, ML-DSA-44 needs `Quantum`. `SigningSessionSet` names the key by its AccountID only, so the check is made at use; the owner, or anyone after expiry, can still delete such a session. A P-256 session key may also sign through WebAuthn, and stays bounded by its session; that test used a software authenticator.

## 12. Test coverage

| Suite                      | Contents                                         |
| -------------------------- | ------------------------------------------------ |
| `SigningSessions`          | Cases 1 to 20 and 22 to 27                       |
| `SigningSessionsBatch`     | Case 28: sessions and `Batch`                    |
| `InvariantsSigningSession` | Case 21                                          |
| `LedgerEntry`              | `testSigningSession`                             |
| `MPToken`                  | `testMPTInvalidInTx` refuses an MPT `SessionCap` |

The generated `protocol_autogen` tests of the three new types run in `xrpl_tests`. Results and mutation checks are recorded in `docs/DEVLOG.md`.

## 13. Not specified here

- The ticket coordination for multi-signing proposed in `docs/adr/0010-tickets-for-multisig-coordination.md`, still Proposed.
- A multi-signed witness, and a witness for the own close.
