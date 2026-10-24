# carbs: FIANSO-SPEC, the build specification

| | |
|---|---|
| **Author** | Sofiane ("fianso", [@STOOOKEEE](https://github.com/STOOOKEEE)). This is **my** specification, hence its name. The decisions in §2 are mine and apply to the whole team. |
| **Written** | 2026-10-24, before the XRPL Commons NYC hackathon kickoff (24 Oct 10:00 ET). |
| **Nature** | Documentation and design only. It contains **no implementation code** and no code from any earlier prototype. All code in this repository is written during the hackathon (24-25 Oct 2026) after this file, apart from the unmodified upstream imports in `rippled/` and `ledger-app/` (§4). |
| **Source** | Consolidates the preparation dossier `docs/carbs/` on branch `fianso` of [STOOOKEEE/TTT](https://github.com/STOOOKEEE/TTT) (SPEC, XLS-Sessions, BUILD-PLAN, TERRAIN, PITFALLS, REVIEW), re-checked against upstream code on 2026-10-24. |
| **Not this** | An earlier "v2" design and prototype (`feat/signing-sessions` in `STOOOKEEE/TTT`: witness co-signer, `ForceQuantum`, XRP-only payments) is a different design, is declared in the README, and is **not reused**. |
| **Status** | Decisions D0-D8 are in [§2](#2-decisions). Items marked **UNVERIFIED** were not confirmed in code or on a device on 2026-10-24 and must be checked on first use. |

---

## TL;DR

**carbs adds ledger-enforced signing sessions to the XRP Ledger.** An account opens a *session*: a short-lived (≤ 10 minutes) ephemeral key that signs without prompting, and that the **ledger itself** confines in time, in transaction types (or in XRP spent), and in fee burn. It can never change who controls the account.

- **Protocol**: a rippled amendment `SigningSessions` (new ledger entry `SigningSession`, transactions `SigningSessionSet` / `SigningSessionDelete`), built on the XLS-75 permission engine, in `rippled/` (base: `XRPLF/rippled:alphanet`).
- **Three exclusive modes**: **A** all delegable types minus an exclusion list, **P** a list of XLS-75 permissions, **C** direct XRP `Payment` only with a total cap (fees included).
- **Opened** by a passkey (P-256, Face ID / Touch ID) **or** by a **Ledger Stax** that clear-signs the rules on its screen ("Valid for 10 minutes · All transactions · Cannot change keys").
- **Ledger app**: `LedgerHQ/app-xrp` extended with clear signing for the two new transactions (L1). Stretch: ML-DSA-44 signing on the device (post-quantum root), a P-256 key on the device usable as a passkey, `Batch` clear signing.
- **Documentation feedback for Ledger** is a first-class deliverable, judged "as much as the code" (Ledger bounty judging, announced at the Ledger workshop): a running log kept from the first minute, screenshots, and pull requests to the docs ([§7.6](#76-documentation-and-developer-experience-feedback)).
- **Client**: TypeScript (`packages/core`, `apps/web`), WebCrypto non-extractible P-256 session keys, Ledger over WebHID with the Device Management Kit and custom APDUs.
- **Single public repository** `carbs`; upstream bases imported unmodified in their own commits; PRs and commits in the XRPLF style.

---

## 1. Contents

2. [Decisions](#2-decisions) · 3. [Ground rules](#3-ground-rules) · 4. [Repository](#4-repository-layout-and-imports) · 5. [Environment](#5-environment-and-toolchain) · 6. [Protocol](#6-protocol) · 7. [Ledger app](#7-ledger-application) · 8. [Client](#8-client) · 9. [Spikes](#9-spikes-k1-k6) · 10. [Work breakdown](#10-work-breakdown) · 11. [Demo and presentation](#11-demo-and-presentation) · 12. [Security](#12-security-model) · 13. [Risks and plan B](#13-risks-and-plan-b) · 14. [Git workflow](#14-git-workflow-commits-and-pull-requests) · 15. [Open items](#15-open-items) · [A. Constants](#appendix-a-constants) · [B. References](#appendix-b-references) · [C. Kickoff checklist](#appendix-c-kickoff-checklist)

---

## 2. Decisions

Taken by Sofiane on 2026-10-24, **for the whole team**.

| ID | Question | Decision |
|---|---|---|
| **D0** | Restart from scratch or declare the earlier prototype as an existing product and add features | **Restart from scratch.** Every line submitted is written during the hackathon in the new repository. The earlier prototype is declared and not reused. |
| **D1** | Protocol base | **The latest XRPL base**: `XRPLF/rippled` branch `alphanet`, head at kickoff. On 2026-10-24 the head is `68bd02b647` (composed 2026-10-16, "alphanet from XRPLF/rippled@3.4.1", 14 branches, option `force_supported: ON`). Re-read the head at 10:00 and re-verify the protocol codes on the SHA actually imported. Fallback if it does not build: `Transia-RnD/rippled:alphanet` @ `0a4cfdb61e`. |
| **D2** | Session duration | **10 minutes**: `kMaxSessionDuration = 600 s` in the protocol **and** in the app. |
| **D3** | One ledger object per session, or entries in the passkey list | Default kept: **one object per session** (the XLS-83 question raised by Mayukha). **To ask Denis** at office hours (Sat 16:00-17:00 ET). |
| **D4** | Exact exclusion list for mode A | **Postponed.** Default kept: `PasskeyListSet`, `SubscriptionSet`, `SponsorshipSet` plus everything non-delegable; an enumeration test forces an explicit decision for every delegable type ([§6.8](#68-exclusion-list-and-enumeration-test)). In plain terms: *which transaction types an "all transactions" session must never be able to sign.* |
| **D5** | Who does what | **No split for now.** This spec describes two work tracks (protocol; Ledger and client), not people. |
| **D6** | Prize opt-ins | **Protocol Innovation track + Ledger Protocol Innovation.** Nothing else (no Ledger Agentic). |
| **D7** | Passkey defects found in the base | **Presentation only.** No upstream PR and no message to Denis for now. The one exception inside the build is P5: it is *tested* on our node first, and fixed in a separate commit only if our passkey path fails because of it ([§6.14](#614-passkey-path-and-key-formats)). |
| **D8** | After L1, which Ledger stretch first: ML-DSA on device (L2) or a P-256 passkey key on device (L6) | **Postponed.** Spikes K4 (memory) and an L6 probe produce the facts. |

---

## 3. Ground rules

1. **Everything submitted is written during the hackathon**, in this repository. Upstream code (`rippled/`, `ledger-app/`) is imported **unmodified, in its own first commit per directory**, with SHA, URL and licence recorded in `UPSTREAM.md`. `git diff <import-commit>..HEAD -- rippled/` must show our work alone.
2. **No fork, no submodule.** A submodule renders as a link and clones empty without `--recursive`; a private or deleted fork breaks the review.
3. **README states "Existing before Oct 24 / Built during the hackathon"** with dates and commit ranges. `docs/DEVLOG.md` is dated and records what was done, removed, ignored or simulated.
4. **One base defect per commit**, never mixed with the amendment.
5. **No security claim without a test that proves it.** No upstream test removed or edited to go green (a changed delegable-type counter is re-pinned with a written justification in the commit).
6. **No secret in the repository** (standalone genesis seed from an environment variable). No third-party script in the web app (CSP `script-src 'self'`).
7. **Real device for the Ledger deliverables.** Speculos and Ragger are regression tools only; anything shown on a device is shown on the Stax. Anything simulated is said to be simulated.
8. **Protocol codes are never copied by hand** into client code: they come from `server_definitions` of the node in use.
9. **Spikes on the public AlphaNet** use a fresh account for each attempt and always sign on the client (never through the node's `sign` RPC with a P-256 key).

---

## 4. Repository layout and imports

```text
carbs/
  FIANSO-SPEC.md              this file (Sofiane's spec, written before kickoff)
  README.md                  what it is, "Existing before Oct 24 / Built during the hackathon", demo instructions
  UPSTREAM.md                SHA, URL, licence of each import (rippled: ISC; app-xrp: Apache-2.0)
  rippled/                   XRPLF/rippled:alphanet @ <head at kickoff>, imported unmodified, then the amendment
  ledger-app/                LedgerHQ/app-xrp master @ 7b5185ff (v2.8.2), imported unmodified, then clear signing
  packages/core/             definitions, encoding, signatures, constants, node client
  packages/ledger/           DMK library (stretch)
  apps/web/                  Vite + Vue 3 + TypeScript strict
  infra/                     standalone.cfg, ledger closer, Dockerfile of the node
  docs/                      DEVLOG.md, XLS-Sessions.md (final), ledger-dx-feedback.md
```

**Import procedure** (first 20 minutes after kickoff):

1. `git clone --depth 1` the upstream at the chosen SHA outside the repo; record `git rev-parse HEAD`.
2. Copy the tree **without `.git`** into `rippled/` (resp. `ledger-app/`), keep upstream `LICENSE` files.
3. Commit each import alone: `build: Import XRPLF/rippled alphanet at <sha10>` and `build: Import LedgerHQ/app-xrp master at 7b5185ff`. Commit body: URL, full SHA, licence, "unmodified".
4. Add `UPSTREAM.md` in a separate `docs:` commit.
5. Sizes measured on the pinned SHAs: rippled ≈ 2 300 files / 27 MB, app-xrp ≈ 27 MB (mostly test snapshots), ≈ 55 MB in total.

**Why `XRPLF` and not `Transia`**: upstream, the Foundation's public AlphaNet, 3.4.1 with role-based signature prefixes, October ML-DSA fixes, same `conanfile.py` as the 3.4.1 already cached on the team machines (only `dilithium.cmake` is added), and no port after the event. Transia remains the fallback: same field codes, regenerated result-code values, no Firewall or Beneficiary, `PasskeyListSet` = 118.

---

## 5. Environment and toolchain

### 5.1 Versions and pins

| Component | Value |
|---|---|
| Node base | `XRPLF/rippled:alphanet`, head at kickoff (`68bd02b647` on 24 Oct), rippled 3.4.1 + passkeys + ML-DSA |
| Ledger base | `LedgerHQ/app-xrp` `master` @ `7b5185ff` (v2.8.2; supports `nanox`, `nanos+`, `stax`, `flex`, `apex_p`; UI is NBGL only) |
| Ledger SDK | `ledger-app-builder` image, SDK v27.1.3 (`API_LEVEL` 27) |
| Device | **Ledger Stax** (2023, model 2103), **firmware 1.11** = `API_LEVEL` 27 (tag `stax_1.11.0` of `ledger-secure-sdk`, `Makefile.defines`); SRAM 36 KB; touchscreen; sideload allowed |
| Client | Vite, Vue 3, TypeScript strict, Vitest, `xrpl` 5.3.0, `ripple-binary-codec` 2.11.0, `@noble/post-quantum` **0.7.1 pinned**, `@noble/curves`, `@noble/hashes`, `@ledgerhq/device-management-kit` 1.11.0, `@ledgerhq/device-signer-kit-xrp` 0.3.0, `@ledgerhq/device-transport-kit-web-hid` 1.2.4. **Device Management Kit only** (the Ledger-proposed stack); the legacy ledgerjs packages (`@ledgerhq/hw-app-xrp`, `@ledgerhq/hw-transport-webhid`) are not used |
| Package manager | pnpm |
| Public AlphaNet (spikes only) | RPC `https://rpc.alphanet.xrpl.org`, WebSocket `wss://alphanet.xrpl.org`, faucet `https://faucet.alphanet.xrpl.org/accounts`, network id 24100 |

`device-signer-kit-xrp` 0.3.0 signs secp256k1 and Ed25519 only, has no secp256r1 or ML-DSA and no transaction types of its own, but its `signTransaction(path, Uint8Array)` forwards the **raw transaction bytes**: opening a session with a secp256k1 / Ed25519 device key therefore needs **no custom APDU** once the app clear-signs types 130 / 131 (to confirm in K6 with a type 130). The P2 byte of its APDUs is limited to those two curves, so **L2 (ML-DSA) and L6 (P-256) need custom APDUs** sent through the DMK.

### 5.2 Machine and tooling checklist

- Disk: rippled build tree plus the Conan cache (≈ 21 GB for `~/.conan2`) plus the app-builder image. Free the space before kickoff.
- `conan` must be on `PATH` (it was missing on 24 Oct); CMake, Ninja or Make, a C++20 compiler as required by rippled 3.4.1.
- Docker: **compiles** the Ledger app (`ledger-app-builder`). It does **not** load it: Docker Desktop on macOS does not pass USB to a container.
- **Loading the app on the Stax from the Mac**: three routes to decide in L0, in this order of try: (1) `ledgerctl` (`pip install ledgerwallet`; its README lists Nano S, X and S+ only and asks for a custom CA installed in Recovery mode: **UNVERIFIED on Stax**); (2) `python -m ledgerblue.loadApp ...` (`pip install ledgerblue`, the command `make load` runs); (3) the VS Code extension "Ledger Dev Tools". Record the route that works in `docs/DEVLOG.md`.
- Chrome with WebHID for the web app; a Mac with Touch ID (passkey) and optionally an iPhone (Face ID, needs HTTPS origin and a `wss://` node, see [§8.5](#85-appsweb)).
- Set `STAX_SDK` (variable provided by the builder image) for `make BOLOS_SDK=$STAX_SDK`.

### 5.3 Command reference (validate during setup)

| Need | Command |
|---|---|
| Standalone node | `./xrpld -a --start --conf infra/standalone.cfg`; ledgers closed every 1-3 s by **one** process calling `ledger_accept` |
| Generated code | `cmake -S cmake/codegen -B build/codegen && cmake --build build/codegen --target setup_code_gen && cmake --build build/codegen --target code_gen` (regenerate **only our types**) |
| Protocol tests | `./xrpld --unittest=SigningSessions`, then upstream suites `Delegate`, `PasskeyListSet`, `AccountDelete`, `PassKey` (green before and after) |
| Ledger app build | in the builder image: `make BOLOS_SDK=$STAX_SDK` |
| Ledger unit tests | `make -C unit-tests ...` (cmocka) |
| Ledger Ragger tests | `pytest tests/standalone --device stax` |
| Web / core | `pnpm -r test`, `pnpm --filter web dev`, `pnpm demo` (node + closer + app) |

---

## 6. Protocol

### 6.1 New identifiers

All codes were checked free on 2026-10-24 on both `XRPLF/rippled:alphanet` @ `68bd02b647` and `Transia-RnD/rippled:alphanet` @ `0a4cfdb61e`, and against `server_definitions` of the public AlphaNet (transactions ≤ 128, ACCOUNT ≤ 33, AMOUNT ≤ 46, UINT32 ≤ 113, ledger entries ≤ `0x99`). **Re-verify on the imported SHA (spike K5) before writing anything.**

| Item | Value |
|---|---|
| Amendment | `XRPL_FEATURE(SigningSessions, Supported::Yes, VoteBehavior::DefaultNo)` (**`Supported::Yes`**, the normal state of a feature we ship); requires `PermissionDelegationV1_1` via `checkExtraFeatures` |
| Fields | `SessionKey` ACCOUNT 34 · `SessionCap` AMOUNT 47 · `SessionSpent` AMOUNT 48 · `SessionDuration` UINT32 114. Reused: `Expiration`, `Permissions` (ARRAY 29 / OBJECT 15 / UINT32 52 for `PermissionValue`) |
| Ledger entry | `ltSIGNING_SESSION = 0x009A`; keylet namespace `'z'` (`0x007A`) |
| Transactions | `SigningSessionSet = 130`, `SigningSessionDelete = 131`, **both non-delegable**; `ttSIGNING_SESSION_SET`, `ttSIGNING_SESSION_DELETE` |
| Result codes (append at the **end** of `TEFcodes`, after `tefFIREWALL_BLOCK`) | `tefSESSION_EXPIRED`, `tefSESSION_LIMIT`, `tefSESSION_TX_NOT_ALLOWED` |
| Flag | `tfAllTransactions = 0x00010000` (on `SigningSessionSet`), mirrored as `lsfAllTransactions` on the entry |
| Invariant | `ValidSigningSession` |
| RPC | `ledger_entry` type `signing_session`; `account_objects` type `signing_session` |

### 6.2 Ledger entry `SigningSession`

Object ID: `SHA512Half(0x007A ‖ Account ‖ SessionKey)` (two 20-byte AccountIDs). Keyed by the session key so the server finds the session from the transaction's signer with no extra field.

| Field | Req. | Meaning |
|---|---|---|
| `LedgerEntryType` | yes | `0x009A` |
| `Account` | yes | owner |
| `SessionKey` | yes | AccountID of the session key (the public key appears only in the first session-signed transaction) |
| `Expiration` | yes | Ripple-epoch seconds = `parentCloseTime + SessionDuration` at creation |
| `Permissions` | mode P | 1..`kPermissionMaxSize` (10) XLS-75 permission values |
| `SessionCap` | mode C | positive XRP amount, total cost of the session, fees included |
| `SessionSpent` | mode C | `0` at creation, only increases |
| `Flags` | yes | `lsfAllTransactions = 0x00010000` in mode A |
| `OwnerNode`, `PreviousTxnID`, `PreviousTxnLgrSeq` | yes | standard |

Exactly one of {`Permissions`, `lsfAllTransactions`, `SessionCap`} is set. Registered in the owner's directory; one owner reserve. An expired entry stays, unusable, until deleted. `AccountDelete` **must** delete the account's sessions (they are not obligations): add an entry for the type in `nonObligationDeleter` (`AccountDelete.cpp`, around line 205), otherwise `tecHAS_OBLIGATIONS`.

### 6.3 Transactions

**`SigningSessionSet`** (not delegable, not session-signable)

| Field | Req. | Notes |
|---|---|---|
| `SessionKey` | yes | AccountID of the new key |
| `SessionDuration` | yes | seconds, `1 ≤ d ≤ kMaxSessionDuration (600)` |
| `Permissions` | mode P | 1..10 values, duplicates rejected |
| `SessionCap` | mode C | native XRP, positive |
| `tfAllTransactions` | mode A | flag `0x00010000` |

Preflight (stateless, `tem`): unknown flag bits (`tfSigningSessionSetMask`, and no flag at all for `SigningSessionDelete`) → `temINVALID_FLAG`; not exactly one mode → `temMALFORMED`; `SessionKey == Account` → `temMALFORMED`; duration 0 or > max → `temBAD_EXPIRATION`; `Permissions` empty / too large → `temARRAY_EMPTY` / `temARRAY_TOO_LARGE`; duplicate value, non-delegable value, or a type in the exclusion list → `temMALFORMED`; `SessionCap` not XRP or not positive → `temBAD_AMOUNT`.
Preclaim / doApply: `SessionKey` equals the account's `RegularKey`, one of its passkey AccountIDs, or its beneficiary key → `tecNO_PERMISSION` (such a key already has full authority); a session already exists for (`Account`, `SessionKey`) → `tecDUPLICATE`; reserve → `tecINSUFFICIENT_RESERVE`.
Effect: create the entry (`Expiration = parentCloseTime + SessionDuration`; `SessionSpent = 0` in mode C), insert in the owner directory, increase owner count. Use the sponsor-aware reserve helpers like `DelegateSet.cpp` (`checkReserve`, `increaseOwnerCount`). No update: delete and reopen.

**`SigningSessionDelete`** (not delegable)

| Field | Req. | Notes |
|---|---|---|
| `SessionKey` | yes | session to delete |
| `Owner` | no | owner when the submitter is not the owner |

Without `Owner`: signed by any full-authority key **or by the session key itself** (the "own close"). With `Owner` (≠ `Account`): any account may delete once the session is **expired**, else `tecNO_PERMISSION`. Missing entry → `tecNO_ENTRY`; `Owner == Account` → `temMALFORMED`.

### 6.4 The session-signed predicate

A transaction is **session-signed** iff **all** hold:
- single-signed (non-empty `SigningPubKey`, no `Signers`);
- no `Delegate`, no `Sponsor`, no `SponsorSignature`, and not an inner Batch transaction;
- a `SigningSession` exists for (`Account`, `AccountID(SigningPubKey)`);
- it carries no `CounterpartySignature` (a session key used as a counterparty signer follows the existing rules and is rejected).

The predicate first tests `rules.enabled(featureSigningSessions)` (no ledger read on every transaction before activation) and that `SigningPubKey` is a valid public key type. One function, `isSessionSigned(view, tx)`, serves **authorization, accounting and the invariant** so that they cannot disagree. A session-signed transaction is authorized **only** by its session: master, `RegularKey`, passkey and beneficiary rules are not consulted. Consequence: a key that later also becomes `RegularKey` stays bounded until its session is deleted (least privilege); creating a session for a key that already has full authority is forbidden (§6.3). Two shapes follow the existing rules: sponsored transactions and a Batch inner-account signature (`Batch::checkBatchSign` calls `Transactor::checkSign`). Wallets should not make a session key a `RegularKey`.

### 6.5 Authorization hook

Upstream order in `invokePreclaim` (`src/libxrpl/tx/applySteps.cpp`, verified at `68bd02b647`): `checkSeqProxy` → `checkPriorTxAndLastLedger` → `checkSponsor` → `Transactor::invokeCheckPermission<T>` → `T::checkSign` → `Transactor::checkFirewall` → fee → `T::preclaim`. Everything up to and including `checkSign` **must return `NotTEC`** (no `tec` before the signature check: a fee would be charged before authorization).

Add a templated hook and call it **in place of** `T::checkSign` when the predicate holds. It is templated like `invokeCheckPermission<T>` because granular permissions need `T::checkGranularSemantics`.

```text
invokePreclaim:
    ...
    invokeCheckPermission<T>          // Delegate path; returns tesSUCCESS when sfDelegate is absent
    if isSessionSigned(view, tx):
        r = invokeCheckSession<T>(ctx)   // NotTEC: tesSUCCESS or a tef code
    else:
        r = T::checkSign(ctx)
    checkFirewall(ctx)                // still runs: the Firewall applies to Account whatever key signed
```

`invokeCheckSession<T>` applies these rules **in order**; every rejection is a `tef` (never included, no fee):

1. **Eligibility** → `tefSESSION_TX_NOT_ALLOWED`
   - always eligible: `SigningSessionDelete` without `Owner` whose `SessionKey` is the signer (own close);
   - mode P: same sequence as `Transactor::checkPermission` / `invokeCheckPermission<T>` with the session entry instead of the delegate entry: `checkTxPermission(sle, tx)`, then `getGranularPermission` + `Permission::checkGranularSandbox`, then `T::checkGranularSemantics`; the type must also not be in `kSessionExcluded` (checked at use). **Map every `terNO_DELEGATE_PERMISSION` or other `ter` answer to `tefSESSION_TX_NOT_ALLOWED`**: a retriable `ter` would keep a rejected tx in the node's retry loop;
   - mode A: the type is delegable and not in `kSessionExcluded`;
   - mode C: a `Payment` whose `Flags` carry nothing but `tfFullyCanonicalSig`, whose type-specific fields are only `Destination`, `DestinationTag`, `Amount`, with `Amount` in XRP. This is a **closed whitelist**: flags such as `tfSponsorCreatedAccount` lock reserves outside the cap; `SendMax`, `Paths`, `DeliverMin`, partial payments move value the cap does not see.
2. **`LastLedgerSequence` present and near** → `tefSESSION_TX_NOT_ALLOWED`: `LastLedgerSequence ≤ ledgerSeq + kSessionMaxLedgerWindow (256)`. A held-and-retried rejected tx must not land under a later session opened with the same key.
3. **Expiry** → `tefSESSION_EXPIRED`: `parentCloseTime < Expiration`, except for the own close.
4. **Fee ceiling** → `tefSESSION_LIMIT`, all modes, the own close included: `Fee ≤ calculateBaseFee(view, tx) + kSessionFeeMultiple × view.fees().base`. The first term keeps types whose required fee is the owner-reserve increment (AMM creation, `LedgerStateFix`) usable; the second bounds what a session can overpay on top of it, so a failed (`tec`) transaction cannot burn more than the required fee plus a small margin. `calculateBaseFee` returns an `Expected` whose error is a `TER`: convert it to `NotTEC` explicitly.
5. **Cap** → `tefSESSION_LIMIT`, mode C, every session-signed tx except the own close: `Fee + Amount ≤ SessionCap − SessionSpent` (`Amount` only for a `Payment`).

**Replacing `T::checkSign` also drops two checks of `Transactor::checkSign` that must be redone**: rejection of pseudo-accounts (`Transactor.cpp` ~962-972) and the unknown-key-type check (~1021). The cryptographic verification of the signature itself stays in `STTx::checkSign` / `checkValidity` (preflight). `LoanSet` and `Batch` override `checkSign` and are non-delegable today: case 9b asserts that no session-eligible type overrides `checkSign`.

### 6.6 Accounting (mode C)

One helper `chargeSession(result, fee)` inside `Transactor::operator()` (`Transactor.cpp`, ~line 1689):
- exactly **two call sites** in `operator()`: (1) just before the first `checkInvariants` (~line 1776), after the `canApply` / `processPersistentChanges` block whose `reset(fee)` (~line 1632) every `tec` traverses when `tapRETRY` is absent; (2) right after the second `reset(fee)` (~line 1782), before the `ProtocolOnly` re-check. Never inside `processPersistentChanges` (that would charge twice); line 1431 is only the definition of `reset`; a `reset` erases view state;
- adds `fee` to `SessionSpent` for every outcome that claims the fee, plus `Amount` on `tesSUCCESS`;
- the own close is exempt **by shape** (`SigningSessionDelete`, no `Owner`, `SessionKey` equals the signer) whatever its result, including a `tec` that leaves the session in place; tolerates a session entry that no longer exists;
- cannot live in `apply()`: a `tec` returned by `preclaim` (for example `tecNO_DST_INSUF_XRP` from `Payment`) never reaches `apply()`, and a `tec` result discards `doApply` changes. `preFeeBalance_` (Transactor.cpp:924) is the model for balance capture.

The predicate and the session keylet are computed at the **top** of `operator()`, before `apply()`, because after `doApply` an own close has already erased the entry.

### 6.7 Invariant `ValidSigningSession`

Add to the `InvariantChecks` tuple (`include/xrpl/tx/invariants/InvariantCheck.h`, ~line 522) so it also runs in the `ProtocolOnly` pass after a `reset`. `finalize` only sees the final view, so capture everything in `visitEntry`: session entries before/after, touched account roots, and touched signer-list, passkey-list, delegate, beneficiary and firewall entries. The signer is derived from `SigningPubKey`; the session counts as pre-existing if visited with a `before` state or not visited and still existing (sound because §6.3 forbids creating a session for the signer's own key).

1. Only `SigningSessionSet` creates and only `SigningSessionDelete` / `AccountDelete` remove a session; the owner count changes by exactly one.
2. `Account`, `SessionKey`, `Expiration`, `Permissions`, `SessionCap` and the mode flag never change; exactly one mode set; `Expiration` within `kMaxSessionDuration` of the parent close time at creation.
3. `SessionSpent` only increases, never above `SessionCap`, only in a session-signed transaction (the own close is exempt from rules 3 and 4 whatever its result).
4. For a mode-C session-signed tx that does not delete the session: XRP decrease of `Account` ≤ increase of `SessionSpent` (fee included); the owner count does not increase (consuming a ticket may lower it by one); the sponsoring count does not change. This ties the counter to the **real outflow**, not to declared fields.
5. A session-signed tx never modifies `RegularKey`, the master-disable flag, the signer list, the passkey list, the delegate entries, the beneficiary entry, the firewall entry, or another session of `Account`.

### 6.8 Exclusion list and enumeration test

`kSessionExcluded` (transaction types that grant or change authority although delegable): `PasskeyListSet` (delegable on alphanet; the real fix is `NotDelegable` at its definition), `SubscriptionSet`, `SponsorshipSet` (open-ended rights for a third party, not bounded by an amount fixed at signing). Instruments with a fixed visible amount and expiry (checks, escrows, channels, offers) are not excluded. Everything else follows XLS-75's `delegable` attribute; by default **a type is non-delegable** (`.delegable` absent), so `AccountSet`, `SetRegularKey`, `SignerListSet`, `AccountDelete`, `DelegateSet`, `Batch`, `FirewallSet`, `BeneficiarySet`, `WithdrawPreauth` and our two types are out of reach. Sensitive types that *are* delegable: `PasskeyListSet`, `SponsorshipSet`, `SubscriptionSet` (excluded), `DepositPreauth`, `Clawback`, `CredentialAccept` (decision for D4).

**Enumeration test (case 9b)**: iterate every transaction type and assert its expected eligibility in modes A and P. Adding a delegable type without an explicit decision fails the test, so the list cannot silently fail open.

Modes A and P bound **when** the key can sign, not what the signed transactions leave behind (an escrow, check, channel or offer outlives the session). Only mode C bounds XRP that leaves the account. The product says so.

### 6.9 Constants

| Constant | Value | Notes |
|---|---|---|
| `kMaxSessionDuration` | **600 s** | D2 |
| `kPermissionMaxSize` | 10 (existing) | same as `DelegateSet` |
| `kSessionFeeMultiple` | 1000 | multiple of the base fee unit (`view.fees().base`) allowed **on top of** the required base fee; the first escalated fee level is already 500× base, so under heavy load session txs are held back and the owner uses a full-authority key |
| `kSessionMaxLedgerWindow` | 256 | |
| `kSessionExcluded` | see §6.8 | |

Named constants live in one place per language (`include/xrpl/protocol/...` in C++; `packages/core/src/constants.ts` in TypeScript).

### 6.10 Where it plugs into rippled (verified paths at `68bd02b647`)

| Step | File | Model to copy |
|---|---|---|
| Amendment | `include/xrpl/protocol/detail/features.macro` | `Passkey`, `Beneficiary` |
| Fields | `.../detail/sfields.macro` (ACCOUNT max 33, AMOUNT 46, UINT32 113) | `sfBeneficiary`, `sfTimeLock` |
| Ledger entry | `.../detail/ledger_entries.macro` (highest is `ltTOKEN_ISSUANCE` `0x0099`) | `ltBENEFICIARY` |
| Transactions | `.../detail/transactions.macro` (`.delegable`, `.amendment`) | `ttPASSKEY_LIST_SET` (114) |
| Keylet | `include/xrpl/protocol/Indexes.h`, `src/libxrpl/protocol/Indexes.cpp`, namespace `'z'` | `keylet::delegate` |
| Transactors | `src/libxrpl/tx/transactors/` | `DelegateSet.cpp` (Permissions validation), `SetPasskeyList.cpp` |
| Session path | `src/libxrpl/tx/applySteps.cpp` `invokePreclaim`; `include/xrpl/tx/Transactor.h` | `invokeCheckPermission<T>` (Transactor.h ~336) |
| Accounting | `src/libxrpl/tx/Transactor.cpp` `operator()` | `preFeeBalance_` |
| Invariant | `include/xrpl/tx/invariants/InvariantCheck.h` | `ValidBeneficiary` |
| Account deletion | `AccountDelete.cpp` `nonObligationDeleter` | `ltDELEGATE` |
| Reserve / sponsorship | sponsor-aware helpers (`SponsorHelpers.cpp`): `isLedgerEntrySupportedBySponsorship` returns `false` by default and `isLedgerEntryOwner` is reached only after it, so declaring reserve sponsorship unsupported needs no entry; `SigningSessionSet` is already absent from `isReserveSponsorAllowed`. Add entries only if sponsorship is to be supported. **Decide in N2** | `DelegateSet.cpp` |
| RPC | `src/xrpld/rpc/handlers/ledger/LedgerEntry.cpp` | `parsePasskeyList` |
| Generated code | `cmake/codegen` → `protocol_autogen`, **only our types** (a previous attempt produced a 26 000-line diff, 21 000 of it unrelated regeneration) | |

**Registration to not forget**: `transResults` strings for the three `tef` codes (`src/libxrpl/protocol/TER.cpp`), the `jss` name `signing_session` and the RPC parser entry, `ltSIGNING_SESSION` in `ledger_entries.macro` with its keylet, and one shared header for `isSessionSigned` used by `applySteps`, `Transactor` and the invariant. `invokeCheckSession<T>(PreclaimContext const&)` returns **`NotTEC`** (never `tec`).

Recompiling after any `.macro` edit is heavy: make all macro edits (amendment, fields, entry, transactions, result codes) in the first batch, before the first full build.

### 6.11 Firewall, Beneficiary, Subscription

`Firewall`, `Beneficiary` and `Subscription` are `Supported::No` in `features.macro` at `68bd02b647`; the public AlphaNet announces them as supported because its compose commit carries `force_supported: ON`. jtx can enable them (`testableAmendments()` takes every registered amendment; the upstream `Firewall_test.cpp` already runs), so cases 6 (beneficiary key), 9 (`SubscriptionSet`) and 16 (Firewall) are written in jtx. Enabling a `Supported::No` feature through `[features]` on the standalone node is **UNVERIFIED**; the demo does not need them.

### 6.12 Standalone node (`infra/`)

- `infra/standalone.cfg` with `[features]`: `Passkey`, `Quantum`, `SigningSessions`, `BatchV1_1`, `PermissionDelegationV1_1` (check whether `fixBatchV1_2` is needed, **UNVERIFIED**). `feature` must list them; `server_definitions` must expose our types. Ports: a **public (non-admin)** WebSocket for the app and a separate **admin** port reserved for the ledger closer (`ledger_accept`); the app is never wired to the admin port.
- Ledger close: one process (a small `infra/closer.ts`) calls `ledger_accept` every 1-3 s. Session expiry is measured on the ledger's `parentCloseTime`: in standalone time only advances when a ledger closes.
- Genesis seed from an environment variable, never committed. Public (non-admin) WebSocket for the app.
- `infra/Dockerfile` for the node (published image is stretch).

### 6.13 Result-code matrix

| Situation | Code | Fee |
|---|---|---|
| Unknown flag bits | `temINVALID_FLAG` | no |
| No / two modes, key = account, bad duration, bad permissions, bad cap | `temMALFORMED` / `temBAD_EXPIRATION` / `temARRAY_*` / `temBAD_AMOUNT` | no |
| Key already has full authority | `tecNO_PERMISSION` | yes |
| Duplicate session | `tecDUPLICATE` | yes |
| Reserve | `tecINSUFFICIENT_RESERVE` | yes |
| Type or shape not allowed, missing / far `LastLedgerSequence`, session tx signed by a session | `tefSESSION_TX_NOT_ALLOWED` | no (not included) |
| After `Expiration` (except own close) | `tefSESSION_EXPIRED` | no |
| Fee over ceiling, or over remaining cap (mode C) | `tefSESSION_LIMIT` | no |
| Stranger closes a live session | `tecNO_PERMISSION` | yes |
| Missing session on close | `tecNO_ENTRY` | yes |
| Session key of another account | `tefBAD_AUTH` | no |
| Firewall blocks the destination | `tefFIREWALL_BLOCK` | no |
| Amendment disabled | `temDISABLED` | no |
| Accepted tx ending in `tec` | the `tec` | **yes**, counted in the cap in mode C |

`tem` is stateless only (a state-dependent "expiration too far" is `tec`/`tef`, not `tem`).

### 6.14 Passkey path and key formats

**Passkey in alphanet** (`featurePasskey`, Denis Angell): P-256 public key = 65 bytes `0xF6 ‖ X ‖ Y` (`PublicKey.cpp:252`); `ltPASSKEY_LIST` (one per account); `PasskeyListSet` (114 on XRPLF, 118 on Transia); `PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}` is a common **unsigned** field; the WebAuthn `challenge` is base64url of **all signed data** (`STTx.cpp:449-499`); raw ECDSA over SHA-256 of the signed data is also accepted (SHA-256 + DER, **no low-S rule**); a passkey has **full authority** (`Transactor.cpp` ~1141-1160). On XRPLF `KeyType` values are `Dilithium = 2`, `P256 = 3` (reversed on Transia): never hard-code the enum. The WebAuthn path is taken only when the key is P-256 **and** `PasskeySignature` is present; otherwise raw P-256 `verify()`. No upstream test signs a transaction by WebAuthn.

**P5 (suspected defect, UNVERIFIED by a test)**: in `STTx.cpp` ~478-480 the challenge check compares `base64urlDecode(...)` (a `std::string`) to `uint8_t` signing data with `std::equal`; where `char` is signed (x86-64, macOS arm64) any byte ≥ `0x80` makes the comparison fail, and every challenge contains `0xF6` (the `SigningPubKey` prefix). So WebAuthn assertions may always fail on those platforms. **Plan (N1)**: write the regression test first (challenge containing a byte ≥ `0x80`) on our own node; if it fails before any change, fix by comparing two `Slice`s in a **separate `fix:` commit**; if it passes, record that in DEVLOG. Either way P5 goes in the presentation (D7). K2 on the public AlphaNet may fail depending on the validators' platform; that does not prove passkeys do not work.

**Key and signature formats**

| Key | Public key | Signature |
|---|---|---|
| Session key (P-256, WebCrypto non-extractible) | 65 bytes `0xF6 ‖ X ‖ Y`; `SessionKey` = `RIPEMD160(SHA256(pubkey))` | ECDSA-SHA256 over `encodeForSigning(tx)` (prefix `STX\0`), WebCrypto `r‖s` → **low-S** → **strict DER** → `TxnSignature` |
| Passkey | same 65-byte format; `SigningPubKey` = passkey key | `navigator.credentials.get` with `challenge` = signed data; also **normalize `PasskeySignature.Signature` to low-S, strict DER** (not in the signed data, and the node accepts high-S today) |
| ML-DSA-44 | **1 312 bytes, no prefix** | 2 420 bytes; **pure** ML-DSA, empty context, randomized; the node runs `crypto_sign_verify(sig, m = full signing data, ctx empty)`, i.e. `M' = 0x00 ‖ 0x00 ‖ M`. Account derivation from an XRPL seed is non-standard (no `k ‖ l` domain): irrelevant, the device generates the key |
| secp256k1 / Ed25519 | standard | standard |

`Quantum` / ML-DSA keys need no amendment gating (the symbol `featureQuantum` is referenced nowhere in code). `ForceQuantum` does not exist on alphanet and was withdrawn by its author; we do not build it.

### 6.15 Test plan (jtx suite `SigningSessions`, `src/test/app/SigningSessions_test.cpp`, plus invariant tests)

TDD: every task starts with the failing test. Assertions name the exact result code where a case is about a code.

| # | Case |
|---|---|
| 1 | Each mode opens; reserve +1; entry in owner directory; `Expiration = parentCloseTime + SessionDuration`; `SessionSpent = 0` in mode C |
| 2 | None or two of {`Permissions`, `tfAllTransactions`, `SessionCap`}: `temMALFORMED` |
| 3 | `SessionKey` = `Account`: `temMALFORMED`; = `RegularKey` or a passkey: `tecNO_PERMISSION`; duplicate: `tecDUPLICATE` |
| 4 | Duration 0 and `kMax + 1`: `temBAD_EXPIRATION`; boundaries 1 and `kMax` open |
| 5 | `Permissions`: `AccountSet`, `SetRegularKey`, `SignerListSet`, `DelegateSet`, `Batch`, `PasskeyListSet`, the two session types, a non-delegable type, a duplicate, 11 values: rejected with §6.3 codes; a granular permission accepted |
| 6 | `SigningSessionSet` signed by a session key: `tefSESSION_TX_NOT_ALLOWED`; with `Delegate`: `temINVALID` in preflight (non-delegable type); `SessionKey` = beneficiary key: `tecNO_PERMISSION` |
| 7 | Amendment disabled: `temDISABLED` for both |
| 8 | Mode P: listed type succeeds; unlisted `tefSESSION_TX_NOT_ALLOWED`; a granular permission respects its sandbox **and** semantics (`PaymentMint` cannot pay XRP or a third-party IOU; `TrustlineFreeze` cannot create a line) |
| 9 / 9b | Mode A: any delegable type succeeds; each excluded type rejected; enumeration of all types in modes A and P |
| 10 | Expiry, written relative to the `parentCloseTime` actually read after each ledger close: just before `Expiration` `tesSUCCESS`, at it `tefSESSION_EXPIRED`; the session key can still close the expired session |
| 11 | Mode C: `Amount + Fee` = remaining cap succeeds; one drop more `tefSESSION_LIMIT`; `SessionSpent` after success = amount + fee; after `tecNO_DST_INSUF_XRP` = fee only |
| 12 | Mode C forbidden shapes (IOU, `SendMax`, `Paths`, `DeliverMin`, `tfPartialPayment`, **`tfSponsorCreatedAccount`**, `InvoiceID`, any other field, any other type): `tefSESSION_TX_NOT_ALLOWED` |
| 13 | **Fee drain**: session-signed `SigningSessionDelete` for another key / a missing session rejected with no fee; a loop of rejects leaves the balance unchanged; `Fee` above `calculateBaseFee × 1000` is `tefSESSION_LIMIT` in every mode; in mode C a `Fee` above the remaining cap too; a mode-P session limited to `TicketCreate` cannot burn the balance; `AMMCreate` and `LedgerStateFix` in mode A pass the ceiling; a mode-C payment using `TicketSequence` applies and does not trip the owner-count invariant |
| 14 | A session key with `Signers`, `Delegate`, `Sponsor`, as a `CounterpartySignature`, or as a Batch inner signer: never session-authorized (falls to the ordinary signature check: `tefBAD_AUTH`) |
| 15 | One account's session key signing for another account: `tefBAD_AUTH` |
| 16 | Firewall (enabled explicitly in jtx): blocked destination `tefFIREWALL_BLOCK` |
| 17 / 17b | Session key later set as `RegularKey`: stays bounded (`SetRegularKey` signed by it `tefSESSION_TX_NOT_ALLOWED`), full authority after deletion; missing or far `LastLedgerSequence`: `tefSESSION_TX_NOT_ALLOWED`; sponsored tx / Batch inner signature by a key that is both follow existing rules (documented limitation) |
| 18 | Owner closes; session key closes (also after expiry, and in mode C with remaining cap < `Fee`: exempt from cap but not from the fee ceiling); stranger closes live: `tecNO_PERMISSION`; stranger closes expired: `tesSUCCESS`; missing: `tecNO_ENTRY`; `Owner == Account`: `temMALFORMED` |
| 19 | `AccountDelete` with sessions present deletes them |
| 20 | Session key types: P-256 (raw, low-S, strict DER), Ed25519, secp256k1, ML-DSA-44 |
| 21 | Invariants: each rule of §6.7 has a test that mutates the view to violate it and expects the invariant failure result of the pass (`tecINVARIANT_FAILED`; `tefINVARIANT_FAILED` when the reset pass fails too), modelled on `InvariantsBeneficiary_test` |
| 22 | TxQ: a queued session-signed payment whose session expires or is deleted is dropped |
| 23 | Accounting paths: `tecNO_DST_INSUF_XRP` (from preclaim), a `tec` from `doApply`, and the `tecINVARIANT_FAILED` reset path each leave `SessionSpent` equal to the fee (or fee + amount on success), invariant satisfied |
| 24 | `ledger_entry` (by account+key and by index) and `account_objects`; sponsorship decision (§6.10) taken in N2; `nonObligationDeleter` entry; pseudo-accounts rejected |

Upstream suites `Delegate`, `PasskeyListSet`, `AccountDelete`, `PassKey` green before and after, without any test removed. A moved delegable-type counter is re-pinned with justification in the commit (the Transia base already fails it: 73 vs 67 expected).

---

## 7. Ledger application

### 7.1 Facts about the base and the device (24 Oct)

- `app-xrp` @ `7b5185ff` (v2.8.2): `ledger_app.toml` `devices = ["nanox", "nanos+", "stax", "flex", "apex_p"]`; UI is **NBGL only** (`src/ui/*/..._nbgl.c`, `nbgl_useCaseReview`, a `getPair` callback fed from `parseResult_t`, 8 display buffers); `ENABLE_SWAP`, `HAVE_IO_U2F`, `ENABLE_BLUETOOTH`; `CURVE_APP_LOAD_PARAMS = secp256k1 ed25519`; `PATH_APP_LOAD_PARAMS = "44'/144'"`; no `PATH_SLIP21_APP_LOAD_PARAMS`.
- Limits (`src/limitations.h`): `MAX_BIP32_PATH 10`, `MAX_ARRAY_LEN 8`, `MAX_PATH_COUNT 6`, `MAX_STEP_COUNT 8`, `MAX_FIELD_COUNT 60`, `MAX_RAW_TX 10000`, `MAX_FIELD_LEN 1024` (128 on Nano S only).
- APDUs (`src/apdu/constants.h`): `CLA 0xE0`; `INS_GET_PUBLIC_KEY 0x02`, `INS_SIGN 0x04`, `INS_GET_APP_CONFIGURATION 0x06`; `P1_CONFIRM 0x01`, `P1_NON_CONFIRM 0x00`, `P1_MASK_ORDER 0x01`, `P1_MASK_MORE 0x80`; `P2_SECP256K1 0x40`, `P2_ED25519 0x80`; `P2_NO_CHAINCODE 0x00`, `P2_CHAINCODE 0x01`. `handle_apdu` resets the transaction context when the INS changes.
- The app buffers the entire transaction (`raw_tx[10000]`) before parsing, so any signing scheme can sign the whole buffered blob.
- `master` is hardened by Ledger (August-September fixes V-074, V-060, DONJON-1407, ~15). A `Batch` goes to **blind signing**; there is no clear signing for `Batch` upstream and no `BatchSigner` (`BCH\0`) signature. Never base on `develop` (stale).
- ML-DSA is in `ledger-secure-sdk` (PR #1617 merged 2026-07-02; `API_LEVEL_26`+; image SDK v27.1.3): `lib_cxng/include/lcx_mldsa.h` (levels 44, 65 and 87 behind `HAVE_MLDSA_87`), software implementation (`cx_mldsa*.c`) with a low-RAM variant (`cx_mldsa_lowram.c`, `HAVE_MLDSA_OPTIMIZATION`), v1 without side-channel countermeasures. Public API: `MLDSA_keygen` (random only), `MLDSA_sign` (pure, with context), verify and prehash variants. **Deterministic key generation from a seed exists only as the internal `MLDSA_internal_keygen`** (`lib_cxng/src/cx_mldsa_internal.h`, "from a seed (deterministic)", an internal header). Precedent: `cyyber/ledger-app-zond` (ML-DSA-87 on nanos+, stax, flex).
- Device: Stax fw 1.11 = `API_LEVEL` 27 (≥ 26, matches SDK v27.1.3); SRAM 36 KB including the stack; the app's statics are ≈ 21 KB (`raw_tx` 10 000 B, 8 field strings × 1 024 B, parser result).

### 7.2 L0: baseline (MVP)

Import `master`, build in the builder image for `stax`, load on the device (route chosen per §5.2), sign a `Payment` on testnet, and, with a small amount, one on mainnet. Acceptance: validated tx hash; device model (Stax) and firmware (1.11) recorded; loading route recorded.

### 7.3 L1: clear signing of `SigningSessionSet` / `SigningSessionDelete` (MVP)

Every place below needs an entry, otherwise the app falls back to blind signing, shows "Unknown", or **clear-signs something it should not**:

| # | Place | Change |
|---|---|---|
| a | `src/xrp/transaction_types.h` | add 130 and 131 |
| b | `is_supported_transaction_type` | accept them |
| c | `resolve_transaction_name` | names "Open session" / "Close session" (otherwise "Unknown") |
| d | `src/xrp/fields.c` | ACCOUNT 34, AMOUNT 47, UINT32 114, UINT32 52 (`PermissionValue`); an unrecognized field forces blind |
| e | `src/xrp/flags.c` | an entry per type in **both** `format_flags` and `has_unknown_flags` (otherwise unknown flag bits are clear-signed: `default: return false`) |
| f | formatters | duration ("N s" is all the app can do for Settle Delay: write "N minutes"), generated permission-name table, synthetic note line |
| g | `src/limitations.h` | `MAX_ARRAY_LEN` from 8 to **≥ 10** (`Permissions` can hold 10); test at 10 |
| h2 | `flags.c` / synthetic row | `has_unknown_flags` needs an explicit `case` for 130 and 131 even with no known flag (the default returns `false`); the synthetic "Note" row must carry a name `is_field_recognized` accepts, otherwise the final loop forces blind signing |
| h | parser final pass | an unknown permission value is never shown as known: `BLIND_SIGN_REQUIRED` (blind signing is off by default; the user sees "cannot be clear-signed"), decided in the **final pass**, not in `post_process_field` (an early return leaves a truncated field list in the blind review) |
| i | NBGL texts (optional) | per-type title/finish: "Open signing session" / "Open session?" instead of "Review transaction" / "Sign transaction?" |

Rules: `SigningPubKey` is already hidden unconditionally upstream; `Fee` stays **visible** (add a `Fee` line to the frozen screen) and `TxnSignature` must be absent; **everything displayed comes from the same parse as what is signed**; the permission-name table is **generated** from `Permissions.cpp` / `server_definitions` (value = type + 1, or ≥ 65 537 for a granular permission); arrays and objects are hidden, only `PermissionValue` needs a name.

**Screen lines to freeze (Sat 14:00)** — a list of lines, labels and formatters, not a mockup:

```text
Transaction type   Open session           (name of type 130)
Account            rAlice…                (full address)
Session key        rSess…                 (full address)
Valid for          10 minutes             (duration formatter)
Fee                12 drops               (as for every transaction)
Allows             All transactions       (mode A, flag formatter)
                   Payment, OfferCreate   (mode P, one line per permission)
Max spend          20 XRP                 (mode C)
Note               Cannot change keys, signers or the account   (synthetic line; precedent in the parser)
```

**Tests**: cmocka with ≥ 10 vectors (one per mode, 10 permissions, unknown permission → blind required, unknown flag, truncated, duplicate), distinct values per field (not the same account everywhere), fuzzing without crash; Ragger snapshots generated for **all devices the CI lists**; **one session opened on the node and signed on the Stax** (acceptance).
**Multisign / Batch**: a `Batch` signed in multisign mode (`SMT\0`) gives an invalid signature; test with a real Batch vector when L3 is attempted.

### 7.4 Stretch items

**L2: ML-DSA-44 on the device.** `MLDSA_sign` (pure, empty context) over `STX\0 ‖ signed fields`, fully buffered; key derived deterministically from an app-scoped **SLIP-21** seed through `MLDSA_internal_keygen` (internal API: validated in spike K4) — **never** reuse a BIP32 secp256k1 private key as ML-DSA seed. New INS or P2 value (the P2 byte accepts only `0x40` / `0x80` today); public key 1 312 B in ~6 APDUs, signature 2 420 B in ~10 responses; signature buffer **outside `tmp_ctx`** (zeroed on each command); remove the `LEDGER_ASSERT` that would crash the app if signing fails. Makefile: add `PATH_SLIP21_APP_LOAD_PARAMS` (syntax: `PATH_SLIP21_APP_LOAD_PARAMS = "<label>"`, a single path; see `Makefile.app_params` of the SDK), the `lib_cxng` ML-DSA sources, `HAVE_MLDSA_OPTIMIZATION`, `INCLUDES_PATH` to `lib_cxng/src` (model: `ledger-app-zond`'s Makefile, which signs a 32-byte hash with an 8-byte context, unlike us). If the key cannot be derived from the seed, **say so**: it would be stored in NVRAM and not recoverable with the 24 words. Acceptance: a device signature accepted by `xrpld` **and** verified by `@noble/post-quantum`.
**Memory** (Stax 36 KB, stack included): statics ≈ 21 KB; ML-DSA-44 signing ≈ 7.2 KB working set with `HAVE_MLDSA_OPTIMIZATION` (11.7 KB without), plus secret key 2 560 B and signature 2 420 B ≈ 12 KB peak. K4 must run **inside an app-xrp build**, not a throwaway app. Levers if it overflows (to measure): drop `ENABLE_SWAP`, `HAVE_IO_U2F` and the BLE stack in a test build, reduce `MAX_FIELD_LEN` / `MAX_RAW_TX`, overlay `sk` and the signature on the display-string buffers.

**L6: a P-256 key on the device usable as a passkey** (idea to validate on the device). Add `secp256r1` to `CURVE_APP_LOAD_PARAMS` and a new P2 value (proposed `0x20`; **UNVERIFIED**); sign `SHA-256(signed data)`, return DER, **normalize to low-S**; public key `0xF6 ‖ X ‖ Y`. The node already accepts a raw P-256 signature (no `PasskeySignature`) then looks the key up in the `PasskeyList`, so no node change is needed. The device key and the Face ID key must be in the **same first** `PasskeyListSet` of the account (a second `PasskeyListSet` on the same account is not supported by this build). Alternative with no Ledger code: the **Ledger Security Key** FIDO2 app as a WebAuthn authenticator (Stax and Flex), which is **blind** (shows the domain only) and depends on P5. Acceptance: a transaction signed on the device by a key listed in the `PasskeyList` is accepted.

**L3: `Batch` clear signing.** `master` forces blind on a nested type and follows one array level; 8 inner transactions of ~10 fields exceed `MAX_FIELD_COUNT` (60). **L4**: documentation feedback is **MVP** and specified in [§7.6](#76-documentation-and-developer-experience-feedback); a `packages/ledger` library on the DMK (`previewSession`, clear / blind / refuse prediction) is stretch. **L5**: `BatchSigner` co-signature (`BCH\0`).

### 7.5 Open device questions (to answer in L0)

Loading route on this Stax; whether the device shows an "unsafe app" prompt or needs a developer mode; behaviour of the genuine check in Ledger Live (the loading routes do not depend on Ledger Live); how the 10 permission lines paginate on the Stax screen.

### 7.6 Documentation and developer-experience feedback

The Ledger bounty judging slide (shown at the Ledger workshop on 24 Oct) is explicit: **"We judge the Developer Experience feedback as much as the code. Help us improve our docs."** It asks for three things, and lists three bonus items. We treat all of it as a deliverable with the same standing as L1, not as an afterthought written on Sunday morning.

| Asked ("What to include") | What we deliver |
|---|---|
| Feedback on the overall experience using Ledger docs and SDKs | One overall section per area we touch: app-xrp and the C SDK (build, `ledger-app-builder`, loading on a Stax), clear signing for a new transaction type, ML-DSA in `ledger-secure-sdk`, the Device Management Kit and `device-signer-kit-xrp`, the XRPL workshop and `developers.ledger.com/xrplnyc` |
| Gaps, confusing flows, or missing context | Each finding is an entry in the log with the page or file, what we expected, what happened, and the time it cost us |
| Specific improvements with screenshots or PRs | Every entry carries a screenshot or a proposed text; where we can, a **pull request** to the documentation or sample repository (the DMK docs live in `LedgerHQ/device-sdk-ts`, `apps/docs`; the SDK and app templates in their own repositories) |

| Bonus point | Our plan |
|---|---|
| Better tutorial or code sample ideas | A written tutorial outline "clear-sign a new XRPL transaction type on a Ledger app" built from what L1 actually required (the checklist of §7.3 is already that tutorial in embryo), and a minimal sample for sending a custom transaction through the DMK |
| Navigation or search improvements for the portal | Record, as we search for things, what we typed, what we expected to find, and where it was (or was not) |
| "Time-saver" suggestions for future integrators | A short list at the top of the document: "if we had known this at hour 0, we would have saved N minutes" (loading an app on a Stax from a Mac, the `STX\0` prefix added by the app, `MAX_ARRAY_LEN`, `has_unknown_flags`, deterministic ML-DSA keygen, SLIP-21 install parameter) |

**Method.**
1. **Start the log at kickoff**, in `docs/ledger-dx-feedback.md`, and append during the work, not afterwards: a finding forgotten at 03:00 is lost. One line is enough at the time; it is cleaned up later.
2. Entry template: `date/time · area · doc page or repo path · what we tried · what happened or was missing · minutes lost · suggested fix · screenshot / PR link`.
3. Keep `minutes lost` honest: it is the evidence that makes feedback useful, and it must not be inflated.
4. Capture screenshots as we hit the problem (the Stax screen showing "cannot be clear-signed", the build error, the page that did not help).
5. Turn the best findings into pull requests while the details are fresh; link them from the document. A PR is stronger than a paragraph.
6. Final structure of `docs/ledger-dx-feedback.md`: top "time-savers"; overall experience per area; gaps and confusing flows (the log, cleaned); proposed tutorial and sample ideas; portal navigation and search notes; list of PRs and screenshots.
7. The README links to the document, and the pitch has a slide with the three best findings and the PR links (§11).

**Things we already know are likely to appear** (to confirm while doing them, not to pre-write): loading a custom app on a Stax from macOS when the builder image cannot reach USB; the README of `ledgerctl` not listing the Stax; which of the three loading routes works; clear signing for a transaction type the app does not know (the L1 checklist spans parser, fields, flags and display limits, and a miss falls back to blind signing without an error); `MAX_ARRAY_LEN`; the app adding the signing prefix itself; ML-DSA deterministic key generation existing only behind an internal header; the SLIP-21 install parameter; the DMK send-APDU API for custom commands.

---

## 8. Client

### 8.1 Stack

See §5.1. No `as any`; named constants; Node code uses `import xrpl from "xrpl"` (named CJS imports are unreliable). `xrpl.js` `validate()` refuses our transaction types: use the low-level encoder with `XrplDefinitions` built from `server_definitions` and fill `Sequence`, `Fee`, `LastLedgerSequence` by hand. Refuse a `server_definitions` answer that only carries `hash`.

### 8.2 `packages/core`

| Module | Responsibility |
|---|---|
| `constants.ts` | `kMaxSessionDuration`, `kSessionFeeMultiple`, `kSessionMaxLedgerWindow`, `kPermissionMaxSize`, UI durations, `LastLedgerSequence` offset (≈ +150), no inline numbers elsewhere |
| `definitions.ts` | `loadDefinitions(rpc)` → `XrplDefinitions`; asserts our codes exist |
| `encode.ts` | `encodeForSigning(tx, defs)` (prefix `STX\0`), `encodeTx` |
| `der.ts` | `rawToDer`, **low-S normalization**, strict DER |
| `keys/p256-session.ts` | `createSessionKey()` WebCrypto non-extractible (IndexedDB), public key `0xF6‖X‖Y`, account id, `sign(bytes)` |
| `keys/passkey.ts` | `createPasskey`, `getAssertion(challenge)`, build `PasskeySignature`, normalize its signature |
| `keys/mldsa.ts` | verify and (software) sign with `@noble/post-quantum` 0.7.1 for cross-checks and the stretch fallback |
| `session.ts` | `buildSessionSet({account, mode, durationSec, permissions?, capDrops?, sessionKey})`, `buildSessionDelete(...)`, always sets `LastLedgerSequence` |
| `node.ts` | JSON-RPC / WebSocket client (non-admin), `submit`, `account_info`, `ledger_entry` `signing_session`; surfaces the node's exact result code |
| `errors.ts` | decoded `tef` / `tec` / `tem` with the node's code string, never a simulated message; knows the three new `tefSESSION_*` codes (UI text + the rule that produced them) |

A single command runs the whole flow against a real node (acceptance of W1).

### 8.3 Signing details

- Session key: `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign'])`, signing with `{name:'ECDSA', hash:'SHA-256'}`; the raw public key export starts with `0x04`, replace it by `0xF6`; signature `r‖s` (P1363) → DER, **low-S**; `TxnSignature` = DER hex.
- Every session transaction carries `LastLedgerSequence` ≈ +150 ledgers (with 1-second ledgers +20 is 20 s: too short for a device prompt, `tefMAX_LEDGER`). A queued-on-server design is avoided: state comes from `account_info`, and the same tx is resent until its `LastLedgerSequence` passes. Identify transactions by `(Account, Sequence)`, not by hash, while P-256 malleability exists.
- **A fresh key per session**: the 256-ledger window can exceed the 600 s lifetime, so a held transaction signed for one session could otherwise land under a later session opened with the same key.
- Expiration is the only stop: **no heartbeat or auto-revoke** that closes a session after 90 s of silence (sleep, suspended tab).

### 8.4 Ledger integration (DMK)

- Transport WebHID. `device-signer-kit-xrp` 0.3.0 is used for public key retrieval and for signing: spike K6 signs a `Payment` testnet on the unmodified app, then a `SigningSessionSet` once L1 exists (raw bytes are forwarded, so no custom APDU is needed for W3). Only the stretch items L2 and L6 add new INS/P2 values, sent as **custom APDUs** with the DMK (`dmk.sendApdu({ sessionId, apdu })` / `dmk.sendCommand({ sessionId, command })` per the DMK 1.11 typings; confirm in K6).
- The kit names the app "XRP": use `skipOpenApp` if the sideloaded app is renamed.
- Open flow (W3): build `SigningSessionSet` → serialize with `encode(tx)` (`SigningPubKey` set to the device key, no `TxnSignature`, **no `STX\0` prefix**: app-xrp prepends `STX\0` / `SMT\0` itself, `sign_transaction.c`) → the kit forwards the bytes and chunks them to the device → the Stax shows the rules → the user approves → signature returned → assemble and submit. The signer is the account's own **full-authority key** (master or `RegularKey`): this is an ordinary single signature, **not a multisig** and no signer list is involved.
- No admin key in the browser, ever, not even for the demo: it is on the Ledger.

### 8.5 `apps/web`

| Screen | Content |
|---|---|
| **Account** | the three demo profiles (Face: master + passkey; Ledger: device key; PQ: `RegularKey` = ML-DSA-44 of the device + `asfDisableMaster`, **no passkey**), passkey creation, `PasskeyListSet`, state |
| **Session** | mode (A / P / C), duration (10 min), permissions or cap; **Open** (passkey or Ledger); countdown; spent / cap bar; Close |
| **Actions** | 5-6 ready actions of different types (payment, `OfferCreate`, `TrustSet`, `TicketCreate`, mint, …) signed by the session key, with the node's result code |
| **Attack** | replays with the session key: `SetRegularKey`, `PasskeyListSet`, `AccountSet`, `SigningSessionSet`, cap overflow, after expiry; each refusal is **the node's code**, never a client-side message |

Principles: account state comes from the node, not local state; errors show the code and one sentence; public (non-admin) WebSocket; CSP `script-src 'self'`. Face ID needs an HTTPS origin and `wss://`; Touch ID on the Mac works on `localhost`. Decide which one the demo uses before Saturday; the script says "passkey" and chooses at the last moment.

**PQ-account note**: a passkey list cannot be updated or deleted in this alphanet build, so an account that ever had a passkey cannot become post-quantum. The PQ demo account is a **fresh account**.

### 8.6 Client tests

Vitest unit tests for `core` (encoding vectors, low-S/DER, session builders, constants), an end-to-end `tsx` test against a real standalone node (stretch W8), and a test that every session transaction carries a `LastLedgerSequence`.

---

## 9. Spikes (K1-K6)

Run against the public AlphaNet (`Passkey` and `Quantum` enabled) **with a new account per attempt**. Never send a second `PasskeyListSet` to the same account. Always sign on the client (never through the node's `sign` RPC with a P-256 key).

| Spike | Question | Outcome |
|---|---|---|
| **K1** | Does a WebCrypto P-256 key set as `RegularKey` sign a `Payment` (raw, low-S, strict DER)? | `tesSUCCESS` → P-256 session key; otherwise Ed25519 WebCrypto |
| **K2** | Is a passkey assertion (Touch ID on the Mac, Face ID on the iPhone) accepted? | Likely **not** (P5) on validators with signed `char`; note the result without concluding more |
| **K3** | Is a `Payment` signed with ML-DSA-44 (`@noble/post-quantum`, 1 312-byte key, ML-DSA `RegularKey`) accepted? | Format understood, or exact error recorded |
| **K4** | The Ledger **inside an app-xrp build**: `MLDSA_internal_keygen` level 44 from a SLIP-21 seed, then `MLDSA_sign` over 4 KB; RAM, stack, time (Stax 36 KB) | **Go / no-go for L2** |
| **K5** | `server_definitions` of the pinned XRPLF branch: `XrplDefinitions` + encode round-trip; codes still free | the codes of §6.1 hold on the imported SHA |
| **K6** | Chrome: `device-signer-kit-xrp` + WebHID sign a testnet `Payment` on the **unmodified** app | the host path works (the kit sets P2 per curve, secp256k1 or ed25519), or we know what to write |

---

## 10. Work breakdown

Two tracks; **who does what is not decided (D5)**. Durations are not estimated here: the team judges order and pace on site. Gates are the only fixed points.

### 10.1 Protocol track (`rippled/`)

| # | Task | Acceptance | MVP |
|---|---|---|---|
| N0 | Baseline: branch from the import, run the existing suites | base failures written in DEVLOG, no test touched | ✓ |
| N1 | **P5 test first**; fix in a separate commit only if it fails | a challenge ≥ `0x80` fails before and passes after, or passes as is (noted) | ✓ |
| N2 | Amendment (`Supported::Yes`), fields, entry, keylet `'z'`, tx 130/131, codegen limited to our types, result-code strings, `ledger_entry`, `AccountDelete` and sponsorship-table decisions, minimal transactors, `checkExtraFeatures` on `PermissionDelegationV1_1` | open in modes A and C (1); amendment off → `temDISABLED` (7) | ✓ |
| N3 | `SigningSessionSet` validation | all preflight and preclaim codes (2, 3, 4, 5, 6) | ✓ |
| N4 | **Session path, mode A**: `isSessionSigned`, `invokeCheckSession<T>` before `T::checkSign`, `LastLedgerSequence` rule, fee ceiling, enumeration test, P-256 session key | cases 6, 9, 9b, 10, 13 (ceiling), 14, 15, 17, 17b, 20 (P-256) green with the exact `tefSESSION_*`; "key can still close its session" waits for N7 | ✓ |
| N4b | **Mode P** via XLS-75 engine **and** `T::checkGranularSemantics`; 9b extended | case 8 | ✓ (last mode to land) |
| N5 | **Mode C**: closed whitelist, pre-check `Fee + Amount ≤ remaining`, `chargeSession` before the first invariant check and after any `reset` | cases 11, 12, 13 (remaining cap), 23 green; the anti-drain loop passes | ✓ |
| N6 | Invariant `ValidSigningSession` | one test per rule on a mutated view (21) | ✓ |
| N7 | `SigningSessionDelete`: owner, session key (cap exempt, fee ceiling kept), third party after expiry | cases 18, 19 | ✓ |
| N8 | Cross-cutting: key types (Ed25519, secp256k1, ML-DSA), TxQ, Firewall (explicit), RPC | cases 16, 20, 22, 24 | stretch |
| N9 | Standalone config + ledger closer; `[features]` | node starts; `feature` lists the five; `server_definitions` exposes the types | ✓ |
| N10 | Final XLS from the implementation (`docs/XLS-Sessions.md`) | consistent with the code | stretch |

### 10.2 Ledger track (`ledger-app/`)

L0 (MVP), L1 (MVP), L4 documentation feedback (MVP, [§7.6](#76-documentation-and-developer-experience-feedback), log kept from the first minute), then stretch L2, L3, L4 library, L5, L6 as in §7. Gate: L1 on the device with a session opened on the node.

### 10.3 Client track

| # | Task | Acceptance | MVP |
|---|---|---|---|
| W1 | `packages/core` (§8.2) | unit tests; one command runs the flow on a real node | ✓ |
| W2 | Open by **passkey** (`PasskeyListSet`, `PasskeySignature`) | session open on the node; depends on N1 outcome | ✓ |
| W3 | Open from the **Ledger** (kit 0.3.0 as is; custom APDUs only for L2 / L6) | session opened with the rules read on the screen; depends on L1 | ✓ |
| W4 | Account, Session, Actions screens | 5 transaction types signed by the session key with no prompt | ✓ |
| W5 | Attack screen | each refusal is the node's code | ✓ |
| W6 | Mode C in the app: spent / cap bar | 6th payment refused `tefSESSION_LIMIT` | ✓ |
| W7 | PQ account end to end | `SetRegularKey` ML-DSA then `asfDisableMaster`, signed **by the master** in that order, then a session opened by an ML-DSA signature of the device | stretch |
| W8 | End-to-end `tsx` test and local CI | everything passes in one command | stretch |

### 10.4 Delivery (everyone)

The documentation feedback document (`docs/ledger-dx-feedback.md`, §7.6) and its pull requests. Working demo that can be run ("a working demo we can run, not a slide deck": Ledger page), demo video **and** pitch video, PDF deck, public repository, honest README, `pnpm demo`. Pitches at 14:15 on Sunday in parallel with sponsor pitches; exact format to confirm on site, prepare 3 minutes.

### 10.5 Schedule anchors (New York time)

| When | What |
|---|---|
| Sat 24 Oct 10:00 | Kickoff: first 20 minutes = repository, imports, `UPSTREAM.md` (§4); K5; N0; L0 |
| Sat 12:30-14:00 | Team formation, lunch; **14:00 gate: format frozen internally** (fields, codes, screen lines) |
| Sat 16:00-17:00 | Office hours: show the design to Denis; ask D3; bring D4 |
| Sat 22:00 | Checkpoint: status of mode C (N5) and of L1 on the device; whatever is not green is said so in the README |
| Sat 22:30 - Sun 08:30 | Overnight coding; sleep in shifts, agreed in advance |
| Sun 08:00 | **Feature freeze** (no new feature after) |
| Sun 10:00-11:00 | Office hours |
| Sun 12:00 | Target submission (limit 13:00; window "Final Project Submission" 12:30-13:00) |
| Sun 14:15 | Pitches |

---

## 11. Demo and presentation

| Time | Content |
|---|---|
| 0:00-0:20 | The problem: on XRPL a key has all the authority or none |
| 0:20-1:30 | **Live, session opened from the Ledger**: the Stax shows the rules; 5 actions of different types with no prompt (mode A, 60 s so expiry can be shown); the "stolen" key tries `SetRegularKey` and `PasskeyListSet` → node refusals; after 60 s `tefSESSION_EXPIRED` |
| 1:30-2:10 | **Mode C, the agent**: a 20 XRP cap, payments sized so that, fees included, exactly the 6th exceeds it (for example 3.9 XRP each), the 6th refused by the ledger; then the **Face** account with a passkey; then the **PQ** account: session opened by an ML-DSA-44 signature made on the device (if delivered) |
| 2:10-2:30 | Honesty slide: before 24 Oct a spec and **a full prototype that is not reused**; during the hackathon all submitted code, commit ranges; **passkey defects found (P1, P3, P5)** (D7) |
| 2:30-2:45 | **Ledger developer-experience feedback**: the three best findings, the time they cost, the PR links (§7.6) |
| 2:45-3:00 | Potential: embedded wallets, agents, games and micro-payments, custody; the Foundation's pipeline (XLS, implementation, signing devices) |

Rehearse three times on a real passkey and the real Stax. Figures in the pitch are the README's figures (tests, durations, types); nothing rounded in our favour. Demo script mentions that modes A and P do not bound what signed transactions leave behind.

---

## 12. Security model

| Threat | Effect | Defence |
|---|---|---|
| Session key copied | — | WebCrypto non-extractible |
| Session key used by script of the page (XSS) | signs what the session permits | ledger-side bounds, CSP `script-src 'self'`, short duration |
| Mode A opened by mistake | everything except account control, 10 minutes | Stax says "All transactions" and the note; mode A never the default |
| Burned fees | — | rule rejections are `tef` (no fee); fee ceiling in every mode; mode C counts fees in the cap |
| Blind passkey prompt (domain only) | session opened with wrong rules | the Ledger shows the rules; protocol max duration |
| Broken passkey public key (quantum) | passkey's full authority | the PQ account has no passkey; a "Face" account is said to be non-PQ |
| Rejected `tef` tx held and replayed under a reopened session | unexpected execution | mandatory `LastLedgerSequence` within 256 ledgers (protocol rule) |
| P-256 malleability | modifiable tx id | low-S and strict DER client-side; identify by `(Account, Sequence)` |

**Not claimed**: that mode A protects funds (it protects **control**); that Face ID is post-quantum; that alphanet passkeys are defect-free; that the PQ account is fully post-quantum while its sessions use classical P-256 keys; that the Ledger screen proves the session key belongs to the right page (it proves the **rules**, not who holds the key). Beneficiary: a session-signed transaction counts as owner activity for the beneficiary time lock and no session can be created for the beneficiary key. Contention: session transactions share the account's sequence space; tickets do not change authority.

---

## 13. Risks and plan B

| Risk | Warning sign | Plan B |
|---|---|---|
| XRPLF does not build, or the head moved | build fails; codes changed (K5) | Transia `alphanet` @ `0a4cfdb61e` (same field codes, regenerated result codes, no Firewall / Beneficiary, `PasskeyListSet` = 118) |
| Device refuses to load the app | L0 fails | try the three routes (§5.2); then Speculos `stax`, said to be simulated |
| Device specifics: attestation, developer mode | genuine check refused in Ledger Live; load refused | loading routes do not depend on Ledger Live; Speculos as last resort, declared |
| P5 breaks the passkey | K2 fails and N1 test fails | fix in a separate commit; meanwhile open the session by `RegularKey`; raw P-256 signature (no `PasskeySignature`) or the L6 key |
| Mode A too broad for the reviewers | feedback at office hours | lead with mode C; mode A behind an explicit name |
| Session path late | N4 (mode A) not green | focus on mode A and say so (C and P become future work in the XLS) |
| C++ amendment does not pass | N2 / N3 not green at the gate | **plan B without protocol**: XLS-75 (`DelegateSet`, `PermissionDelegationV1_1`) with a throw-away delegate account on the public AlphaNet; closing = deleting the delegation; no cap or expiry enforced, said as such |
| Ledger late | L1 not on the device at the gate | video of clear signing on Speculos, **said as such**; L0 keeps the "real device" rule |
| ML-DSA does not fit in RAM | K4 fails | software ML-DSA signing, said as such |
| Eligibility reading by organizers | a reply contrary to ours | the submitted code is new; adjust the README wording |
| Fatigue | chained errors | staggered sleep; feature freeze Sun 08:00 |

Order of the stretch items: decided on site (D8 for L2 vs L6); nothing is excluded. Always done: N1's test, L0, L1, the protocol tests, the honest README. If a track is behind, the README says so instead of simulating (for example software ML-DSA signing, a Speculos video, mode P as future work in the XLS).

---

## 14. Git workflow, commits and pull requests

The reviewers know the XRPLF conventions; we follow them so that a reader of this repository recognises them.

**Branches**: `main` is always buildable. Short-lived topic branches named `<github-username>/<topic>` (rippled's rule; `XLS-xxx/...` for standards work), one topic = one pull request, reviewed by the other team member before merge.

**Commits** (rippled CONTRIBUTING, "Good commit messages"):
- Subject: `type: Imperative sentence in sentence case` — ≤ 50 characters, 72 hard limit, no trailing period; completes "If applied, this commit will …".
- Types: `feat` (new functionality), `fix` (bug fix), `refactor`, `test` (tests only), `docs`, `build` (CMake / Conan / imports), `ci`, `style`, `perf`, `chore`.
- No scope parentheses (rippled does not use them); the area is in the subject: `feat: Add SigningSessionSet transactor`, `test: Cover the fee ceiling in every session mode`.
- Blank line, then a body wrapped at 72 columns explaining **what and why** (not how), referencing the XLS section or test case numbers ("Case 13 of the test plan").
- Atomic: **one base defect per commit**, never mixed with the amendment; tests in the same commit as the code they cover or in the commit right before it (TDD); no formatting noise; generated `protocol_autogen` limited to our types.
- Commits are **signed** (rippled requires it), and at least one commit of a merged PR carries the PR number, e.g. `feat: Add SigningSessionSet transactor (#12)`.
- Pair work: `Co-authored-by: Name <email>` trailer.

**Order of history in `rippled/`**: import (`build:`) → base fixes (`fix:`, e.g. P5 if needed) → amendment definitions (`feat:`) → each transactor with its tests in the same commit or the commit right before it (`test:` then `feat:`, TDD) → invariant with its tests → docs. Same idea in `ledger-app/`.

**Pull requests**: title uses the same type prefix. Body follows the rippled template:

```text
## High Level Overview of Change
## Context of Change          (why this design; alternatives; link to the spec section / test case)
## API Impact                 (checkboxes: public API / libxrpl / peer protocol)
## Before / After             (optional, technical, with examples)
## Test Plan                  (exact commands and the test cases covered)
## Future Tasks
```

Keep PRs small and brief (reviewers value brevity). rippled merges PRs with **squash-and-merge** and forbids merge commits and "Rebase and merge"; a PR that must land as several commits (the two imports, the base fixes) is the documented exception: request a fast-forward-only merge (`--ff-only`) and justify it in the description. CI (`pnpm -r test`, the protocol suites) must pass; no "fix CI" noise on `main`.

**Review culture to anticipate** (observed in XRPL standards and rippled reviews): gating on the amendment everywhere; **a test for every line** (or an explicit `LCOV_EXCL` with a reason); correct code prefix (`tem` stateless / `tef` / `tec`); `NounVerb` naming; performance and DoS (our cap check is O(1) per transaction); and the question "what new functionality does this provide that existing features do not?" (answered in the XLS: XLS-75 delegates to an *account*, needs a second funded account, has no expiry and no amount cap).

**`docs/DEVLOG.md`**: dated entries — what was done, removed, ignored or simulated; it is the source of the README's "before / during" table and of the honesty slide.

**README "Existing before Oct 24 / Built during the hackathon"**: before = idea, this specification, the preparation dossier, and the earlier prototype (not reused); during = everything else, with the commit range.

---

## 15. Open items

1. **D3** to ask Denis (one object per session vs entries in the passkey list); **D4**, **D5**, **D8** postponed.
2. UNVERIFIED on this device: loading route on a Stax, SLIP-21 install-parameter syntax, a new P2 value for P-256, the rendering of 10 permission lines, `MLDSA_internal_keygen` linkage in an app-xrp build, the exact DMK 1.11 send-APDU API.
3. Not yet shown by a test: the WebAuthn challenge comparison (P5, read in code, regression test pending) and whether the base builds.
4. XLS-Sessions final text from the implementation.

---

## Appendix A: constants

| Name | Value |
|---|---|
| `SessionKey` | ACCOUNT 34 |
| `SessionCap` | AMOUNT 47 |
| `SessionSpent` | AMOUNT 48 |
| `SessionDuration` | UINT32 114 |
| `ltSIGNING_SESSION` | `0x009A` |
| keylet namespace | `'z'` = `0x007A` |
| `SigningSessionSet` / `SigningSessionDelete` | 130 / 131 |
| `tfAllTransactions` / `lsfAllTransactions` | `0x00010000` |
| `kMaxSessionDuration` | 600 s |
| `kSessionFeeMultiple` | 1000 |
| `kSessionMaxLedgerWindow` | 256 |
| `kPermissionMaxSize` | 10 |
| P-256 public key | 65 bytes `0xF6 ‖ X ‖ Y` |
| ML-DSA-44 | public key 1 312 B (no prefix), signature 2 420 B, secret key 2 560 B |
| app-xrp APDU | `CLA 0xE0`, `INS 0x02` pubkey, `0x04` sign, `0x06` config; `P2 0x40` secp256k1, `0x80` ed25519 |
| Public AlphaNet | network 24100 |

## Appendix B: references

- Upstream: [XRPLF/rippled `alphanet`](https://github.com/XRPLF/rippled/tree/alphanet) · [LedgerHQ/app-xrp](https://github.com/LedgerHQ/app-xrp) · [ledger-secure-sdk PR #1617 (ML-DSA)](https://github.com/LedgerHQ/ledger-secure-sdk/pull/1617) · [ledger-app-zond](https://github.com/cyyber/ledger-app-zond) · [ledger-app-builder](https://github.com/LedgerHQ/ledger-app-builder) · [DMK XRPL workshop](https://github.com/LedgerHQ/device-management-kit-ts-workshop/tree/main/xrpl-hackathon).
- Standards and discussions: [XLS-75 permission delegation / #657 expiry](https://github.com/XRPLF/XRPL-Standards/discussions/657) · [#572 agent identity (amount cap)](https://github.com/XRPLF/XRPL-Standards/discussions/572) · [XLS-83 passkeys, one object vs list](https://github.com/XRPLF/XRPL-Standards/discussions/236) · [XLS-86 Firewall](https://github.com/XRPLF/XRPL-Standards/discussions/255) · [XLS-103 on-chain co-signer](https://github.com/XRPLF/XRPL-Standards/discussions/589) · [session keys sketch by Denis, Transia #29](https://github.com/Transia-RnD/rippled/pull/29#issuecomment-4243346546) · [role-based signature prefixes, rippled #8162](https://github.com/XRPLF/rippled/pull/8162).
- Event: Ledger page https://developers.ledger.com/xrplnyc (Protocol Innovation, "there is still no XRPL transaction Clear Signing"; real device required; documentation feedback judged "as much as the code": what to include = overall experience with the Ledger docs and SDKs, gaps / confusing flows / missing context, specific improvements with screenshots or PRs; bonus = better tutorial or code sample ideas, portal navigation or search improvements, time-saver suggestions).

## Appendix C: kickoff checklist

- [ ] `docs/ledger-dx-feedback.md` created with its entry template; log started (§7.6).
- [ ] Disk space freed, `conan` on `PATH`, builder image pulled, `STAX_SDK` set.
- [ ] Stax unlocked, on the dashboard, firmware 1.11 confirmed, loading route chosen.
- [ ] Head of `XRPLF/rippled:alphanet` read; SHA recorded; background build started.
- [ ] Repository: two import commits, `UPSTREAM.md`, `README.md` skeleton, `docs/DEVLOG.md`.
- [ ] K5 run on the imported SHA; codes of §6.1 confirmed or renumbered everywhere.
- [ ] All `.macro` edits batched before the first full rebuild.
- [ ] Spikes K1-K3, K6 on the public AlphaNet with a **new account each**.
- [ ] Decisions D3 (Denis), D4, D5, D8 revisited at the 14:00 gate and at office hours.
