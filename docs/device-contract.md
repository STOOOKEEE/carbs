# Device contract: the client and the XRP app

What the client (`packages/ledger`, `@carbs/ledger`) sends to the XRP app of this repository and what it expects back. Every number is read from the device track's code (`ledger-app/`), cited next to it; when that code changes, this file and `packages/ledger/src/apdu.ts` change with it. `packages/ledger` also holds a **simulated device** that follows this contract APDU by APDU; the tests use it, and everything it produces is **SIMULATED** (no device was touched).

Transport: the Device Management Kit only. `connectLedger()` (`packages/ledger/src/webhid.ts`) opens a WebHID session with the DMK (`@ledgerhq/device-management-kit` 1.11.0, `@ledgerhq/device-transport-kit-web-hid` 1.2.4; call it from a user gesture, the browser shows its device picker) and returns a `LedgerDevice`: an `ApduTransport` plus `close()`, so the commands and signers of `packages/ledger` run on the device as they run on the simulated one. Underneath, each APDU is one `dmk.sendApdu({ sessionId, apdu })` (`lib/types/src/api/DeviceManagementKit.d.ts:85`; the answer carries `statusCode` and `data`, `lib/types/src/api/device-session/ApduResponse.d.ts`), adapted by `dmkTransport(dmk, sessionId)`. The classical path sends `0x04` itself rather than through `@ledgerhq/device-signer-kit-xrp`, so the real and the simulated device see the same bytes. `0x11` chunks: the app copies whatever data an APDU carries and checks only the 2 048-byte total (`ledger-app/src/pq/pq_root.c:231-254`), and `Lc` is one byte, so any chunk up to 255 bytes is accepted; the client sends 255 (the first real-device client, proven on a Stax, sent 250). `describeLedgerError(error)` turns a `DeviceError` or a DMK error (a plain object, not an `Error`) into a message for the user.

## 1. APDUs

Header `CLA INS P1 P2 Lc`, `CLA = 0xE0`, at most 255 bytes of data per APDU (`ledger-app/src/apdu/constants.h:22-33`). The app resets its transaction context whenever the instruction changes (`ledger-app/src/apdu/entry.c:40-42`).

### 1.1 Classical keys (as app-xrp does today)

| INS               | P1                                                                                           | P2                                                               | Data                                                                                                                           | Answer                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `0x02` public key | `0x00` no confirmation, `0x01` show the address                                              | `0x40` secp256k1 or `0x80` Ed25519, OR `0x01` for the chain code | BIP32 path: count, then 4 bytes big-endian per element (`44'/144'/0'/0/0` = `05 8000002C 80000090 80000000 00000000 00000000`) | `33` ‖ public key (compressed secp256k1, or `0xED` ‖ Ed25519) ‖ address length ‖ address (ASCII) ‖ chain code (32 bytes, if asked) (`ledger-app/src/apdu/messages/get_public_key.c:38-50`) |
| `0x04` sign       | bit 0 (`0x01`) set on every chunk but the first; bit 7 (`0x80`) set while more chunks follow | curve, as above                                                  | first chunk: the BIP32 path then the transaction; next chunks: the rest of the transaction                                     | DER secp256k1 signature, or 64-byte Ed25519 signature                                                                                                                                      |

The transaction sent to `0x04` is the signing fields **without** `STX\0`, with `SigningPubKey` set to the device key and no `TxnSignature`: the app prepends `STX\0` (or `SMT\0` for a multi-signature, when `SigningPubKey` is empty) itself (`ledger-app/src/apdu/messages/sign_transaction.c:251-263`). The whole transaction, prefix included, is at most 10 000 bytes (`MAX_RAW_TX`, `ledger-app/src/limitations.h:35`; answer `0x6700`). In the client: `encodeForDevice(tx, defs)` of `@carbs/sessions`, then `signClassic`.

### 1.2 ML-DSA-44 root key (device track, FIANSO-SPEC.md section 7.7)

| INS               | P1                                          | P2                       | Data                               | Answer                                                                                                                                                           |
| ----------------- | ------------------------------------------- | ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x10` public key | chunk index `0..5`; chunk 0 derives the key | `0x00`                   | none                               | 250-byte chunks of the 1 312-byte public key (`ledger-app/src/pq/pq_root.c:104-113`)                                                                             |
| `0x11` sign       | `0x00` first chunk, `0x01` next             | `0x00` more, `0x01` last | the signing data, **with** `STX\0` | `0x9000` until the last chunk; after the review, the signature length (2 bytes, big-endian: `09 74` = 2 420) (`ledger-app/src/pq/pq_root.c:171-173`, `:231-254`) |
| `0x12` signature  | chunk index `0..9`                          | `0x00`                   | none                               | 250-byte chunks of the 2 420-byte signature; `0x6982` if there is none (`ledger-app/src/pq/pq_root.c:256-261`)                                                   |

The signing data is `STX\0 ‖ signing fields`, with `SigningPubKey` = the 1 312-byte ML-DSA public key, at most 2 048 bytes in total (`PQ_MAX_MESSAGE`, `ledger-app/src/apdu/global.h:71`; more gets `0x6700`, `ledger-app/src/pq/pq_root.c:244-247`). The app checks the prefix (`0x6A80` without it), parses the rest with its own parser and shows the same review as a classical signature (`ledger-app/src/pq/pq_root.c:179-229`). Before any review it applies the same session rules as the classical path: a session transaction that cannot be clear-signed gets `Session transactions are never blind-signed` and `0x6815`, and a transaction the session policy refuses gets `Blocked by your session policy` and `0x6986` (`ledger-app/src/pq/pq_root.c:189-207`; sections 6 and 7). While that review is on screen it refuses every `0x11` chunk with `0x6A80`, as the classical path does in `PENDING_REVIEW` (`ledger-app/src/apdu/messages/sign_transaction.c:273-285`), and on approval it signs only if the buffer still has the SHA-256 it had when the review was shown (`0x6A80` otherwise; `ledger-app/src/pq/pq_root.c:127-149`, `:232-236`). Another instruction during the review resets the context (`ledger-app/src/apdu/entry.c:40-42`) and cancels the review: the approval then signs nothing and answers nothing. A transaction that needs blind signing is refused with the error screen and `0x6985` when blind signing is disabled in the settings, as on the classical path (`ledger-app/src/pq/pq_root.c:208-215`, `ledger-app/src/transaction/transaction.c:203-205`). It signs with pure ML-DSA-44, an empty context, over the whole message, as the node verifies it. In the client: `encodeForSigning(tx, defs)`, then `signMlDsa`; `deviceMlDsaSigner(transport)` wraps both in the `BytesSigner` of `@carbs/sessions`.

### 1.3 Status words

`0x9000` success · `0x6985` rejected by the user, or blind signing needed while disabled in the settings · `0x6700` too long · `0x6A80` bad data (missing prefix, parse failure on the ML-DSA path, an `0x11` chunk while a review is on screen, or reviewed bytes that changed) · `0x6A81` bad BIP32 path · `0x6B00` bad P1/P2 or chunk index · `0x6982` no signature to read · `0x6F00` internal error (key derivation or signing failed) · `0x6D00` unknown instruction · `0x6E00` unknown class · `0x6815` session transaction refused because it cannot be clear-signed, on both paths (section 6) · `0x6986` refused by the session policy, on both paths (section 7) · `0x68xx` parse error on the classical path (`0x6800 | code`, `ledger-app/src/apdu/messages/sign_transaction.c:246-249`). Sources: `ledger-app/src/pq/pq_root.c:55-62`, `ledger-app/src/apdu/entry.c:37`, `:67`. The client raises `DeviceError` with the status word.

## 2. Screen lines

The client predicts the review (`reviewLines(tx, defs)` in `packages/ledger/src/screen.ts`). Order: `Transaction Type`, `Account`, `Session key` and `Agent ID` (when present, section 6), then every shown field in serialization order, then the synthetic rows of `SigningSessionSet`: `Allows; XRP payments only, fees included` in mode C, then `Note` (`ledger-app/src/xrp/signing_session.h`, `ledger-app/src/xrp/xrp_parse.c`, `append_review_rows`). A signed field that claims the id of any synthetic row is refused (`ledger-app/src/xrp/xrp_parse.c`, `post_process_field`; vectors `10-spoofed-note`, `13-spoofed-scope`, `34-session-agent-id/04-spoofed-agent-id`). The note says only what the node refuses to every session, whatever its mode: a new key or signer (`SetRegularKey` and `SignerListSet` are not delegable, `rippled/include/xrpl/protocol/detail/transactions.macro:124`, `:173`; `PasskeyListSet` is excluded, `rippled/include/xrpl/tx/SigningSession.h:22-26`); in mode P a granular account permission (for example `AccountDomainSet`, `rippled/include/xrpl/protocol/detail/permissions.macro:29`) can still change the account, so the note does not claim more. The lines below are the device track's frozen vectors (`ledger-app/tests/standalone/testcases/*.txt`); `packages/ledger` reproduces each of them line for line in a test.

`SigningSessionSet`, mode A (`30-signing-session-set/01-mode-all`):

```text
Transaction Type; Open session
Account;          rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK
Session key;      rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy
Agent ID;         A1E8-094F
Network ID;       24100
Allows;           All transactions
Valid for;        10 minutes
Fee;              XRP 0.000012
Note;             Cannot change keys or signers
```

Mode P lists `Allows [1]` … `Allows [10]` (one permission each, by name, after `Fee`; `02-mode-permissions`, `04-ten-permissions`); mode C shows `Max spend; XRP 20` after `Fee`, then `Max per payment` (`SessionMaxPerTx`) and, after the amounts, `Witness` (`SessionWitness`) when present, and `Allows; XRP payments only, fees included` before the `Note` (`03-mode-cap`, `05-short-duration`, `12-cap-per-tx-and-witness`, `34-session-agent-id/01-agent-id`): the node lets a capped session sign a direct XRP payment and nothing else, and counts the fee against the cap. Durations: `10 minutes`, `5 minutes`, `1 minute`, `1 min 30 s`, `45 s` (`05-short-duration`). An unknown permission value, an unknown flag, an unknown field and a forged `Note`, `Allows` or `Agent ID` field make the app refuse (`06-` to `11-`, `13-spoofed-scope`, `34-session-agent-id/02-` to `04-`); the client's prediction for those is `refused`, never `blind` (section 6).

`SigningSessionDelete` (`31-signing-session-delete/01-own-close`, `02-expired-by-third-party`): `Transaction Type; Close session`, `Account`, `Session key`, `Agent ID`, `Fee`, and `Owner` when a third party closes an expired session.

`SetRegularKey` (`02-set-regular-key/01-basic`), step 1 of the migration:

```text
Transaction Type; Set Regular Key
Account;          rTooLkitCksh5mQa67eaa2JaWHDBnHkpy
Fee;              XRP 0.000018
Regular Key;      rTooLkitCksh5mQa67eaa2JaWHDBnHkpy
```

`AccountSet` with `asfDisableMaster` (`06-account-set/04-disable-master`), step 3 of the migration:

```text
Transaction Type; Account Setting
Account;          rTooLkitCksh5mQa67eaa2JaWHDBnHkpy
Set Flag;         Disable Master
Fee;              XRP 0.00001
```

The proof step of the migration is an `AccountSet` with no field to show: `Transaction Type; Account Setting`, `Account`, `Fee`.

## 3. Byte layout

| Path               | What the client sends                            | Prefix                      | `SigningPubKey`                    | `TxnSignature` |
| ------------------ | ------------------------------------------------ | --------------------------- | ---------------------------------- | -------------- |
| Classical (`0x04`) | `encodeForDevice(tx)`: the signing fields        | none (the app adds `STX\0`) | the device's classical key         | absent         |
| ML-DSA (`0x11`)    | `encodeForSigning(tx)`: `STX\0 ‖ signing fields` | `STX\0`, sent by the client | the device's 1 312-byte ML-DSA key | absent         |

Non-signing fields (`TxnSignature`, `Signers`, `PasskeySignature`) are never part of what the device signs. `encodeForDevice` reproduces byte for byte the seven valid vectors of `ledger-app/tests/standalone/testcases/30-*` and `31-*` (test in `packages/core/src/encode.test.ts`).

## 4. Test vectors

**ML-DSA-44 key derivation** (the device's, `ledger-app/src/pq/pq_root.c:4-8`, `:64-93`): BIP39 seed → SLIP-21 node of the label `carbs ML-DSA-44` (`HMAC-SHA512(m[0..32], 0x00 ‖ label)`, with `m = HMAC-SHA512("Symmetric key seed", seed)`) → its last 32 bytes are the seed of `ML-DSA.KeyGen_internal`. `packages/ledger/src/slip21.ts` implements it and passes the four test vectors of SLIP-0021. For Speculos' default mnemonic (`glory promote mansion … raise skin`, public), the client computes:

|                                      | Value                                                              |
| ------------------------------------ | ------------------------------------------------------------------ |
| SHA-256 of the 1 312-byte public key | `DDDC0737CF9BC347D07D45C562A355192DAA22CBCD5432F5FB8B40CD3525F948` |
| AccountID of the key                 | `rsr2Kobu5srdxbFTFhWnmTR5PPDZoZtTUi`                               |

**UNVERIFIED** until the device-track owner reads `INS 0x10` on Speculos (or a device loaded with that mnemonic) and compares: that the SDK's SLIP-21 computes exactly this node.

**ML-DSA-44 signatures.** Signing is randomized, so a vector is a key, a message and the check that a signature verifies: `packages/ledger/src/ledger.test.ts` signs a `SigningSessionSet` through the full `0x10`/`0x11`/`0x12` exchange with the simulated device and verifies the 2 420-byte answer with `@noble/post-quantum` 0.7.1 (`ml_dsa44.verify`, pure, empty context) over `STX\0 ‖ fields`. On the public AlphaNet, a signature made the same way by `@noble/post-quantum` was accepted by the node (spike K3, `docs/DEVLOG.md`), and the device track's signatures made on the Stax were verified with `@noble/post-quantum` before submission (`docs/DEVLOG.md`, the post-quantum root entries). Both sides therefore agree on the message: pure ML-DSA over the full signing data.

## 5. Items left to the device-track owner

1. Compare the key-derivation vector of section 4 with `INS 0x10` on Speculos or a test device.
2. Run the `packages/ledger` commands over `connectLedger()` against the real app (K6): `0x02`/`0x04` for a classical key (until now the Stax signed classically through `@ledgerhq/device-signer-kit-xrp`, not through `signClassic`), `0x10`/`0x11`/`0x12` for the ML-DSA key (proven on a Stax with the same APDUs in 250-byte `0x11` chunks).
3. On the Stax: confirm the review lines of section 2 for `SigningSessionSet` (the three modes), `SigningSessionDelete`, `SetRegularKey` and `AccountSet asfDisableMaster`, and photograph them.
4. Sign the three migration steps of spike K3 on the device (W7) on a fresh AlphaNet account, then a `SigningSessionSet` signed by the device's ML-DSA key once a node with the amendment exists (W3).
5. Measure the largest session and migration transactions against the 2 048-byte ML-DSA limit (K4, FIANSO-SPEC.md section 16 row 3).

## 6. Agent ID and session refusal

**Agent ID.** Every review of a `SigningSessionSet` or `SigningSessionDelete` (top level or inner transaction of a `Batch`) shows, right after `Session key`, a line `Agent ID; XXXX-XXXX`: the first 4 bytes of the `SessionKey` AccountID, in uppercase hex, as two groups of 4 characters joined by `-`. The AccountID bytes are the 20 bytes of the decoded r-address (base58 with the XRPL alphabet, without the `0x00` version byte and the 4-byte checksum), the same 20 bytes the transaction carries. The agent shows the same identifier for its session key, so the user can match the device screen to the agent. Example: `rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy` → AccountID `A1E8094FE22C…` → `A1E8-094F`. Host side (`decodeAccountID` of `ripple-address-codec`, `bytesToHex` of `packages/core/src/bytes.ts`):

```ts
const agentId = (address: string): string =>
  bytesToHex(decodeAccountID(address).subarray(0, 4)).toUpperCase().replace(/^(.{4})/, "$1-");
```

The line is the app's own (`XRP_ACCOUNT_AGENT_ID`, `ledger-app/src/xrp/signing_session.h`): a signed field claiming its id is refused, like the synthetic `Note`.

**Never blind-signed.** A session transaction the app cannot clear-sign (an unknown field, too many fields, an unknown permission value or flag, or a `Batch` holding one that would go blind) is refused even when the blind-signing setting is on: the device shows `Session transactions are never blind-signed` and answers `0x6815`, on the classical path and on the ML-DSA path alike (`ledger-app/src/xrp/xrp_parse.c`, `parse_tx`; `ledger-app/src/apdu/messages/sign_transaction.c`; `review_signing_data`, `ledger-app/src/pq/pq_root.c`). A `Batch` is checked as far as its parsing went: an inner transaction after the point where parsing stopped is not known to the app.

## 7. Session policy

The user's own limits on the signing sessions the device agrees to open, stored in the device NVM (`session_policy_t` in `internal_storage_t`, `ledger-app/src/policy/session_policy.h`, `ledger-app/src/globals.h`). It is **edited only from the device settings**; the host can read it, never write it. Fresh install: all zero, policy off, nothing changes.

**Settings** (`ledger-app/src/ui/main/session_policy_menu.c`), after the `Blind signing` page:

| Setting (switch)   | Sub-text                          | Meaning when on                   |
| ------------------ | --------------------------------- | --------------------------------- |
| `Session policy`   | `Check sessions before review`    | the policy is checked             |
| `All transactions` | `Allow sessions for any type`     | mode A (`tfAllTransactions`) allowed |
| `Permissions`      | `Allow sessions with permissions` | mode P (`Permissions`) allowed    |
| `Witness`          | `Require a session witness`       | `SessionWitness` must be present  |

Then three limits, each a bar whose tap moves to the next preset: `Max spend: …` (no limit, XRP 10, 50, 100, 500), `Max per payment: …` (no limit, XRP 1, 5, 10, 50), `Max duration: …` (no limit, 1, 3, 5, 10 min).

**Check.** On the classical path (`0x04`) and the ML-DSA path (`0x11`), when the policy is on, every `SigningSessionSet` (the transaction itself, or each inner transaction of a `Batch`) is checked before any review (`review_transaction`, `ledger-app/src/transaction/transaction.c`; `review_signing_data`, `ledger-app/src/pq/pq_root.c`; both call `session_policy_check_transaction`). Refused: mode A when not allowed; mode P (no flag, no `SessionCap`) when not allowed; `SessionCap` not XRP or above `Max spend`; under a `SessionCap`, `SessionMaxPerTx` missing, not XRP or above `Max per payment` (when that limit is set); `SessionDuration` missing or above `Max duration`; no `SessionWitness` when required. A limit at "no limit" is not checked. The device shows `Blocked by your session policy` with the reason (for example `Max spend XRP 500 is above XRP 50`, prefixed `Transaction n: ` for an inner transaction of a `Batch`), buttons `Back to home` / `Session policy settings` (Nano: `Blocked by your session policy` only), and answers **`0x6986`** at once, on both paths.

**`INS 0x08`: get session policy.** `P1 = P2 = 0x00` (else `0x6B00`), no data. Answer, 22 bytes, `0x9000` (`session_policy_serialize`, `ledger-app/src/policy/session_policy.c`; `ledger-app/src/apdu/messages/get_session_policy.c`):

| Offset | Size | Field                                                                                   |
| ------ | ---- | --------------------------------------------------------------------------------------- |
| 0      | 1    | format version, `0x01`                                                                   |
| 1      | 1    | flags: `0x01` policy on, `0x02` mode A allowed, `0x04` mode P allowed, `0x08` witness required |
| 2      | 8    | max `SessionCap`, drops, big-endian; `0` = no limit                                      |
| 10     | 8    | max `SessionMaxPerTx`, drops, big-endian; `0` = no limit                                 |
| 18     | 4    | max `SessionDuration`, seconds, big-endian; `0` = no limit                               |

Fresh install: `01` followed by 21 zero bytes.
