# carbs: FIANSO-SPEC, the build specification

| | |
|---|---|
| **Author** | Sofiane ("fianso", [@STOOOKEEE](https://github.com/STOOOKEEE)). This is **my** specification, hence its name. The decisions in §2 are mine and apply to the whole team. |
| **Date** | 2026-10-24 |
| **Nature** | Documentation and design. It contains **no implementation code** and no code from any earlier prototype. Upstream code is imported unmodified in `rippled/` and `ledger-app/` (§4). |
| **Source** | Consolidates the preparation dossier `docs/carbs/` on branch `fianso` of [STOOOKEEE/TTT](https://github.com/STOOOKEEE/TTT), re-checked against upstream code. |
| **Prior work** | An earlier "v2" design and prototype (`feat/signing-sessions` in `STOOOKEEE/TTT`: witness co-signer, `ForceQuantum`, XRP-only payments) is a different design and is **not reused**: nothing was copied, patched or retyped from it. |
| **Status** | Decisions are in [§2](#2-decisions). Items marked **UNVERIFIED** were not confirmed in code or on a device and must be checked on first use. |

---

## TL;DR

**carbs makes XRPL quantum-safe by default and delegable at the same time, with the rules enforced by the ledger and read on a Ledger device.**

- **Protocol**: a rippled amendment `SigningSessions`. An account opens a *session*: a short-lived (at most 10 minutes) ephemeral key that signs without prompting, and that the **ledger itself** confines in time, in transaction types (or in XRP spent), and in fee burn. It can never change who controls the account. Built on the XLS-75 permission engine, in `rippled/` (base: `XRPLF/rippled:alphanet`).
- **Three exclusive modes**: **A** all delegable types minus an exclusion list, **P** a list of XLS-75 permissions, **C** direct XRP `Payment` only, with a total cap (fees included).
- **A post-quantum root in hardware** (the headline): a **Ledger Stax** generates and holds an **ML-DSA-44** key, and **clear-signs** XRPL transactions with it: to our knowledge the first hardware-wallet post-quantum signatures on XRPL, readable on the device screen. The same device opens the sessions of a **Ledger account** with the rules displayed ("Valid for 10 minutes · All transactions · Cannot change keys"), and those sessions use ML-DSA-44 keys too. On a **Mac account**, a passkey (P-256, Face ID / Touch ID) opens them (two profiles, D13).
- **A quantum exposure check and a guided migration** for any XRPL account: is its public key already on the ledger, do its other authorities or signer lists expose keys, and what does the move to a post-quantum key look like (`SetRegularKey` to the ML-DSA key, a proof transaction signed by it, then `asfDisableMaster`, which only the master key can set). See [§8.7](#87-quantum-exposure-check-and-migration).
- **Community tooling**: a Device Management Kit Ledger adapter for `xrpl-connect` (their current adapter uses the legacy ledgerjs stack), the client library `@carbs/sessions`, and a sessions template for `create-xrp` ([§8.8](#88-ecosystem-contributions)).
- **Documentation feedback for Ledger** is a first-class deliverable, judged "as much as the code": a running log kept from the start, screenshots, and pull requests to the docs ([§7.6](#76-documentation-and-developer-experience-feedback)).
- **Client**: TypeScript (`packages/core`, `apps/web`), session keys that follow the account profile (ML-DSA-44 generated in the client on a Ledger account, WebCrypto non-extractible P-256 on a Mac account; D13, D14), Ledger over WebHID with the Device Management Kit and custom APDUs.
- **Single public repository** `carbs`; upstream bases imported unmodified in their own commits; PRs and commits in the XRPLF style.

### Why this, and why now

| Evidence | Source |
|---|---|
| About 5.6 million XRPL accounts holding 76.82 billion XRP have a public key already visible on the ledger (an audit by the validator Vet, April 2026: 7,810,364 accounts scanned); 242 multi-signature wallets holding 36.6% of the supply have a quorum of signer keys visible | `x.com/Vet_X0/status/2049610164135686547`, reported by Bitcoinist. Secondary source; the method is public (an account is exposed once it has signed a transaction) |
| Ripple's post-quantum roadmap: test post-quantum schemes next to current signatures on developer networks in the second half of 2026, a native amendment by 2028. It does not cover hardware wallets or passkeys | Ripple, "Post-Quantum Readiness on the XRP Ledger" (2026-04-20) |
| Ledger added ML-DSA (44, 65, 87) and ML-KEM to its SDK in June 2026 and notes that the pre-hash variant does not fit clear signing; we found no Ledger app that signs ML-DSA XRPL transactions | `ledger.com/blog-post-quantum-cryptography-ledger-sdk`; `ledger-secure-sdk` PR #1617 |
| A quantum-resistant XRPL account using Batch and hashes was shown publicly on 9 Oct (hash-based, built with Batch) | `x.com/angell_denis/status/2108681010288156819` |
| XLS-75 delegation is live; two open discussions ask for what sessions add: an expiry (#657) and an amount cap (#572, "what does this provide that XLS-40/70/75 do not?") | XRPL-Standards discussions #657, #572 |

---

## 1. Contents

2. [Decisions](#2-decisions) · 3. [Ground rules](#3-ground-rules) · 4. [Repository](#4-repository-layout-and-imports) · 5. [Environment](#5-environment-and-toolchain) · 6. [Protocol](#6-protocol) · 7. [Ledger app](#7-ledger-application) · 8. [Client](#8-client) · 9. [Spikes](#9-spikes-k1-k8) · 10. [Work breakdown](#10-work-breakdown) · 11. [Demo and presentation](#11-demo-and-presentation) · 12. [Security](#12-security-model) · 13. [Risks and plan B](#13-risks-and-plan-b) · 14. [Git workflow](#14-git-workflow-commits-and-pull-requests) · 15. [Open items](#15-open-items) · 16. [Limits and roadmap](#16-limits-and-roadmap) · [A. Constants](#appendix-a-constants) · [B. References](#appendix-b-references) · [C. Setup checklist](#appendix-c-setup-checklist)

---

## 2. Decisions

Taken by Sofiane, **for the whole team**.

| ID | Question | Decision |
|---|---|---|
| **D0** | Restart from scratch or build on the earlier prototype | **Restart from scratch.** Every line of this repository's code is written here. The earlier prototype is declared and not reused. |
| **D1** | Protocol base | **The latest XRPL base**: `XRPLF/rippled` branch `alphanet`, head at the time of the import. The imported head is `68bd02b647` (composed 2026-10-16, "alphanet from XRPLF/rippled@3.4.1", 14 branches, option `force_supported: ON`). Re-verify the protocol codes on the SHA actually imported. Fallback if it does not build: `Transia-RnD/rippled:alphanet` @ `0a4cfdb61e`. |
| **D2** | Session duration | **10 minutes**: `kMaxSessionDuration = 600 s` in the protocol **and** in the app. |
| **D3** | One ledger object per session, or entries in the passkey list | Default kept: **one object per session** (the XLS-83 question raised by Mayukha). **To ask Denis** at the next occasion. |
| **D4** | Exact exclusion list for mode A | **Decided (24.10):** `PasskeyListSet`, `SubscriptionSet`, `SponsorshipSet`, `CredentialCreate`, `DIDSet` plus everything non-delegable; an enumeration test forces an explicit decision for every delegable type ([§6.8](#68-exclusion-list-and-enumeration-test)). In plain terms: *which transaction types an "all transactions" session must never be able to sign.* |
| **D5** | Who does what | **No split for now.** This spec describes two work tracks (protocol; Ledger and client), not people. |
| **D6** | Prize opt-ins | **Protocol Innovation track + Ledger Protocol Innovation.** Nothing else. The agent scene (§8.8) is **reserved**: it is not part of the plan and not an opt-in. **Superseded by D16:** there is no agent scene. |
| **D7** | Passkey defects found in the base | **Presentation only.** No upstream PR and no message to Denis for now. The one exception inside the build is P5: it is *tested* on our node first, and fixed in a separate commit only if our passkey path fails because of it ([§6.14](#614-passkey-path-and-key-formats)). |
| **D8** | After L1, which Ledger item first: ML-DSA on device (L2) or a P-256 passkey key on device (L6) | **Proposed: L2 first.** The headline is the post-quantum root (§7.7); L6 follows. Spike K4 (memory) decides whether L2 is hardware or falls back to software signing, said as such. |
| **D9** | Adopt the ecosystem scope (adapter, library, template) | **Adopted**, without the agent scene (reserved, D6). **Superseded by D16:** there is no agent scene. |
| **D10** | Front base | **The `create-xrp` Nuxt template**, generated and recorded in `UPSTREAM.md` (ADR 0007). |
| **D11** | Headline | **Adopted: quantum-safe by default**: post-quantum root on the Stax, quantum exposure check and migration, sessions on top (§7.7, §8.7). |
| **D12** | Licence | **Apache-2.0** for the code written here (the `ledger-app/` base is Apache-2.0); changes meant for `rippled/` follow its ISC licence. See `LICENSE` and the README. |
| **D13** | Account profiles | **Two profiles, one session engine** ([ADR 0011](docs/adr/0011-two-account-profiles.md), §8.5). **Ledger account**: master key disabled, `RegularKey` = the device's ML-DSA-44 key, **never a passkey** (a passkey has full authority and cannot be replaced or removed, so it would defeat the device and the post-quantum root); every transaction made with the account's own authority, session openings included, is signed on the device; its session keys are ML-DSA-44 keys generated in the client. **Mac account**: master key and a passkey; sessions are opened by the passkey; the session key is a non-extractible P-256 WebCrypto key. |
| **D14** | ML-DSA-44 session keys | **The amendment accepts them.** Nothing in it depends on the key type of a session key; the code path, and the tests that settle what is still unverified, are in §6.14. Case 20 with ML-DSA-44 belongs to N4. |
| **D15** | Tickets and sessions | **Tickets serve multisig coordination**: collecting signatures out of order without blocking the account sequence. How sessions should use tickets is a **proposal, not adopted**: [ADR 0010](docs/adr/0010-tickets-for-multisig-coordination.md) (three options, codes checked free, a recommendation). Nothing is implemented for it, and §6 is unchanged until an option is adopted. |
| **D16** | Headline, agent scene, limits | **The headline stays "quantum-safe by default"** (D11): the default profile is the Ledger account (D13). **No agent scene.** The limits of the design, and what would lift each one, are written down in [§16](#16-limits-and-roadmap) and in `docs/ARCHITECTURE.md`. |

---

## 3. Ground rules

1. **All code here is written in this repository**, in reviewable commits. Upstream code (`rippled/`, `ledger-app/`) is imported **unmodified, in its own first commit per directory**, with SHA, URL and licence recorded in `UPSTREAM.md`. `git diff <import-commit>..HEAD -- rippled/` must show our work alone.
2. **No fork, no submodule.** A submodule renders as a link and clones empty without `--recursive`; a private or deleted fork breaks the review.
3. **README states what existed before this repository** (prior work, not reused) **and what is built here**. `docs/DEVLOG.md` is dated and records what was done, removed, ignored or simulated.
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
  FIANSO-SPEC.md              this file (Sofiane's spec)
  README.md                  what it is, prior work, demo instructions
  UPSTREAM.md                SHA, URL, licence of each import (rippled: ISC; app-xrp: Apache-2.0)
  rippled/                   XRPLF/rippled:alphanet @ <head at the time of the import>, imported unmodified, then the amendment
  ledger-app/                LedgerHQ/app-xrp master @ 7b5185ff (v2.8.2), imported unmodified, then clear signing
  packages/core/             definitions, encoding, signatures, constants, node client
  packages/ledger/           DMK library: signing preview, custom commands for the post-quantum root
  apps/web/                  Nuxt (Vue 3) + TypeScript strict, generated from the create-xrp template
  infra/                     standalone.cfg, ledger closer, Dockerfile of the node
  docs/                      DEVLOG.md, XLS-Sessions.md (final), ledger-dx-feedback.md
```

**Import procedure** (the first step of the repository):

1. `git clone --depth 1` the upstream at the chosen SHA outside the repo; record `git rev-parse HEAD`.
2. Copy the tree **without `.git`** into `rippled/` (resp. `ledger-app/`), keep upstream `LICENSE` files.
3. Commit each import alone: `build: Import XRPLF/rippled alphanet at <sha10>` and `build: Import LedgerHQ/app-xrp master at 7b5185ff`. Commit body: URL, full SHA, licence, "unmodified".
4. Add `UPSTREAM.md` in a separate `docs:` commit.
5. Sizes measured on the pinned SHAs: rippled ≈ 2 300 files / 27 MB, app-xrp ≈ 27 MB (mostly test snapshots), ≈ 55 MB in total.

**Why `XRPLF` and not `Transia`**: upstream, the Foundation's public AlphaNet, 3.4.1 with role-based signature prefixes, October ML-DSA fixes, same `conanfile.py` as the 3.4.1 already cached on the team machines (only `dilithium.cmake` is added), and no port later. Transia remains the fallback: same field codes, regenerated result-code values, no Firewall or Beneficiary, `PasskeyListSet` = 118.

---

## 5. Environment and toolchain

### 5.1 Versions and pins

| Component | Value |
|---|---|
| Node base | `XRPLF/rippled:alphanet`, head at the time of the import (`68bd02b647`), rippled 3.4.1 + passkeys + ML-DSA |
| Ledger base | `LedgerHQ/app-xrp` `master` @ `7b5185ff` (v2.8.2; supports `nanox`, `nanos+`, `stax`, `flex`, `apex_p`; UI is NBGL only) |
| Ledger SDK | `ledger-app-builder` image, SDK v27.1.3 (`API_LEVEL` 27) |
| Device | **Ledger Stax** (2023, model 2103), **firmware 1.11** = `API_LEVEL` 27 (tag `stax_1.11.0` of `ledger-secure-sdk`, `Makefile.defines`); SRAM 36 KB; touchscreen; sideload allowed |
| Client | Vite, Vue 3, TypeScript strict, Vitest, `xrpl` 5.3.0, `ripple-binary-codec` 2.11.0, `@noble/post-quantum` **0.7.1 pinned**, `@noble/curves`, `@noble/hashes`, `@ledgerhq/device-management-kit` 1.11.0, `@ledgerhq/device-signer-kit-xrp` 0.3.0, `@ledgerhq/device-transport-kit-web-hid` 1.2.4. **Device Management Kit only** (the Ledger-proposed stack); the legacy ledgerjs packages (`@ledgerhq/hw-app-xrp`, `@ledgerhq/hw-transport-webhid`) are not used |
| Package manager | pnpm |
| Public AlphaNet (spikes only) | RPC `https://rpc.alphanet.xrpl.org`, WebSocket `wss://alphanet.xrpl.org`, faucet `https://faucet.alphanet.xrpl.org/accounts`, network id 24100 |

`device-signer-kit-xrp` 0.3.0 signs secp256k1 and Ed25519 only, has no secp256r1 or ML-DSA and no transaction types of its own, but its `signTransaction(path, Uint8Array)` forwards the **raw transaction bytes**: opening a session with a secp256k1 / Ed25519 device key therefore needs **no custom APDU** once the app clear-signs types 130 / 131 (to confirm in K6 with a type 130). The P2 byte of its APDUs is limited to those two curves, so **L2 (ML-DSA) and L6 (P-256) need custom APDUs** sent through the DMK.

### 5.2 Machine and tooling checklist

- Disk: rippled build tree plus the Conan cache (≈ 21 GB for `~/.conan2`) plus the app-builder image. Free the space before the first build.
- `conan` must be on `PATH` (it may be missing from the shell `PATH`); CMake, Ninja or Make, a C++20 compiler as required by rippled 3.4.1.
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
| Ledger unit tests | `cmake -S ledger-app/unit-tests -B build/ledger-unit && cmake --build build/ledger-unit` then `ctest` (cmocka) |
| Ledger Ragger tests | `pytest tests/standalone --device stax` |
| Web / core | `pnpm -r test`, `pnpm --filter web dev` (a single `pnpm demo` command for node, closer and app is planned, not present yet) |

---

## 6. Protocol

### 6.1 New identifiers

All codes were checked free on 2026-10-24 on both `XRPLF/rippled:alphanet` @ `68bd02b647` and `Transia-RnD/rippled:alphanet` @ `0a4cfdb61e`, and against `server_definitions` of the public AlphaNet (transactions ≤ 128, ACCOUNT ≤ 33, AMOUNT ≤ 46, UINT32 ≤ 113, ledger entries ≤ `0x99`). **Re-verify on the imported SHA (spike K5) before writing anything.**

| Item | Value |
|---|---|
| Amendment | `XRPL_FEATURE(SigningSessions, Supported::Yes, VoteBehavior::DefaultNo)` (**`Supported::Yes`**, the normal state of a feature we ship); requires `PermissionDelegationV1_1` via `checkExtraFeatures` |
| Fields | `SessionKey` ACCOUNT 34 · `SessionCap` AMOUNT 47 · `SessionSpent` AMOUNT 48 · `SessionDuration` UINT32 114 · `SessionMaxPerTx` AMOUNT 49 · `SessionWitness` ACCOUNT 35 · `SessionMaxTxCount` UINT32 115 · `SessionTxCount` UINT32 116 · `WitnessSignature` OBJECT 43 (common, not signing, `{SigningPubKey, TxnSignature}`). Reused: `Expiration`, `Permissions` (ARRAY 29 / OBJECT 15 / UINT32 52 for `PermissionValue`), `Owner` |
| Ledger entry | `ltSIGNING_SESSION = 0x009A`; keylet namespace `'z'` (`0x007A`) |
| Transactions | `SigningSessionSet = 130`, `SigningSessionDelete = 131`, **both non-delegable**; `ttSIGNING_SESSION_SET`, `ttSIGNING_SESSION_DELETE` |
| Result codes (append at the **end** of `TEFcodes`, after `tefFIREWALL_BLOCK`) | `tefSESSION_EXPIRED` (-172), `tefSESSION_LIMIT` (-171), `tefSESSION_TX_NOT_ALLOWED` (-170), `tefSESSION_NO_WITNESS` (-169) |
| Hash prefix | `HashPrefix::WitnessTxSign` = `WTS\0`, signed by the witness over the transaction's signing fields |
| Flag | `tfAllTransactions = 0x00010000` (on `SigningSessionSet`), mirrored as `lsfAllTransactions` on the entry. `SigningSessionDelete` has no flag of its own |
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
| `SessionMaxPerTx` | no, mode C only | positive XRP amount ≤ `SessionCap`: the most one payment may send (fee not included) |
| `SessionWitness` | no | an existing third account (neither `Account` nor `SessionKey`) that co-signs every session-signed transaction but the own close |
| `SessionMaxTxCount` | no, any mode | `1 ≤ n ≤ kMaxSessionTxCount (100 000)`: the most transactions the session may sign |
| `SessionTxCount` | with `SessionMaxTxCount` | `0` at creation, one more per session-signed transaction applied (`tes` or `tec`), the own close excepted |
| `Flags` | yes | `lsfAllTransactions = 0x00010000` in mode A |
| `OwnerNode`, `PreviousTxnID`, `PreviousTxnLgrSeq` | yes | standard |

Exactly one of {`Permissions`, `lsfAllTransactions`, `SessionCap`} is set; every field but `SessionSpent` and `SessionTxCount` is fixed at creation. Registered in the owner's directory; one owner reserve, never reserve-sponsored (`SigningSessionSet` is not in `isReserveSponsorAllowed`, so a reserve sponsor is `temINVALID_FLAG`). An expired entry stays, unusable, until deleted. `AccountDelete` **must** delete the account's sessions (they are not obligations): add an entry for the type in `nonObligationDeleter` (`AccountDelete.cpp`, around line 205), otherwise `tecHAS_OBLIGATIONS`.

### 6.3 Transactions

**`SigningSessionSet`** (not delegable, not session-signable)

| Field | Req. | Notes |
|---|---|---|
| `SessionKey` | yes | AccountID of the new key |
| `SessionDuration` | yes | seconds, `1 ≤ d ≤ kMaxSessionDuration (600)` |
| `Permissions` | mode P | 1..10 values, duplicates rejected |
| `SessionCap` | mode C | native XRP, positive |
| `tfAllTransactions` | mode A | flag `0x00010000` |
| `SessionMaxPerTx` | no | mode C only; native XRP, positive, ≤ `SessionCap` |
| `SessionWitness` | no | AccountID of the witness |
| `SessionMaxTxCount` | no | any mode; `1 ≤ n ≤ kMaxSessionTxCount` |

Preflight (stateless, `tem`): flag bits outside `tfSigningSessionSetMask` → `temINVALID_FLAG`; not exactly one mode → `temMALFORMED`; `SessionKey == Account` → `temMALFORMED`; duration 0 or > max → `temBAD_EXPIRATION`; `Permissions` empty / too large → `temARRAY_EMPTY` / `temARRAY_TOO_LARGE`; duplicate value, non-delegable value, or a type (transaction-level or granular) a mode-A session could not sign → `temMALFORMED`; `SessionCap` not XRP or not positive → `temBAD_AMOUNT`; `SessionMaxPerTx` without `SessionCap` → `temMALFORMED`, not XRP, not positive or above `SessionCap` → `temBAD_AMOUNT`; `SessionMaxTxCount` 0 or > `kMaxSessionTxCount` → `temMALFORMED`; `SessionWitness` equal to `Account` or `SessionKey` → `temMALFORMED`.
Preclaim / doApply: `SessionKey` equals the account's `RegularKey`, one of its passkey AccountIDs, or its beneficiary key → `tecNO_PERMISSION` (such a key already has full authority); a session already exists for (`Account`, `SessionKey`) → `tecDUPLICATE`; `SessionWitness` names no account → `tecNO_TARGET`; reserve → `tecINSUFFICIENT_RESERVE`.
Effect: create the entry (`Expiration = parentCloseTime + SessionDuration`; `SessionSpent = 0` in mode C; `SessionTxCount = 0` with `SessionMaxTxCount`), insert in the owner directory, increase owner count. Use the sponsor-aware reserve helpers like `DelegateSet.cpp` (`checkReserve`, `increaseOwnerCount`). No update: delete and reopen.

**`SigningSessionDelete`** (not delegable)

| Field | Req. | Notes |
|---|---|---|
| `SessionKey` | yes | session to delete |
| `Owner` | no | owner when the submitter is not the owner |

No flag of its own: `getFlagsMask` returns `tfUniversalMask`, so every bit but the universal flags (`tfFullyCanonicalSig`, and `tfInnerBatchTxn` on a Batch inner transaction) is `temINVALID_FLAG`. Without `Owner`: signed by any full-authority key **or by the session key itself** (the "own close"). With `Owner` (≠ `Account`): any account may delete once the session is **expired**, else `tecNO_PERMISSION`. Missing entry → `tecNO_ENTRY`; `Owner == Account` → `temMALFORMED`.

### 6.4 The session-signed predicate

A transaction is **session-signed** iff **all** hold:
- single-signed (non-empty `SigningPubKey`, no `Signers`);
- no `Delegate`, no `Sponsor`, no `SponsorSignature`, and not an inner Batch transaction;
- a `SigningSession` exists for (`Account`, `AccountID(SigningPubKey)`);
- it carries no `CounterpartySignature` (a session key used as a counterparty signer follows the existing rules and is rejected).

The predicate first tests `rules.enabled(featureSigningSessions)` (no ledger read on every transaction before activation) and that `SigningPubKey` is a valid public key type (secp256k1, Ed25519, P-256 or ML-DSA-44; an ML-DSA-44 session key needs nothing more, §6.14, D14). One function, `signingSessionOf(view, tx)` (and `isSessionSigned`), serves **authorization, accounting, the transaction queue and the invariant** so that they cannot disagree; the invariant and the queue also use its shape test without the existence check (`sessionKeyletOf`). A session-signed transaction is authorized **only** by its session: master, `RegularKey`, passkey and beneficiary rules are not consulted. Consequence: a key that later also becomes `RegularKey` stays bounded until its session is deleted (least privilege); creating a session for a key that already has full authority is forbidden (§6.3). Two shapes follow the existing rules: sponsored transactions and a Batch inner-account signature (`Batch::checkBatchSign` calls `Transactor::checkSign`). Wallets should not make a session key a `RegularKey`.

**Batch.** A session key can neither sign nor co-sign a `Batch` (suite `SigningSessionsBatch`). As the outer signer: `Batch` overrides `checkSign`, so `invokeCheckSession<T>` refuses it before any mode rule with `tefSESSION_TX_NOT_ALLOWED`, in every mode. As a `BatchSigner`: `Batch::checkBatchSign` runs the ordinary signature check of the account, which never consults sessions: `tefBAD_AUTH`, although the same key may sign the same payment on its own. A session-signed transaction carrying `tfInnerBatchTxn` is not session-signed (the predicate excludes it); without a parent Batch it is refused (`temINVALID_INNER_BATCH` in preflight, and `submit`'s local checks). The owner may open and revoke sessions inside a Batch it signs: that is why `SigningSessionDelete` keeps `tfInnerBatchTxn` in its flag mask.

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
   - a type that overrides `checkSign` (`Batch`, `LoanSet`) is never eligible, whatever the mode;
   - every other session-signed transaction uses `Sequence`, never `TicketSequence`: the tickets of the account stay for the owner (who can revoke by ticket while the key holds the sequence) and for multi-signed transactions (the rule of ADR 0010 for a session without a ticket range). The own close may use a ticket;
   - mode P: same sequence as `Transactor::checkPermission` / `invokeCheckPermission<T>` with the session entry instead of the delegate entry: `checkTxPermission(sle, tx)`, then `getGranularPermission` + `Permission::checkGranularSandbox`, then `T::checkGranularSemantics`; the type must also not be in `kSessionExcluded` (checked at use). **Map every `terNO_DELEGATE_PERMISSION` or other `ter` answer to `tefSESSION_TX_NOT_ALLOWED`**: a retriable `ter` would keep a rejected tx in the node's retry loop;
   - mode A: the type is delegable and not in `kSessionExcluded`;
   - mode C: a `Payment` whose `Flags` carry nothing but `tfFullyCanonicalSig`, whose type-specific fields are only `Destination`, `DestinationTag`, `Amount`, with `Amount` in XRP. This is a **closed whitelist**: flags such as `tfSponsorCreatedAccount` lock reserves outside the cap; `SendMax`, `Paths`, `DeliverMin`, partial payments move value the cap does not see.
2. **`LastLedgerSequence` present and near** → `tefSESSION_TX_NOT_ALLOWED`: `LastLedgerSequence ≤ ledgerSeq + kSessionMaxLedgerWindow (256)`. A held-and-retried rejected tx must not land under a later session opened with the same key.
3. **Expiry** → `tefSESSION_EXPIRED`: `parentCloseTime < Expiration`, except for the own close.
4. **Fee ceiling** → `tefSESSION_LIMIT`, all modes: `Fee ≤ calculateBaseFee(view, tx) + kSessionFeeMultiple × view.fees().base`; for the own close, `Fee ≤ calculateBaseFee(view, tx)` (no margin: it escapes the expiry, the cap and the witness and is never counted, so past the cap it costs one base fee at most). The first term keeps types whose required fee is the owner-reserve increment (AMM creation, `LedgerStateFix`) usable; the second bounds what a session can overpay on top of it, so a failed (`tec`) transaction cannot burn more than the required fee plus a small margin. `calculateBaseFee` returns an `Expected` whose error is a `TER`: convert it to `NotTEC` explicitly.
5. **Cap** → `tefSESSION_LIMIT`, mode C, every session-signed tx except the own close: `Fee + Amount ≤ SessionCap − SessionSpent` (`Amount` only for a `Payment`), and `Amount ≤ SessionMaxPerTx` when the session has one.
6. **Transaction count** → `tefSESSION_LIMIT`, any mode, except the own close: `SessionTxCount < SessionMaxTxCount` when the session has one.
7. **Witness** → `tefSESSION_NO_WITNESS`, any mode, except the own close, when the session has a `SessionWitness`: the transaction carries a `WitnessSignature` whose `SigningPubKey` is a key of the witness account (its master key if not disabled, or its `RegularKey`). The signature itself is verified with the transaction's in `STTx::checkSign` (`checkValidity`): one key (an empty `SigningPubKey` is refused), prefix `WTS\0` over the transaction's signing fields. `WitnessSignature` is not a signing field, so the session key's signature does not cover it, and the witness signs the same fields as the session key, its `SigningPubKey` included. A `WitnessSignature` on any transaction is `temDISABLED` in `preflight1` without `SigningSessions`, so no transaction carrying one is applied before the amendment (its signature is still verified when relayed or submitted). A transaction that needs no witness takes no `WitnessSignature`: one that is not session-signed (checked in `invokePreclaim` after its signature check, so a key without authority keeps `tefBAD_AUTH`; a Batch inner transaction carrying one fails the Batch in preflight with `temBAD_SIGNATURE`), one signed under a session without a `SessionWitness`, and the own close of any session, even co-signed by its witness, get `tefBAD_SIGNATURE`, since nothing would check whose the signature is and anyone could add one, or strip it from the own close, and change the transaction's ID. A witness key of a type whose amendment is off (P-256 without `Passkey`, ML-DSA-44 without `Quantum`) does not co-sign, like a session key.

Before rule 1 the hook refuses a pseudo-account with `tefBAD_AUTH`, then a session key whose type belongs to an amendment that is not enabled, with `tefSESSION_TX_NOT_ALLOWED`, own close included: a P-256 key unless `Passkey` is enabled, an ML-DSA-44 one unless `Quantum` is (the opening names the key by its AccountID only, so the type is first known at use). **Replacing `T::checkSign` drops two checks of `Transactor::checkSign` that are redone**: the rejection of pseudo-accounts (that first step) and the unknown key type (part of the predicate). The cryptographic verification of the signature itself stays in `STTx::checkSign` / `checkValidity` (preflight). Case 9b also asserts that no session-eligible type overrides `checkSign`.

**Transaction queue.** A session-signed transaction never displaces a queued transaction of the same account and `SeqProxy` that its key did not sign (`sessionDisplacesOther`, `rippled/src/xrpld/app/misc/detail/TxQ.cpp`): through the queue it is `telCAN_NOT_QUEUE_FEE` whatever its fee, and the direct apply to the open ledger is skipped when it would replace such a transaction (the queue then refuses it). The owner's close waiting in the queue cannot be outbid by the key it revokes. `SigningSessionDelete` is a queue blocker (`ConsequencesFactoryType::Blocker`, like `SetRegularKey`): it is queued only alone in its account's queue, so no session transaction waits behind a close that would void it; a close paying the open ledger's fee still applies at once. `SigningSessionSet` stays `Normal`. The queue runs `preclaim` again when it applies a transaction, so a queued session transaction whose session expired, was deleted or ran out of cap or count is dropped without a fee (case 22).

### 6.6 Accounting (mode C and `SessionMaxTxCount`)

One helper `chargeSession(result, fee)` inside `Transactor::operator()`:
- exactly **two call sites** in `operator()`: (1) just before the first `checkInvariants`, after the `canApply` / `processPersistentChanges` block whose `reset(fee)` every `tec` traverses when `tapRETRY` is absent; (2) right after the second `reset(fee)`, before the `ProtocolOnly` re-check. Never inside `processPersistentChanges` (that would charge twice); a `reset` erases view state;
- with `SessionCap`: adds `fee` to `SessionSpent` for every outcome that claims the fee, plus `Amount` on `tesSUCCESS` of a `Payment`;
- with `SessionMaxTxCount`, in any mode: adds one to `SessionTxCount` for every outcome that claims the fee, `tes` and `tec` alike;
- the own close is exempt **by shape** (`SigningSessionDelete`, no `Owner`, `SessionKey` equals the signer) whatever its result, including a `tec` that leaves the session in place; tolerates a session entry that no longer exists;
- cannot live in `apply()`: a `tec` returned by `preclaim` (for example `tecNO_DST_INSUF_XRP` from `Payment`) never reaches `apply()`, and a `tec` result discards `doApply` changes. `preFeeBalance_` is the model for balance capture.

Since the own close pays at most its base fee (§6.5 rule 4), a mode-C account never loses more than `SessionCap` plus one base fee to a session.

The predicate and the session keylet are computed at the **top** of `operator()`, before `apply()`, because after `doApply` an own close has already erased the entry.

### 6.7 Invariant `ValidSigningSession`

Add to the `InvariantChecks` tuple (`include/xrpl/tx/invariants/InvariantCheck.h`) so it also runs in the `ProtocolOnly` pass after a `reset`. `finalize` only sees the final view, so capture everything in `visitEntry`: session entries before/after, touched account roots, and touched signer-list, passkey-list, delegate, beneficiary and firewall entries, and whether a sponsorship, subscription, credential or DID entry was created. The signer is derived from `SigningPubKey`; the session counts as pre-existing if visited with a `before` state or not visited and still existing (sound because §6.3 forbids creating a session for the signer's own key).

1. Only `SigningSessionSet` creates and only `SigningSessionDelete` / `AccountDelete` remove a session; the owner count changes by exactly one.
2. `Account`, `SessionKey`, `Expiration`, `Permissions`, `SessionCap`, `SessionMaxPerTx`, `SessionMaxTxCount`, `SessionWitness` and the mode flag never change; exactly one mode set; `SessionSpent` only with `SessionCap` and `0` at creation; `SessionTxCount` exactly with `SessionMaxTxCount` (within `1..kMaxSessionTxCount`) and `0` at creation; `Expiration` within `kMaxSessionDuration` of the parent close time at creation.
3. `SessionSpent` only increases, never above `SessionCap`, only in a session-signed transaction (the own close is exempt from rules 3 and 4 whatever its result). `SessionTxCount` never appears or disappears, increases by exactly one in each transaction its session signs and keeps (the own close excepted) and by zero otherwise, never exceeds `SessionMaxTxCount`; a session-signed transaction that keeps a counting session must count.
4. For a mode-C session-signed tx other than the own close: it has the shape of a session cap payment, and the increase of `SessionSpent` minus the fee is at most `SessionMaxPerTx` when the session has one. When it does not delete the session: XRP decrease of `Account` ≤ increase of `SessionSpent` (fee included); the owner count does not increase (consuming a ticket may lower it by one); the sponsoring count does not change. This ties the counter to the **real outflow**, not to declared fields.
5. A session-signed tx never modifies `RegularKey`, the master-disable flag, the signer list, the passkey list, the delegate entries, the beneficiary entry, the firewall entry, or another session of `Account`, and creates no sponsorship, subscription, credential or DID entry (the excluded types of §6.8).

### 6.8 Exclusion list and enumeration test

`kSessionExcluded` (transaction types that grant or change authority although delegable): `PasskeyListSet` (delegable on alphanet; the real fix is `NotDelegable` at its definition), `SubscriptionSet`, `SponsorshipSet` (open-ended rights for a third party, not bounded by an amount fixed at signing), `CredentialCreate` and `DIDSet` (D4: they grant lasting rights outside the account's own authority: a credential is an attestation about a third party that other accounts' deposit preauthorizations and permissioned domains accept, and a DID is the account's lasting identity document; both outlive the session). Instruments with a fixed visible amount and expiry (checks, escrows, channels, offers) are not excluded. Everything else follows XLS-75's `delegable` attribute; by default **a type is non-delegable** (`.delegable` absent), so `AccountSet`, `SetRegularKey`, `SignerListSet`, `AccountDelete`, `DelegateSet`, `Batch`, `FirewallSet`, `BeneficiarySet`, `WithdrawPreauth` and our two types are out of reach. Sensitive types that *are* delegable: `PasskeyListSet`, `SponsorshipSet`, `SubscriptionSet`, `CredentialCreate`, `DIDSet` (excluded), `DepositPreauth`, `Clawback`, `CredentialAccept` (eligible, D4).

**Enumeration test (case 9b)**: iterate every transaction type and assert its expected eligibility in modes A and P. Adding a delegable type without an explicit decision fails the test, so the list cannot silently fail open.

Modes A and P bound **when** the key can sign, not what the signed transactions leave behind (an escrow, check, channel or offer outlives the session). Only mode C bounds XRP that leaves the account. The product says so.

### 6.9 Constants

| Constant | Value | Notes |
|---|---|---|
| `kMaxSessionDuration` | **600 s** | D2 |
| `kPermissionMaxSize` | 10 (existing) | same as `DelegateSet` |
| `kSessionFeeMultiple` | 1000 | multiple of the base fee unit (`view.fees().base`) allowed **on top of** the required base fee; the first escalated fee level is already 500× base, so under heavy load session txs are held back and the owner uses a full-authority key |
| `kSessionMaxLedgerWindow` | 256 | |
| `kMaxSessionTxCount` | 100 000 | upper bound of `SessionMaxTxCount` |
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

**Registration to not forget**: `transResults` strings for the four `tef` codes (`src/libxrpl/protocol/TER.cpp`), the `jss` name `signing_session` and the RPC parser entry, `ltSIGNING_SESSION` in `ledger_entries.macro` with its keylet, `WitnessSignature` in `InnerObjectFormats.cpp` and the common fields, and one shared header (`include/xrpl/tx/SigningSession.h`) for the predicate used by `applySteps`, `Transactor`, `TxQ` and the invariant. `invokeCheckSession<T>(PreclaimContext const&, Keylet const&)` returns **`NotTEC`** (never `tec`).

Recompiling after any `.macro` edit is heavy: make all macro edits (amendment, fields, entry, transactions, result codes) in the first batch, before the first full build.

### 6.11 Firewall, Beneficiary, Subscription

`Firewall`, `Beneficiary` and `Subscription` are `Supported::No` in `features.macro` at `68bd02b647`; the public AlphaNet announces them as supported because its compose commit carries `force_supported: ON`. jtx can enable them (`testableAmendments()` takes every registered amendment; the upstream `Firewall_test.cpp` already runs), so cases 6 (beneficiary key), 9 (`SubscriptionSet`) and 16 (Firewall) are written in jtx. Enabling a `Supported::No` feature through `[features]` on the standalone node is **UNVERIFIED**; the demo does not need them.

### 6.12 Standalone node (`infra/`)

- `infra/standalone.cfg` with an `[amendments]` list (the genesis ledger's; `[features]` only sets the rules of unit tests) holding every amendment this build supports and does not veto, among them `Passkey`, `Quantum`, `SigningSessions`, `BatchV1_1`, `PermissionDelegationV1_1`, `fixPasskeyChallenge` (P5, §6.14) and `fixP256StrictDer` (§6.14). `feature` must list them; `server_definitions` must expose our types. Ports: a **public (non-admin)** WebSocket for the app and a separate **admin** port reserved for the ledger closer (`ledger_accept`); the app is never wired to the admin port.
- Ledger close: one process (a small `infra/closer.ts`) calls `ledger_accept` every 1-3 s. Session expiry is measured on the ledger's `parentCloseTime`: in standalone time only advances when a ledger closes.
- Genesis seed from an environment variable, never committed. Public (non-admin) WebSocket for the app.
- `infra/Dockerfile` for the node (published image is stretch).

### 6.13 Result-code matrix

| Situation | Code | Fee |
|---|---|---|
| Flag bits outside the type's mask (`SigningSessionDelete`: any bit but the universal flags) | `temINVALID_FLAG` | no |
| No / two modes, key = account, bad duration, bad permissions, bad cap, `SessionMaxPerTx` without a cap, `SessionMaxTxCount` out of range, witness = account or key | `temMALFORMED` / `temBAD_EXPIRATION` / `temARRAY_*` / `temBAD_AMOUNT` | no |
| `WitnessSignature` without the amendment | `temDISABLED` | no |
| Key already has full authority | `tecNO_PERMISSION` | yes |
| Duplicate session | `tecDUPLICATE` | yes |
| `SessionWitness` names no account | `tecNO_TARGET` | yes |
| Reserve | `tecINSUFFICIENT_RESERVE` | yes |
| Type or shape not allowed, `TicketSequence` (except own close), missing / far `LastLedgerSequence`, session tx signed by a session, outer `Batch` signed by a session key, session key of a type whose amendment (`Passkey`, `Quantum`) is off | `tefSESSION_TX_NOT_ALLOWED` | no (not included) |
| After `Expiration` (except own close) | `tefSESSION_EXPIRED` | no |
| Fee over ceiling, over remaining cap or over `SessionMaxPerTx` (mode C), `SessionTxCount` at `SessionMaxTxCount` | `tefSESSION_LIMIT` | no |
| Missing or foreign `WitnessSignature` when the session has a witness (except own close), or one by a witness key whose type's amendment is off | `tefSESSION_NO_WITNESS` | no |
| `WitnessSignature` on a transaction that needs none: not session-signed, signed under a session without a witness, or the own close (a Batch inner one: `temBAD_SIGNATURE` for the Batch) | `tefBAD_SIGNATURE` | no |
| Session-signed tx would displace a queued tx of another key | `telCAN_NOT_QUEUE_FEE` | no |
| Stranger closes a live session | `tecNO_PERMISSION` | yes |
| Missing session on close | `tecNO_ENTRY` | yes |
| Session key of another account | `tefBAD_AUTH` | no |
| Firewall blocks the destination | `tefFIREWALL_BLOCK` | no |
| Amendment disabled | `temDISABLED` | no |
| Accepted tx ending in `tec` | the `tec` | **yes**, counted in the cap in mode C |

`tem` is stateless only (a state-dependent "expiration too far" is `tec`/`tef`, not `tem`).

### 6.14 Passkey path and key formats

**Passkey in alphanet** (`featurePasskey`, Denis Angell): P-256 public key = 65 bytes `0xF6 ‖ X ‖ Y` (`PublicKey.cpp:252`); `ltPASSKEY_LIST` (one per account); `PasskeyListSet` (114 on XRPLF, 118 on Transia); `PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}` is a common **unsigned** field; the WebAuthn `challenge` is base64url of **all signed data** (`STTx.cpp:449-499`); raw ECDSA over SHA-256 of the signed data is also accepted (SHA-256 + DER, **no low-S rule**); a passkey has **full authority** (`Transactor.cpp` ~1141-1160). On XRPLF `KeyType` values are `Dilithium = 2`, `P256 = 3` (reversed on Transia): never hard-code the enum. The WebAuthn path is taken only when the key is P-256 **and** `PasskeySignature` is present; otherwise raw P-256 `verify()`. No upstream test signs a transaction by WebAuthn.

**Our node: `fixP256StrictDer`** (`Supported::Yes`, `DefaultNo`, #87, enabled in `infra/standalone.cfg`). Once enabled, a P-256 signature must be strict DER (sequence length equal to the signature's, minimal integers, nothing after S) with `0 < R < n` and `0 < S ≤ n/2`, on every transaction path a P-256 key signs: single, WebAuthn, multi-signer, `BatchSigner`, a session's witness, a payment channel claim (`PaymentChannelClaim` and `channel_verify`) and a cross-chain attestation; manifests and validator lists keep the lax form. `verify()` has no default for it, and its three-argument form refuses a P-256 key, so a caller that does not say which rules apply cannot accept a P-256 signature. The public AlphaNet does not have it. The node's own P-256 signer produces low-S signatures in every case. **Not covered:** `PasskeySignature.PasskeyID` is neither signed nor checked, so a relay can still change it, and the transaction's ID; binding it is a decision for the `Passkey` amendment (tie it to the passkey list entry, or sign it).

**P5 (defect, confirmed by the N1 test and fixed on our node)**: in `STTx.cpp` (the old comparison, kept without the fix, is now at `rippled/src/libxrpl/protocol/STTx.cpp:495-497`, the fix at `:485-494`) the challenge check compares `base64urlDecode(...)` (a `std::string`) to `uint8_t` signing data with `std::equal`; where `char` is signed (x86-64, macOS arm64) any byte ≥ `0x80` makes the comparison fail, and every challenge contains `0xF6` (the `SigningPubKey` prefix). So WebAuthn assertions may always fail on those platforms. **Plan (N1)**: write the regression test first (challenge containing a byte ≥ `0x80`) on our own node; if it fails before any change, fix by comparing two `Slice`s in a **separate `fix:` commit**; if it passes, record that in DEVLOG. Either way P5 goes in the presentation (D7). K2 on the public AlphaNet may fail depending on the validators' platform; that does not prove passkeys do not work. **Result (N1):** the test failed on the unchanged tree, where `char` is signed (SIMULATED: a software WebAuthn authenticator, `docs/DEVLOG.md` "N1"); the fix compares two `Slice`s behind the amendment `fixPasskeyChallenge` (`Supported::Yes`, `DefaultNo`, #13), which the standalone node enables (§6.12). The public AlphaNet does not have it.

**P6 (defect, VERIFIED on the public AlphaNet, 10-24): a passkey list can be neither replaced nor removed.** `SetPasskeyList::doApply` always creates a new `ltPASSKEY_LIST` entry and inserts it, with no check for an existing one in `preclaim`, and no transaction deletes the list. A second `PasskeyListSet` on the same account fails with `tefEXCEPTION` (first `8AC8B117A6553BDB7D33BC86150A5A1FAC8BFB190B81DD9FB7CCB81ADB45484A` `tesSUCCESS`, second `A3E31459618DB5BB463F3708B26D660087599847D15F168192C79862E4C12D3A` `tefEXCEPTION`; the list keeps the first key only). Consequences: no rotation of a passkey (its P-256 public key is on the ledger from registration, so rotation is the only way to limit quantum exposure), **no revocation of a lost or stolen device**, which keeps **full authority** on the account; every passkey of an account must be in its first and only `PasskeyListSet` (see L6). A `Batch` does not help: each inner `PasskeyListSet` hits the same insert. Fix, if the team decides to carry it (D7 says presentation only): in `doApply`, replace the `Passkeys` array of an existing entry instead of inserting, and allow removal (an empty list, or a delete transaction, updating the owner count); in a separate `fix:` commit with its test, like P5. **Decision needed (Sofiane)**: carry the fix in our node for W2, or keep it for the presentation only.

**Key and signature formats**

| Key | Public key | Signature |
|---|---|---|
| Session key of a Mac account (P-256, WebCrypto non-extractible) | 65 bytes `0xF6 ‖ X ‖ Y`; `SessionKey` = `RIPEMD160(SHA256(pubkey))` | ECDSA-SHA256 over `encodeForSigning(tx)` (prefix `STX\0`), WebCrypto `r‖s` → **low-S** → **strict DER** → `TxnSignature` |
| Session key of a Ledger account (ML-DSA-44, generated in the client by `@noble/post-quantum` 0.7.1, D13) | 1 312 bytes, no prefix; `SessionKey` = `RIPEMD160(SHA256(pubkey))` over the 1 312 bytes | 2 420 bytes; **pure** ML-DSA-44, empty context, randomized, over `encodeForSigning(tx)` (prefix `STX\0`) → `TxnSignature` |
| Passkey | same 65-byte format; `SigningPubKey` = passkey key | `navigator.credentials.get` with `challenge` = signed data; also **normalize `PasskeySignature.Signature` to low-S, strict DER** (not in the signed data; required once `fixP256StrictDer` is enabled, accepted high-S without it) |
| ML-DSA-44 root key (on the device) | **1 312 bytes, no prefix** | 2 420 bytes; **pure** ML-DSA, empty context, randomized; the node runs `crypto_sign_verify(sig, m = full signing data, ctx empty)`, i.e. `M' = 0x00 ‖ 0x00 ‖ M`. Account derivation from an XRPL seed is non-standard (no `k ‖ l` domain): irrelevant, the device derives its key with SLIP-21 (§7.7) and the client generates session keys from a random seed |
| secp256k1 / Ed25519 | standard | standard |

`Quantum` / ML-DSA keys need no amendment gating for ordinary signatures; the only use of `featureQuantum` in the tree is the session key-type check of §6.5 (an ML-DSA-44 session key cannot sign while `Quantum` is off, nor a P-256 one while `Passkey` is off). `ForceQuantum` does not exist on alphanet and was withdrawn by its author; we do not build it.

**ML-DSA-44 session keys (D14).** The amendment accepts them with no code specific to their key type: every step it relies on is generic in the imported tree (cited at `develop` `695e6df`, whose `rippled/` is the import plus the P5 fix and the jtx WebAuthn helper, #12 and #13).

| Step | Code |
|---|---|
| Preflight refuses an unknown key type with `temBAD_SIGNATURE` | `rippled/src/libxrpl/tx/Transactor.cpp:131-140` |
| A 1 312-byte key is typed `KeyType::Dilithium` by its size alone, the size of ML-DSA-44 (the build asserts 1 312), and fits the key buffer | `rippled/src/libxrpl/protocol/PublicKey.cpp:236-256`, `rippled/src/libxrpl/protocol/SecretKey.cpp:77`, `rippled/include/xrpl/protocol/PublicKey.h:61-66`, `rippled/src/libxrpl/protocol/PublicKey.cpp:206-212` |
| The AccountID of any key is `RIPEMD160(SHA256(all its bytes))`, so `SessionKey` is derived the same way for ML-DSA-44 | `rippled/src/libxrpl/protocol/AccountID.cpp:148-156`, `rippled/include/xrpl/protocol/digest.h:123-146` |
| A single-signed transaction signs `STX\0` and its fields, before and after role-based prefixes | `rippled/src/libxrpl/protocol/Sign.cpp:54-73`, `rippled/src/libxrpl/protocol/STTx.cpp:262-281` |
| Only a P-256 key with `PasskeySignature` takes the WebAuthn branch; any other key goes to `verify` | `rippled/src/libxrpl/protocol/STTx.cpp:524-548` |
| `verify` checks ML-DSA-44 as pure ML-DSA with an empty context over the whole message, and `sign` makes it the same way; jtx signs through `sign` | `rippled/src/libxrpl/protocol/PublicKey.cpp:450-477`, `rippled/src/libxrpl/protocol/SecretKey.cpp:366-373`, `rippled/src/test/jtx/impl/utility.cpp:52-58` |
| The signer's AccountID in the authorization step, which the session predicate computes the same way | `rippled/src/libxrpl/tx/Transactor.cpp:1021-1028` |
| The base fee depends on neither the key type nor the size | `rippled/src/libxrpl/tx/Transactor.cpp:459-483` |
| No local check limits the size of the key or the signature | `rippled/src/libxrpl/protocol/STTx.cpp:956-984` |

**UNVERIFIED**, each with the test that settles it (case 20, N4):

1. The node accepts a transaction single-signed by an ML-DSA-44 key. The public AlphaNet has accepted payments signed on the Stax this way (`docs/DEVLOG.md`, the post-quantum root entries), but no test of our tree shows it: the only upstream test that signs one asserts a duration, not the verdict (`rippled/src/test/app/STTXSigning_test.cpp:46-73`). Test: with jtx accounts of `KeyType::Dilithium` (`rippled/src/test/jtx/impl/Account.cpp:44-61`, keys derived from a seed at `rippled/src/libxrpl/protocol/SecretKey.cpp:609-619`), a Ledger account (`RegularKey` an ML-DSA-44 key, master disabled) opens a session signed by that key, then an ML-DSA-44 session key signs a `Payment`: both `tesSUCCESS`, and the entry's `SessionKey` is `calcAccountID` of the session public key.
2. The refusals next to it, each with its code: the same session key signing for another account gets `tefBAD_AUTH` (case 15). A corrupted signature, and a 1 312-byte `SigningPubKey` that is not a key (the type is read from the size only), fail the signature check: `submit` answers `invalidTransaction`, "fails local checks: Invalid signature." (`rippled/src/xrpld/rpc/handlers/transaction/Submit.cpp:105-112`), which jtx reports as `telENV_RPC_FAILED`, and preflight would return `temINVALID` (`rippled/src/libxrpl/tx/Transactor.cpp:337-342`). Three more cases: the own close signed by an ML-DSA-44 session key succeeds; a `SessionKey` equal to the ML-DSA-44 `RegularKey` gets `tecNO_PERMISSION` (§6.3); an opening signed by the disabled classical master key gets `tefMASTER_DISABLED` (`rippled/src/libxrpl/tx/Transactor.cpp:1136-1139`).
3. The fee ceiling (§6.5, rule 4) applies to an ML-DSA-44 session transaction as to a P-256 one (case 13).
4. No node has yet accepted a signature made by `@noble/post-quantum`: the AlphaNet payments above were signed on the device. Test: a fixed key, message and signature from `@noble/post-quantum` 0.7.1 checked by rippled's `verify` (a vector in the jtx suite), then spike K3 on the AlphaNet.
5. The client derives the same `SessionKey` as the node: a `packages/core` test (W1) compares `RIPEMD160(SHA256(pubkey))` of a fixed ML-DSA-44 key with the AccountID the node computes for it.
6. Our node accepts a `SigningSessionSet` signed on the Stax by the ML-DSA-44 key (W3, W7). The device track has signed one in mode P and did not submit it, since no node had the amendment yet (`docs/DEVLOG.md`).

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
| 13 | **Fee drain**: session-signed `SigningSessionDelete` for another key / a missing session rejected with no fee; a loop of rejects leaves the balance unchanged; `Fee` above `calculateBaseFee × 1000` is `tefSESSION_LIMIT` in every mode; the own close above its base fee is `tefSESSION_LIMIT`; in mode C a `Fee` above the remaining cap too; a mode-P session limited to `TicketCreate` cannot burn the balance; `AMMCreate` and `LedgerStateFix` in mode A pass the ceiling; a session-signed payment using `TicketSequence` is `tefSESSION_TX_NOT_ALLOWED` and leaves the ticket, the own close by ticket applies |
| 14 | A session key with `Signers`, `Delegate`, `Sponsor`, as a `CounterpartySignature`, or as a Batch inner signer: never session-authorized (falls to the ordinary signature check: `tefBAD_AUTH`) |
| 15 | One account's session key signing for another account: `tefBAD_AUTH` |
| 16 | Firewall (enabled explicitly in jtx): blocked destination `tefFIREWALL_BLOCK` |
| 17 / 17b | Session key later set as `RegularKey`: stays bounded (`SetRegularKey` signed by it `tefSESSION_TX_NOT_ALLOWED`), full authority after deletion; missing or far `LastLedgerSequence`: `tefSESSION_TX_NOT_ALLOWED`; sponsored tx / Batch inner signature by a key that is both follow existing rules (documented limitation) |
| 18 | Owner closes; session key closes (also after expiry, and in mode C with remaining cap < `Fee`: exempt from cap but not from the fee ceiling); stranger closes live: `tecNO_PERMISSION`; stranger closes expired: `tesSUCCESS`; missing: `tecNO_ENTRY`; `Owner == Account`: `temMALFORMED` |
| 19 | `AccountDelete` with sessions present deletes them |
| 20 | Session key types: P-256 (raw, low-S, strict DER), Ed25519, secp256k1, ML-DSA-44 (1 312-byte key, 2 420-byte signature). ML-DSA-44 is MVP (D14): a Ledger account opens a session signed by its ML-DSA-44 `RegularKey`, an ML-DSA-44 session key signs, the own close by an ML-DSA-44 session key, and the refusals of §6.14 with their codes (another account `tefBAD_AUTH`; a corrupted signature or a 1 312-byte value that is not a key refused by the signature check, `invalidTransaction`; `SessionKey` = the ML-DSA-44 `RegularKey` `tecNO_PERMISSION`; an opening signed by the disabled master `tefMASTER_DISABLED`) |
| 21 | Invariants: each rule of §6.7 has a test that mutates the view to violate it and expects the invariant failure result of the pass (`tecINVARIANT_FAILED`; `tefINVARIANT_FAILED` when the reset pass fails too), modelled on `InvariantsBeneficiary_test` |
| 22 | TxQ: a queued session-signed payment whose session expires or is deleted is dropped; the owner's queued close is displaced by a session-signed payment neither at twice the base fee nor at the ceiling |
| 23 | Accounting paths: `tecNO_DST_INSUF_XRP` (from preclaim), a `tec` from `doApply`, and the `tecINVARIANT_FAILED` reset path each leave `SessionSpent` equal to the fee (or fee + amount on success), invariant satisfied |
| 24 | `ledger_entry` (by account+key and by index) and `account_objects`; sponsorship decision (§6.10) taken in N2; `nonObligationDeleter` entry; pseudo-accounts rejected |
| 25 | `SessionMaxPerTx`: without a cap `temMALFORMED`; 0, negative, IOU or above the cap `temBAD_AMOUNT`; one drop above it `tefSESSION_LIMIT` with no fee; exactly at it `tesSUCCESS` |
| 26 | `SessionWitness`: the account or the key `temMALFORMED`; a missing account `tecNO_TARGET`; no co-signature or one by another account `tefSESSION_NO_WITNESS` with no fee; co-signed by the witness's master key, then by its `RegularKey`: `tesSUCCESS`; by its master key once disabled: `tefSESSION_NO_WITNESS`; the own close needs none; `WitnessSignature` on any transaction without the amendment `temDISABLED`; a `WitnessSignature` where none is needed (a transaction signed by the master key or the `RegularKey`, multi-signed, by a delegate, a Batch, a session without a witness and its own close, the own close of a session with one even co-signed by the witness) `tefBAD_SIGNATURE` with no fee, and on a Batch inner transaction `temBAD_SIGNATURE` for the Batch; a P-256 or ML-DSA-44 witness key with `Passkey` or `Quantum` off `tefSESSION_NO_WITNESS`; a witness left with a SignerList only co-signs nothing, and its session signs only its own close |
| 27 | `SessionMaxTxCount`: 0 and `kMax + 1` `temMALFORMED`; `tes` and `tec` count in every mode; at the bound `tefSESSION_LIMIT` with no fee; the own close still passes |
| 28 | Batch (suite `SigningSessionsBatch`): the owner opens, pays and revokes sessions inside a Batch; a session key as outer signer `tefSESSION_TX_NOT_ALLOWED`, as `BatchSigner` `tefBAD_AUTH`; a session-signed transaction with `tfInnerBatchTxn` refused |

Upstream suites `Delegate`, `PasskeyListSet`, `AccountDelete`, `PassKey` green before and after, without any test removed. A moved delegable-type counter is re-pinned with justification in the commit (the Transia base already fails it: 73 vs 67 expected).

---

## 7. Ledger application

### 7.1 Facts about the base and the device

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

**Screen lines to freeze (before the first device test)** — a list of lines, labels and formatters, not a mockup:

```text
Transaction type   Open session           (name of type 130)
Account            rAlice…                (full address)
Session key        rSess…                 (full address)
Valid for          10 minutes             (duration formatter)
Fee                12 drops               (as for every transaction)
Allows             All transactions       (mode A, flag formatter)
                   Payment, OfferCreate   (mode P, one line per permission)
Max spend          20 XRP                 (mode C)
Allows             XRP payments only, fees included   (mode C, synthetic line)
Note               Cannot change keys or signers      (synthetic line; precedent in the parser)
```

**Tests**: cmocka with ≥ 10 vectors (one per mode, 10 permissions, unknown permission → blind required, unknown flag, truncated, duplicate), distinct values per field (not the same account everywhere), fuzzing without crash; Ragger snapshots generated for **all devices the CI lists**; **one session opened on the node and signed on the Stax** (acceptance).
**Multisign / Batch**: a `Batch` signed in multisign mode (`SMT\0`) gives an invalid signature; test with a real Batch vector when L3 is attempted.

### 7.4 Other device items

**L2: ML-DSA-44 on the device** is the headline and is specified in [§7.7](#77-post-quantum-root-on-the-device-l2).

**L6: a P-256 key on the device usable as a passkey** (idea to validate on the device). Add `secp256r1` to `CURVE_APP_LOAD_PARAMS` and a new P2 value (proposed `0x20`; **UNVERIFIED**); sign `SHA-256(signed data)`, return DER, **normalize to low-S**; public key `0xF6 ‖ X ‖ Y`. The node already accepts a raw P-256 signature (no `PasskeySignature`) then looks the key up in the `PasskeyList`, so no node change is needed. The device key and the Face ID key must be in the **same first** `PasskeyListSet` of the account (one `PasskeyListSet` per account). Alternative with no Ledger code: the **Ledger Security Key** FIDO2 app as a WebAuthn authenticator (Stax and Flex), which is **blind** (shows the domain only) and depends on P5. Acceptance: a transaction signed on the device by a key listed in the `PasskeyList` is accepted.

**L3: `Batch` clear signing.** `master` forces blind on a nested type and follows one array level; 8 inner transactions of ~10 fields exceed `MAX_FIELD_COUNT` (60). **L4**: documentation feedback is **MVP** and specified in [§7.6](#76-documentation-and-developer-experience-feedback); a `packages/ledger` library on the DMK (`previewSession`, clear / blind / refuse prediction) is stretch. **L5**: `BatchSigner` co-signature (`BCH\0`).

### 7.5 Open device questions (to answer in L0)

Loading route on this Stax; whether the device shows an "unsafe app" prompt or needs a developer mode; behaviour of the genuine check in Ledger Live (the loading routes do not depend on Ledger Live); how the 10 permission lines paginate on the Stax screen.

### 7.6 Documentation and developer-experience feedback

Ledger's bounty judging criteria are explicit: **"We judge the Developer Experience feedback as much as the code. Help us improve our docs."** It asks for three things, and lists three bonus items. We treat all of it as a deliverable with the same standing as L1, not as an afterthought written at the end.

| Asked ("What to include") | What we deliver |
|---|---|
| Feedback on the overall experience using Ledger docs and SDKs | One overall section per area we touch: app-xrp and the C SDK (build, `ledger-app-builder`, loading on a Stax), clear signing for a new transaction type, ML-DSA in `ledger-secure-sdk`, the Device Management Kit and `device-signer-kit-xrp`, the XRPL workshop and `developers.ledger.com/xrplnyc` |
| Gaps, confusing flows, or missing context | Each finding is an entry in the log with the page or file, what we expected, what happened, and the time it cost us |
| Specific improvements with screenshots or PRs | Every entry carries a screenshot or a proposed text; where we can, a **pull request** to the documentation or sample repository (the DMK docs live in `LedgerHQ/device-sdk-ts`, `apps/docs`; the SDK and app templates in their own repositories) |

| Bonus point | Our plan |
|---|---|
| Better tutorial or code sample ideas | A written tutorial outline "clear-sign a new XRPL transaction type on a Ledger app" built from what L1 actually required (the checklist of §7.3 is already that tutorial in embryo), and a minimal sample for sending a custom transaction through the DMK |
| Navigation or search improvements for the portal | Record, as we search for things, what we typed, what we expected to find, and where it was (or was not) |
| "Time-saver" suggestions for future integrators | A short list at the top of the document: "if we had known this at the start, we would have saved N minutes" (loading an app on a Stax from a Mac, the `STX\0` prefix added by the app, `MAX_ARRAY_LEN`, `has_unknown_flags`, deterministic ML-DSA keygen, SLIP-21 install parameter) |

**Method.**
1. **Start the log at the start of the work**, in `docs/ledger-dx-feedback.md`, and append during the work, not afterwards: a finding that is not written down when it happens is lost. One line is enough at the time; it is cleaned up later.
2. Entry template: `date/time · area · doc page or repo path · what we tried · what happened or was missing · minutes lost · suggested fix · screenshot / PR link`.
3. Keep `minutes lost` honest: it is the evidence that makes feedback useful, and it must not be inflated.
4. Capture screenshots as we hit the problem (the Stax screen showing "cannot be clear-signed", the build error, the page that did not help).
5. Turn the best findings into pull requests while the details are fresh; link them from the document. A PR is stronger than a paragraph.
6. Final structure of `docs/ledger-dx-feedback.md`: top "time-savers"; overall experience per area; gaps and confusing flows (the log, cleaned); proposed tutorial and sample ideas; portal navigation and search notes; list of PRs and screenshots.
7. The README links to the document, and the pitch has a slide with the three best findings and the PR links (§11).

**Things we already know are likely to appear** (to confirm while doing them, not to pre-write): loading a custom app on a Stax from macOS when the builder image cannot reach USB; the README of `ledgerctl` not listing the Stax; which of the three loading routes works; clear signing for a transaction type the app does not know (the L1 checklist spans parser, fields, flags and display limits, and a miss falls back to blind signing without an error); `MAX_ARRAY_LEN`; the app adding the signing prefix itself; ML-DSA deterministic key generation existing only behind an internal header; the SLIP-21 install parameter; the DMK send-APDU API for custom commands.

### 7.7 Post-quantum root on the device (L2)

**Goal.** The Stax generates and holds an **ML-DSA-44** key, shows the transaction in clear, and signs it. Concretely, on a public network that accepts ML-DSA keys (the AlphaNet today), with an account whose master key is the Stax's classical key: (1) `SetRegularKey` to the device's ML-DSA key, signed by the master key and clear-signed; (2) a proof transaction signed by the ML-DSA key on the device, which is the first post-quantum device signature; (3) `AccountSet asfDisableMaster`, **signed by the master key** (the node answers `tecNEED_MASTER_KEY` if the regular key signs it); then (4) a session opened by the ML-DSA key with the rules on the screen. Afterwards no classical key can sign for the account. Ledger states that the pre-hash ML-DSA variant does not fit clear signing; this design uses **pure ML-DSA over the fully buffered message**, which is what clear signing needs (the app parses and displays the same bytes it signs).

**Signing.** `MLDSA_sign` (pure, empty context) over `STX\0 ‖ signed fields`, as `crypto_sign_verify` expects on the node (`M' = 0x00 ‖ 0x00 ‖ M`). The host sends these bytes, prefix included: the app checks the prefix, runs the rest through its own parser so that the review shows the decoded transaction, and signs the whole message (`ledger-app/src/pq/pq_root.c:172-206`, from the device track). On the classical path the app adds the prefix itself (§8.4). Signing is randomized and may retry internally.

**Key derivation.** A key derived deterministically from an app-scoped **SLIP-21** seed through `MLDSA_internal_keygen` (the internal API of `lib_cxng/src/cx_mldsa_internal.h`; validated in spike K4), so the key is recoverable from the 24 words. **Never** reuse a BIP32 secp256k1 private key as ML-DSA seed. If the key cannot be derived from the seed, say so: it would live in the app's NVRAM and not be recoverable with the 24 words. The device track derives it with the SLIP-21 label `carbs ML-DSA-44` and takes the last 32 bytes of the node as the FIPS 204 seed (`ledger-app/src/pq/pq_root.c:4-8`, `:55-56`); `docs/DEVLOG.md` records the key as stable across reinstalls.

**Protocol with the host.** Three new instructions, from the device track (`ledger-app/src/pq/pq_root.h:12-23`; the P2 byte of `INS_SIGN` accepts only `0x40` / `0x80`): `0x10` returns the public key in 250-byte chunks (P1 = chunk index, 6 chunks; chunk 0 derives the key, `ledger-app/src/pq/pq_root.c:97-106`); `0x11` receives the signing data in chunks (P1 `0` first, `1` next; P2 `0` more, `1` last; the review follows the last chunk, and its answer is the signature length in 2 bytes, big-endian, `ledger-app/src/pq/pq_root.c:164-166`); `0x12` returns the signature in 250-byte chunks (P1 = chunk index, 10 chunks). The signing data is at most 2 048 bytes, the 1 312-byte `SigningPubKey` included (`PQ_MAX_MESSAGE`, `ledger-app/src/apdu/global.h:71`); a longer message gets `0x6700` (`ledger-app/src/pq/pq_root.c:222-225`). These numbers are binding for the client (§8.4). Status words (`ledger-app/src/pq/pq_root.c:48-54`): `0x6985` the user refused, or the transaction needs blind signing and it is disabled in the settings (as on the classical path), `0x6A80` a bad prefix, a transaction the parser refuses, an `0x11` chunk while the review is on screen, or reviewed bytes that changed before the approval, `0x6B00` a bad P1, P2 or chunk index, `0x6700` a message over 2 048 bytes, `0x6982` no signature to read, `0x6F00` an internal error, including a failed signature (`:159-163`). The app clears the transaction context, `tmp_ctx`, whenever the instruction changes (`ledger-app/src/apdu/entry.c:40-42`, `ledger-app/src/apdu/global.c:30-32`), so a client must not interleave other instructions in an `0x11` sequence (one during the review cancels it: the approval then signs nothing); the signature buffer lives outside `tmp_ctx` and survives the switch to `0x12`. The post-quantum path is built for Stax, Flex and Apex P only (`ledger-app/Makefile:40-45`). Sent as custom commands through the Device Management Kit.

**Build.** Makefile: `PATH_SLIP21_APP_LOAD_PARAMS = "<label>"` (a single path; see `Makefile.app_params` of the SDK), the `lib_cxng` ML-DSA sources, `HAVE_MLDSA_OPTIMIZATION`, `INCLUDES_PATH` to `lib_cxng/src` (model: `ledger-app-zond`, which signs a 32-byte hash with an 8-byte context, unlike us).

**Memory (Stax SRAM 36 KB, stack included; Ledger's design target is at most 16 KB of peak stack).** The statics of app-xrp are about 21 KB (`raw_tx` 10 000 B, eight 1 024 B field strings, the parse result), which with 16 KB of stack exceeds the SRAM. So the post-quantum signing path uses a **build variant with smaller buffers** (candidates: `MAX_RAW_TX` to about 3 000 B, `MAX_FIELD_LEN` to 256 B, no `ENABLE_SWAP`, no `HAVE_IO_U2F`, no BLE stack), which is enough for key management and session transactions (small, few fields). Estimates, to be measured in K4 inside an app-xrp build, not a throwaway app: ML-DSA-44 signing about 7.2 KB of working set with the low-RAM variant (11.7 KB without), plus the secret key 2 560 B and the signature 2 420 B.

**Security notes.** Ledger's v1 ML-DSA has **no side-channel or fault-injection countermeasures** (their own statement): we say so wherever we describe the root key. The device screen proves the rules, not who holds the session key.

**Acceptance.** A signature made on the device is accepted by `xrpld` **and** verified by `@noble/post-quantum`; the four transactions above are on the AlphaNet with explorer links; the screen lines for `SetRegularKey` and `AccountSet` are in the DEVLOG with photos. **Fallback** (K4 fails): software ML-DSA signing in the client, said as such, with everything else unchanged.

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
| `keys/p256-session.ts` | Mac-account session key: `createSessionKey()` WebCrypto non-extractible (IndexedDB), public key `0xF6‖X‖Y`, account id, `sign(bytes)` |
| `keys/passkey.ts` | `createPasskey`, `getAssertion(challenge)`, build `PasskeySignature`, normalize its signature |
| `keys/mldsa.ts` | Ledger-account session key: a fresh ML-DSA-44 key per session with `@noble/post-quantum` 0.7.1 (kept in memory only), public key 1 312 B, account id `RIPEMD160(SHA256(pk))`, `sign(encodeForSigning(tx))`; also verifies the device's signatures as a cross-check |
| `session.ts` | `buildSessionSet({account, mode, durationSec, permissions?, capDrops?, sessionKey})`, `buildSessionDelete(...)`, always sets `LastLedgerSequence` |
| `node.ts` | JSON-RPC / WebSocket client (non-admin), `submit`, `account_info`, `ledger_entry` `signing_session`; surfaces the node's exact result code |
| `errors.ts` | decoded `tef` / `tec` / `tem` with the node's code string, never a simulated message; knows the four new `tefSESSION_*` codes (UI text + the rule that produced them) |

A single command runs the whole flow against a real node (acceptance of W1).

### 8.3 Signing details

- Mac-account session key: `crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign'])`, signing with `{name:'ECDSA', hash:'SHA-256'}`; the raw public key export starts with `0x04`, replace it by `0xF6`; signature `r‖s` (P1363) → DER, **low-S**; `TxnSignature` = DER hex.
- Ledger-account session key: `ml_dsa44.keygen` of `@noble/post-quantum` 0.7.1 with a fresh random seed; pure ML-DSA-44 with an empty context over `encodeForSigning(tx)`; `SigningPubKey` = the 1 312-byte public key, `TxnSignature` = the 2 420-byte signature. WebCrypto has no ML-DSA, so the secret key is page memory and **extractable** (§12).
- Every session transaction carries `LastLedgerSequence` ≈ +150 ledgers (with 1-second ledgers +20 is 20 s: too short for a device prompt, `tefMAX_LEDGER`). A queued-on-server design is avoided: state comes from `account_info`, and the same tx is resent until its `LastLedgerSequence` passes. Identify transactions by `(Account, Sequence)`, not by hash, while P-256 malleability exists.
- **A fresh key per session**: the 256-ledger window can exceed the 600 s lifetime, so a held transaction signed for one session could otherwise land under a later session opened with the same key.
- Expiration is the only stop: **no heartbeat or auto-revoke** that closes a session after 90 s of silence (sleep, suspended tab).

### 8.4 Ledger integration (DMK)

- Transport WebHID. `device-signer-kit-xrp` 0.3.0 is used for public key retrieval and for signing: spike K6 signs a `Payment` testnet on the unmodified app, then a `SigningSessionSet` once L1 exists (raw bytes are forwarded, so a classical device key needs no custom APDU). L2 adds the instructions `0x10` to `0x12` of §7.7, which a Ledger account uses for every signature (D13), and L6 a P2 value; both are sent as **custom APDUs** with the DMK (`dmk.sendApdu({ sessionId, apdu })` / `dmk.sendCommand({ sessionId, command })` per the DMK 1.11 typings; confirm in K6).
- The kit names the app "XRP": use `skipOpenApp` if the sideloaded app is renamed.
- Open flow (W3) with a classical device key: build `SigningSessionSet` → serialize with `encode(tx)` (`SigningPubKey` set to the device key, no `TxnSignature`, **no `STX\0` prefix**: app-xrp prepends `STX\0` / `SMT\0` itself, `sign_transaction.c`) → the kit forwards the bytes and chunks them to the device → the Stax shows the rules → the user approves → signature returned → assemble and submit. The signer is the account's own **full-authority key** (master or `RegularKey`): this is an ordinary single signature, **not a multisig** and no signer list is involved.
- Open flow on a **Ledger account** (D13): the signer is the `RegularKey`, the device's ML-DSA-44 key, and `SigningPubKey` is its 1 312-byte public key (read with `0x10`). The client sends `encodeForSigning(tx)`, **with** the `STX\0` prefix, through `0x11` (at most 2 048 bytes); the Stax shows the rules from the same parse; the 2 420-byte signature is read with `0x12` (§7.7). The session key it authorizes is the client's fresh ML-DSA-44 key.
- No admin key in the browser, ever, not even for the demo: it is on the Ledger.

### 8.5 `apps/web`

| Screen | Content |
|---|---|
| **Account** | the two profiles (D13): **Ledger account** (`RegularKey` = the device's ML-DSA-44 key, `asfDisableMaster`, **never a passkey**; set up by the migration of §8.7) and **Mac account** (master key and a passkey: passkey creation, `PasskeyListSet`); state |
| **Session** | mode (A / P / C), duration (10 min), permissions or cap; **Open** (on the Stax for a Ledger account, by the passkey for a Mac account); countdown; spent / cap bar; Close |
| **Actions** | 5-6 ready actions of different types (payment, `OfferCreate`, `TrustSet`, `TicketCreate`, mint, …) signed by the session key, with the node's result code |
| **Attack** | replays with the session key: `SetRegularKey`, `PasskeyListSet`, `AccountSet`, `SigningSessionSet`, cap overflow, after expiry; each refusal is **the node's code**, never a client-side message |

Principles: account state comes from the node, not local state; errors show the code and one sentence; public (non-admin) WebSocket; CSP `script-src 'self'`. Face ID needs an HTTPS origin and `wss://`; Touch ID on the Mac works on `localhost`. Decide which one the demo uses before the demo; the script says "passkey" and chooses at the last moment.

**Ledger-account note**: a passkey list cannot be updated or deleted in this alphanet build (P6), so an account that ever had a passkey cannot become a Ledger account. A Ledger account starts as a **fresh account**. A Mac account opens sessions by passkey only on a node with `fixPasskeyChallenge` (P5, §6.14).

**Passkey wallet** (a Mac account whose master key is then disabled; added with the client, recorded in `docs/DEVLOG.md`): `buildPasskeyWallet` in `packages/core` runs, outside any session, (1) `PasskeyListSet` with every passkey of the account, signed by the master key; (2) a proof `AccountSet` signed by a passkey through WebAuthn, and nothing further if it is not accepted; (3) `SetRegularKey` to the blackhole address `rrrrrrrrrrrrrrrrrrrrBZbvji`, signed by the master key, because `asfDisableMaster` needs an alternative key and the passkey list is not one (`rippled/src/libxrpl/tx/transactors/account/AccountSet.cpp:315-318`, `tecNO_ALTERNATIVE_KEY`), while `SetRegularKey` only refuses the account itself (`rippled/src/libxrpl/tx/transactors/account/SetRegularKey.cpp:43-48`); (4) `asfDisableMaster`, signed by the master key, refused by the client unless step 2 was validated. Afterwards every transaction, session openings included, is signed by a passkey, which keeps full authority (`rippled/src/libxrpl/tx/Transactor.cpp:1141-1158`). Such an account is never post-quantum and never a Ledger account. A WebAuthn passkey cannot be a signer of a signer list: multi-signing never reads the passkey list (`rippled/src/libxrpl/tx/Transactor.cpp:1187-1340`) and the `Signer` object has no `PasskeySignature` (`rippled/src/libxrpl/protocol/InnerObjectFormats.cpp:21-27`).

### 8.6 Client tests

Vitest unit tests for `core` (encoding vectors, low-S/DER, session builders, constants), an end-to-end `tsx` test against a real standalone node (stretch W8), and a test that every session transaction carries a `LastLedgerSequence`.

### 8.7 Quantum exposure check and migration

A public key is only visible on the ledger once something has signed with it. From that moment a future quantum computer could forge signatures for it. XRPL can rotate keys without changing the address, so exposure is fixable per account. This module tells a user where they stand and prepares the move. The method follows the public audit cited in the TL;DR, which is context only: the tool reports **per-account results** and never republishes totals.

**`checkExposure(address, node)`** (in `packages/core/src/quantum/exposure.ts`) returns a status (`exposed`, `no-exposure-found`, `unknown`), the reasons, and the transaction that first revealed each key:
1. **Master key.** Exposed if a validated transaction with `Account` = the address has a `SigningPubKey` whose AccountID equals the address. A non-empty `SigningPubKey` alone proves nothing: it may be the regular key, a passkey or the beneficiary key, so compare `calcAccountID(SigningPubKey)` with the address and attribute the exposure to the right key.
2. **Regular key.** Exposed if it has signed a transaction for this account. A key revealed only while signing for *other* accounts does not appear in this account's history (signers are not affected nodes), so say so.
3. **Authorities that survive `asfDisableMaster`**, reported separately because disabling the master does not remove them: the passkey list (public keys are stored on the ledger, so exposed by construction; a passkey has full authority), the beneficiary key, XLS-75 delegates (they sign with their own keys), and signer lists.
4. **Signer list.** Exposed when the signers whose public keys have appeared on the ledger carry a total weight of at least the quorum; below the quorum it is not. A signer is an account that signs with **its own master or regular key**; its own signer list plays no part.
5. **Other places a key appears**, such as `PaymentChannelCreate.PublicKey`, are listed when found.
6. **`unknown` is a result.** `no-exposure-found` is only claimed when the node's history covers the account (check the `ledger_index_min` the node returns; most nodes keep partial history) and the search was not cut short (bound it and report "not found within N pages").

Edge cases are tests, not prose: pseudo-accounts, tickets, a regular key shared by several accounts, a passkey that signed, a signer that is itself a multi-signed account.

**`buildPqMigration(account, mlDsaKey)`** returns the ordered, unsigned transactions, and the order is not negotiable:
1. `SetRegularKey` with the AccountID of the ML-DSA key, **signed by the master key** (the ML-DSA key cannot sign before it is the regular key: the node answers `tefBAD_AUTH`).
2. A proof transaction (a harmless `AccountSet` with no change, or a `TicketCreate`) **signed by the ML-DSA key**. If it is not accepted, stop.
3. `AccountSet` with `asfDisableMaster`, **signed by the master key** (only the master key can set it: `tecNEED_MASTER_KEY` otherwise).

**Safety rules.** Step 3 is refused unless (a) step 2 was accepted, (b) the ML-DSA key is proven recoverable (derived twice from the seed on the device, including after reinstalling the app) or a post-quantum backup exists (for example a signer list), because losing the key after step 3 locks the account for good, and (c) the other authorities of rule 3 above were reviewed. The migration runs only on a network whose build accepts ML-DSA keys, checked **by trying on a throwaway account (spike K3), not by an amendment name** (`featureQuantum` gates only ML-DSA-44 session keys, §6.5, not ML-DSA signatures); elsewhere it reports readiness and stops. Tests use fresh accounts only.

**Screen "Quantum"** (`apps/web`): paste an address, see the report with the first-exposure transaction of each key, then **Migrate with the Ledger** (three clear-signed steps on the Stax) on the AlphaNet. Mainnet is read-only.

**UNVERIFIED.** How many `account_tx` pages a busy account needs (K7); the exact shape of the proof transaction that the node accepts from an ML-DSA regular key; whether a passkey list can coexist with this migration (it keeps full authority).

### 8.8 Ecosystem contributions

**A Device Management Kit adapter for `xrpl-connect`** (XRPL Commons). Their Ledger adapter (`packages/adapters/ledger`) uses the legacy ledgerjs stack (`@ledgerhq/hw-app-xrp`, `hw-transport-webhid` and `webusb`), plain `signTransaction`, no preview. A new package `packages/adapters/ledger-dmk` implements `WalletAdapter` on `@ledgerhq/device-management-kit`, `device-signer-kit-xrp` and `device-transport-kit-web-hid`; keeps the legacy adapter untouched; adds `previewSignature(tx)` (`clear`, `blind` or `refused`, from the app version and a table of clear-signed types) and session opening when the node advertises `SigningSessions`. Process (their CONTRIBUTING and `docs/guide/adapter-integration.md`): open an issue first, **fork** the repository, Node 20.19+/22.18+/24.11+, pnpm 10.18.3, Vite+ (`pnpm exec vp install`, `vp run test`, `vp check`), scoped conventional commits (`feat(adapter-ledger-dmk): ...`). **UNVERIFIED**: the exact `WalletAdapter` interface and event contract (read `packages/core` and the Xaman reference adapter first), and whether the maintainers prefer a replacement or a sibling package.

**`@carbs/sessions`** (`packages/core`): the library of §8.2, installable, with typed errors including the four `tefSESSION_*` codes.

**A sessions template for `create-xrp`** (scaffold-xrp generates a Next.js or Nuxt app with `xrpl-connect`; it is a generator, not a repository to fork): a Session page next to the payment form. Contribution path: `packages/create-xrp` of `XRPL-Commons/scaffold-xrp`. The front of carbs itself starts from the generated Nuxt template ([ADR 0007](docs/adr/0007-front-from-create-xrp.md)); WebAuthn, WebHID and WebCrypto are client-only (`ssr: false`).

**No agent scene (D16).** D6 reserved an agent that pays invoices with a mode-C session key; D16 drops it, and nothing in this specification depends on it.

---

## 9. Spikes (K1-K8)

Run against the public AlphaNet (`Passkey` and `Quantum` enabled) **with a new account per attempt**. Use a fresh account for every attempt. Always sign on the client (never through the node's `sign` RPC with a P-256 key).

| Spike | Question | Outcome |
|---|---|---|
| **K1** | Does a WebCrypto P-256 key set as `RegularKey` sign a `Payment` (raw, low-S, strict DER)? | `tesSUCCESS` → P-256 session key; otherwise Ed25519 WebCrypto |
| **K2** | Is a passkey assertion (Touch ID on the Mac, Face ID on the iPhone) accepted? | Likely **not** (P5) on validators with signed `char`; note the result without concluding more |
| **K3** | Is a `Payment` signed with ML-DSA-44 (`@noble/post-quantum`, 1 312-byte key, ML-DSA `RegularKey`) accepted? Then, on a fresh account, the migration order of §8.7: `SetRegularKey` signed by the master, a proof transaction signed by the ML-DSA key, `asfDisableMaster` signed by the master | Format understood, or exact error recorded; the order holds or is corrected |
| **K4** | The Ledger **inside an app-xrp build** (with the smaller-buffer variant of §7.7): `MLDSA_internal_keygen` level 44 from a SLIP-21 seed, then `MLDSA_sign` over a 2 KB message; RAM, stack, time (Stax 36 KB) | **Hardware or software ML-DSA for L2**; if hardware, whether the key is recoverable from the 24 words |
| **K5** | `server_definitions` of the pinned XRPLF branch: `XrplDefinitions` + encode round-trip; codes still free | the codes of §6.1 hold on the imported SHA |
| **K6** | Chrome: `device-signer-kit-xrp` + WebHID sign a testnet `Payment` on the **unmodified** app, then the DMK send-APDU API for a custom command | the host path works (the kit sets P2 per curve, secp256k1 or ed25519), or we know what to write |
| **K7** | `account_tx` on a public node: find the first self-signed transaction of one known-exposed account and confirm a known-safe account (never sent) returns none; how many pages for a busy account | the bounded search of §8.7 and its error message |
| **K8** | Generate the `create-xrp` Nuxt template; run it with `ssr: false` and a WebHID call from the page | ADR 0007 confirmed or revised |

---

## 10. Work breakdown

Two tracks; **who does what is not decided (D5)**. Durations are not estimated here: the team judges order and pace as the work goes. Gates are the only fixed points.

### 10.1 Protocol track (`rippled/`)

| # | Task | Acceptance | MVP |
|---|---|---|---|
| N0 | Baseline: branch from the import, run the existing suites | base failures written in DEVLOG, no test touched | ✓ |
| N1 | **P5 test first**; fix in a separate commit only if it fails | a challenge ≥ `0x80` fails before and passes after, or passes as is (noted) | ✓ |
| N2 | Amendment (`Supported::Yes`), fields, entry, keylet `'z'`, tx 130/131, codegen limited to our types, result-code strings, `ledger_entry`, `AccountDelete` and sponsorship-table decisions, minimal transactors, `checkExtraFeatures` on `PermissionDelegationV1_1` | open in modes A and C (1); amendment off → `temDISABLED` (7) | ✓ |
| N3 | `SigningSessionSet` validation | all preflight and preclaim codes (2, 3, 4, 5, 6) | ✓ |
| N4 | **Session path, mode A**: `isSessionSigned`, `invokeCheckSession<T>` before `T::checkSign`, `LastLedgerSequence` rule, fee ceiling, enumeration test, P-256 and ML-DSA-44 session keys | cases 6, 9, 9b, 10, 13 (ceiling), 14, 15, 17, 17b, 20 (P-256 and ML-DSA-44, D14) green with the exact `tefSESSION_*`; "key can still close its session" waits for N7 | ✓ |
| N4b | **Mode P** via XLS-75 engine **and** `T::checkGranularSemantics`; 9b extended | case 8 | ✓ (last mode to land) |
| N5 | **Mode C**: closed whitelist, pre-check `Fee + Amount ≤ remaining`, `chargeSession` before the first invariant check and after any `reset` | cases 11, 12, 13 (remaining cap), 23 green; the anti-drain loop passes | ✓ |
| N6 | Invariant `ValidSigningSession` | one test per rule on a mutated view (21) | ✓ |
| N7 | `SigningSessionDelete`: owner, session key (cap exempt, fee ceiling kept), third party after expiry | cases 18, 19 | ✓ |
| N8 | Cross-cutting: key types (Ed25519, secp256k1; ML-DSA-44 is in N4, D14), TxQ, Firewall (explicit), RPC | cases 16, 20, 22, 24 | stretch |
| N9 | Standalone config + ledger closer; `[features]` | node starts; `feature` lists the six of §6.12; `server_definitions` exposes the types | ✓ |
| N10 | Final XLS from the implementation (`docs/XLS-Sessions.md`) | consistent with the code | stretch |

### 10.2 Ledger track (`ledger-app/`)

L0 (MVP), L1 (MVP), **L2 (headline, [§7.7](#77-post-quantum-root-on-the-device-l2))**, L4 documentation feedback (MVP, [§7.6](#76-documentation-and-developer-experience-feedback), log kept from the first day); stretch: L3, L4 library, L5, L6 as in §7. Checkpoint: L1 on the device with a session opened on the node.

### 10.3 Client track

| # | Task | Acceptance | MVP |
|---|---|---|---|
| W1 | `packages/core` (§8.2) | unit tests; one command runs the flow on a real node | ✓ |
| W2 | Open by **passkey** (`PasskeyListSet`, `PasskeySignature`) | session open on the node; depends on N1 outcome | ✓ |
| W3 | Open from the **Ledger**: a Ledger account signs the opening with the device's ML-DSA-44 key (instructions `0x10` to `0x12`, L2); kit 0.3.0 as is for a classical device key | session opened with the rules read on the screen; depends on L1 and L2 | ✓ |
| W4 | Account, Session, Actions screens | 5 transaction types signed by the session key with no prompt | ✓ |
| W5 | Attack screen | each refusal is the node's code | ✓ |
| W6 | Mode C in the app: spent / cap bar | 6th payment refused `tefSESSION_LIMIT` | ✓ |
| W7 | **Post-quantum account end to end** (headline) | on a fresh account, on the AlphaNet with explorer links: `SetRegularKey` to the device's ML-DSA key (master-signed), a proof transaction signed by the ML-DSA key on the Stax, `asfDisableMaster` (master-signed), then a session opened by an ML-DSA signature of the device | ✓ (headline) |
| W8 | End-to-end `tsx` test and local CI | everything passes in one command | stretch |
| Q1 | `checkExposure` (§8.7) with fixtures | the cases of §8.7 as tests; a known-exposed and a known-safe account behave as expected | ✓ |
| Q2 | `buildPqMigration` and the "Quantum" screen | dry run on a fresh account, then the real run on the AlphaNet; mainnet read-only | ✓ |
| E1 | DMK adapter for `xrpl-connect` (§8.8): issue first, fork, adapter, tests, docs, pull request | PR open and green; the adapter signs a `Payment` and a `SigningSessionSet` on the Stax | stretch |
| E2 | `@carbs/sessions` ready to install and a sessions template for `create-xrp` | an app generated from the template opens a session | stretch |

### 10.4 Delivery

The documentation feedback document (`docs/ledger-dx-feedback.md`, §7.6) and its pull requests. Working demo that can be run ("a working demo we can run, not a slide deck": Ledger page), demo video **and** pitch video, PDF deck, public repository, honest README, `pnpm demo`. Prepare a 3-minute pitch.

### 10.5 Checkpoints

| Checkpoint | Meaning |
|---|---|
| Format frozen | fields, codes, result codes and screen lines are final before the first device test; changing them later means regenerating definitions and vectors |
| Mode C and L1 status | N5 green and a session opened from the Stax, or the README says what is missing |
| Post-quantum path | K4 decided (hardware or software ML-DSA), K3 extended green, W7 on the AlphaNet |
| Feature freeze | no new feature after it; only fixes, documentation and the demo |

---

## 11. Demo and presentation

Three minutes, four acts. Everything shown on a device is shown on the Stax; anything simulated is said to be simulated.

| Time | Content |
|---|---|
| 0:00-0:25 | **The problem.** On XRPL a key has all the authority or none, and an exposed public key is a future forgery target. Show the exposure report of a real account: "the public key of this account has been on the ledger since this transaction" |
| 0:25-1:15 | **Quantum-safe root.** On the AlphaNet, with a fresh account: the Stax clear-signs `SetRegularKey` to its ML-DSA key (signed by the account's classical key), then signs a proof transaction **with ML-DSA**, then clear-signs `AccountSet asfDisableMaster`. The account no longer has any classical key able to sign; show the explorer links (to our knowledge the first hardware-wallet post-quantum signatures on XRPL) |
| 1:15-2:15 | **Sessions.** The Stax shows the rules ("Valid for 10 minutes · All transactions · Cannot change keys") and opens a session; five actions of different types with no prompt; the "stolen" key tries `SetRegularKey` and `PasskeyListSet` and the node refuses with its own codes; mode C with a 20 XRP cap, payments sized so that, fees included, exactly the 6th exceeds it, refused by the ledger; after 60 s `tefSESSION_EXPIRED` |
| 2:15-2:40 | **For everyone else.** The DMK adapter and the template: a generated app that opens a session on a Ledger in a few lines; the pull request link |
| 2:40-3:00 | **Honesty and feedback.** What is simulated or not delivered, the passkey defects found (P1, P3, P5; D7), the three best Ledger documentation findings with the minutes they cost and the PR links (§7.6) |

Rehearse three times on a real passkey and the real Stax. Figures in the pitch are the README's figures (tests, durations, types); nothing rounded in our favour. Demo script mentions that modes A and P do not bound what signed transactions leave behind.

---

## 12. Security model

| Threat | Effect | Defence |
|---|---|---|
| Session key copied, Mac account | — | WebCrypto non-extractible |
| Session key copied, Ledger account | the copy signs what the session permits until it expires | WebCrypto has no ML-DSA, so the ML-DSA-44 key is page memory and **extractable**: ledger-side bounds, a fresh key per session, short duration, CSP `script-src 'self'` |
| Session key used by script of the page (XSS) | signs what the session permits | ledger-side bounds, CSP `script-src 'self'`, short duration |
| Mode A opened by mistake | everything except account control, 10 minutes | Stax says "All transactions" and the note; mode A never the default |
| Burned fees | — | rule rejections are `tef` (no fee); fee ceiling in every mode; mode C counts fees in the cap |
| Blind passkey prompt (domain only) | session opened with wrong rules | the Ledger shows the rules; protocol max duration |
| Broken passkey public key (quantum) | passkey's full authority | the Ledger account never has a passkey (D13); a Mac account is said to be non-PQ |
| Rejected `tef` tx held and replayed under a reopened session | unexpected execution | mandatory `LastLedgerSequence` within 256 ledgers (protocol rule) |
| P-256 malleability | modifiable tx id | low-S and strict DER client-side; identify by `(Account, Sequence)` |

**Not claimed**: that mode A protects funds (it protects **control**); that Face ID is post-quantum; that alphanet passkeys are defect-free; that a Mac account is post-quantum (its master key, passkey and session keys are classical); that a Ledger account's session key is out of reach of the page (it is extractable); that the Ledger screen proves the session key belongs to the right page (it proves the **rules**, not who holds the key). Beneficiary: a session-signed transaction counts as owner activity for the beneficiary time lock and no session can be created for the beneficiary key. Contention: session transactions share the account's sequence space; tickets do not change authority. Tickets serve multisig coordination (D15); a session-signed transaction other than the own close may not use a ticket (§6.5, rule 1), so it consumes none that an in-flight multi-signed transaction needs; ticket ranges bound at opening (ADR 0010, option 3) are not adopted. In the transaction queue, a session-signed transaction never replaces one its key did not sign.

---

## 13. Risks and plan B

| Risk | Warning sign | Plan B |
|---|---|---|
| XRPLF does not build, or the head moved | build fails; codes changed (K5) | Transia `alphanet` @ `0a4cfdb61e` (same field codes, regenerated result codes, no Firewall / Beneficiary, `PasskeyListSet` = 118) |
| Device refuses to load the app | L0 fails | try the three routes (§5.2); then Speculos `stax`, said to be simulated |
| Device specifics: attestation, developer mode | genuine check refused in Ledger Live; load refused | loading routes do not depend on Ledger Live; Speculos as last resort, declared |
| P5 breaks the passkey | K2 fails and N1 test fails | **happened and handled**: the N1 test failed and the fix landed behind `fixPasskeyChallenge` (#13, §6.14); on a node without it (the public AlphaNet), open the session by `RegularKey`, a raw P-256 signature (no `PasskeySignature`) or the L6 key |
| Mode A too broad for the reviewers | feedback from reviewers | lead with mode C; mode A behind an explicit name |
| Session path late | N4 (mode A) not green | focus on mode A and say so (C and P become future work in the XLS) |
| C++ amendment does not pass | N2 / N3 not green at the gate | **plan B without protocol**: XLS-75 (`DelegateSet`, `PermissionDelegationV1_1`) with a throw-away delegate account on the public AlphaNet; closing = deleting the delegation; no cap or expiry enforced, said as such |
| Ledger late | L1 not on the device at the gate | video of clear signing on Speculos, **said as such**; L0 keeps the "real device" rule |
| ML-DSA does not fit in RAM, or the key cannot be derived from the seed | K4 fails | software ML-DSA signing in the client, said as such; the exposure check, migration and sessions are unchanged, and the explorer link then shows a software-signed transaction, said so |
| The exposure search is too slow for busy accounts | K7: too many pages | bounded search with a clear "not found within N pages" result; recorded fixtures for the demo |
| `SetRegularKey` to an ML-DSA AccountID, a proof transaction by that key, or `asfDisableMaster` fails on the AlphaNet | K3 fails | exact error recorded; migration stays a dry-run plan, said so |
| The ML-DSA key cannot be proven recoverable from the 24 words | K4: no seed-based derivation | no `asfDisableMaster`; keep the classical master and say so; the root key is shown as a software or app-held key |
| Fatigue | chained errors | rest in shifts; feature freeze before the final pass |

Order of the remaining items: decided as the work goes (L2 first, D8); nothing is excluded. Always done: N1's test, L0, L1, the protocol tests, the honest README. If a track is behind, the README says so instead of simulating (for example software ML-DSA signing, a Speculos video, mode P as future work in the XLS).

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
- rippled requires **signed commits**; we sign them wherever a signing key is available, and at least one commit of a merged PR carries the PR number, e.g. `feat: Add SigningSessionSet transactor (#12)`.
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

Keep PRs small and brief (reviewers value brevity). rippled merges PRs with **squash-and-merge** and forbids merge commits and "Rebase and merge"; a PR that must land as several commits (the two imports, the base fixes) is the documented exception: request a fast-forward-only merge (`--ff-only`) and justify it in the description. CI (format check, typecheck and tests of the TypeScript packages; the protocol suites and the Ledger tests are run by hand and recorded in the DEVLOG) must pass; no "fix CI" noise on `main`.

**Review culture to anticipate** (observed in XRPL standards and rippled reviews): gating on the amendment everywhere; **a test for every line** (or an explicit `LCOV_EXCL` with a reason); correct code prefix (`tem` stateless / `tef` / `tec`); `NounVerb` naming; performance and DoS (our cap check is O(1) per transaction); and the question "what new functionality does this provide that existing features do not?" (answered in the XLS: XLS-75 delegates to an *account*, needs a second funded account, has no expiry and no amount cap).

**`docs/DEVLOG.md`**: dated entries — what was done, removed, ignored or simulated; it is the source of the README's prior-work note and of the final presentation.

**README, prior work**: states plainly that an earlier design and prototype exist in `STOOOKEEE/TTT`, that nothing was reused from it, and that everything in this repository was written here, with the upstream imports in their own commits.

---

## 15. Open items

1. **D3** to ask Denis (one object per session vs entries in the passkey list); **D4** and **D5** postponed; **D8** proposed (§2); D11 adopted.
2. UNVERIFIED on this device: loading route on a Stax, the smaller-buffer build variant and its real RAM, `MLDSA_internal_keygen` linkage in an app-xrp build, the exact DMK 1.11 send-APDU API, a new P2 value for P-256 (L6), the rendering of 10 permission lines.
3. Not yet shown by a test: the exposure search cost (K7), the AlphaNet accepting the migration order (K3 extended), and whether the base builds. P5 is now tested and fixed (§6.14).
4. XLS-Sessions final text from the implementation.
5. **ADR 0010** (tickets and sessions, D15): its rule for a session without a range is applied (no ticket for a session-signed transaction other than the own close; case 13 changed, `docs/DEVLOG.md` 2026-10-25); the options themselves, ticket ranges included (option 3 adds UINT32 115), are still to decide.

---

## 16. Limits and roadmap

"Quantum-safe by default" (D11, D16) means two things about the default profile, the Ledger account (D13). Once it is set up, its master key cannot sign: the AlphaNet answers `tefMASTER_DISABLED` to the old classical key (`docs/DEVLOG.md`, the post-quantum root entries). This holds as long as the account has no other authority that survives `asfDisableMaster`, such as a signer list, a delegate or a beneficiary key (§8.7, rule 3); D13 forbids only a passkey, and the client must check the rest. Its sessions use ML-DSA-44 keys by client policy: the entry stores only the AccountID of the session key (§6.2) and the Stax shows only its address (§7.3), so neither the ledger nor the device enforces the key type. The design does not remove the limits below. Each row says what bounds the limit today and what would lift it. `docs/ARCHITECTURE.md` repeats them.

| # | Limit | Why | Bounded today by | Roadmap |
|---|---|---|---|---|
| 1 | **P-256 sessions on Mac accounts** | A Mac account's master key, passkey and session keys are classical (§6.14). A quantum computer could forge with any of them once its public key is on the ledger | The session rules (at most 600 s, the mode, the fee ceiling, the cap). A Mac account is called non-post-quantum everywhere (§12) | ML-DSA-44 session keys work on any account (D14), once they can be kept out of the page's reach (row 2). Whether WebAuthn offers a post-quantum passkey is **UNVERIFIED** |
| 2 | **Extractible ML-DSA session keys on Ledger accounts** | WebCrypto has no ML-DSA. The session key is made by `@noble/post-quantum` and lives in page memory, where a script of the page can copy it | The ledger-side bounds, a fresh key per session and CSP `script-src 'self'` (§12) | A non-extractible ML-DSA key from the browser or the platform (**UNVERIFIED**) |
| 3 | **Large transactions on Ledger accounts** | Every transaction carries a 1 312-byte `SigningPubKey` and a 2 420-byte signature, against 33 and about 72 bytes with secp256k1 | The base fee does not grow with size (`rippled/src/libxrpl/tx/Transactor.cpp:459-483`). The device signs at most 2 048 bytes of signing data, key included, and refuses more with `0x6700` (§7.7) | Measure the largest session and migration transactions against that limit (K4). Nothing is planned in the protocol |
| 4 | **Passkey list not replaceable (P6)** | In this build a passkey list can be neither replaced nor removed (§6.14). A passkey has full authority (`rippled/src/libxrpl/tx/Transactor.cpp:1136-1160`), so an account that ever had one keeps a classical key with full authority | A Ledger account starts as a fresh account and never gets a passkey (§8.5, D13) | A protocol fix that replaces or removes the list (§6.14). No upstream pull request is planned (D7) |
| 5 | **WebAuthn challenge defect (P5)** | Where `char` is signed, the unchanged node refuses every WebAuthn signature. Test N1 confirmed it (SIMULATED, a software authenticator) | `fixPasskeyChallenge` on our node, which the standalone configuration enables (§6.12, §6.14). The public AlphaNet has no fix, so its answer may depend on its validators' platforms (**UNVERIFIED**, K2) | Offer the fix upstream when D7 allows it |
| 6 | **ML-DSA v1 on the device has no side-channel countermeasures** | Ledger's v1 ML-DSA has no side-channel or fault-injection countermeasures, by Ledger's own statement (§7.1, §7.7) | Nothing: the design makes no claim against these attacks and says so wherever it describes the root key. Physical attacks need the device in hand; whether a compromised host can learn anything from the time each signature takes is **UNVERIFIED** | Ledger's hardened ML-DSA, when it ships |
| 7 | **Batch cannot migrate keys atomically** | An inner `Batch` transaction carries no `SigningPubKey` (`rippled/src/libxrpl/tx/transactors/system/Batch.cpp:279-285`). `asfDisableMaster` requires the transaction to be signed by the master key itself (`rippled/src/libxrpl/tx/transactors/account/AccountSet.cpp:246-256`, `:307-313`), so the inner `AccountSet` cannot pass. On the AlphaNet, the device track saw an all-or-nothing `Batch` return `tesSUCCESS` and apply neither inner transaction (`docs/DEVLOG.md`) | The migration is three transactions with the proof step between them (§8.7). Step 3 is refused until the proof is accepted | Nothing needed: the proof step shows that the new key works before the master key is disabled |
| 8 | **36 KB of device RAM** | The Stax has 36 KB of SRAM, stack included (§5.1). The ML-DSA-44 working buffers share the transaction context's memory (`ledger-app/src/apdu/global.h:71-88`; `.bss` about 25 KB instead of 31 KB, as `docs/DEVLOG.md` records) | The 2 048-byte limit of row 3, and the smaller-buffer build of §7.7 | The measurements of K4. A smaller ML-DSA working set |

---

## Appendix A: constants

| Name | Value |
|---|---|
| `SessionKey` | ACCOUNT 34 |
| `SessionCap` | AMOUNT 47 |
| `SessionSpent` | AMOUNT 48 |
| `SessionDuration` | UINT32 114 |
| `SessionMaxPerTx` | AMOUNT 49 |
| `SessionWitness` | ACCOUNT 35 |
| `SessionMaxTxCount` / `SessionTxCount` | UINT32 115 / 116 |
| `WitnessSignature` | OBJECT 43, signed with prefix `WTS\0` |
| `tefSESSION_EXPIRED` / `_LIMIT` / `_TX_NOT_ALLOWED` / `_NO_WITNESS` | -172 / -171 / -170 / -169 |
| `ltSIGNING_SESSION` | `0x009A` |
| keylet namespace | `'z'` = `0x007A` |
| `SigningSessionSet` / `SigningSessionDelete` | 130 / 131 |
| `tfAllTransactions` / `lsfAllTransactions` | `0x00010000` |
| `kMaxSessionDuration` | 600 s |
| `kSessionFeeMultiple` | 1000 |
| `kSessionMaxLedgerWindow` | 256 |
| `kMaxSessionTxCount` | 100 000 |
| `kPermissionMaxSize` | 10 |
| P-256 public key | 65 bytes `0xF6 ‖ X ‖ Y` |
| ML-DSA-44 | public key 1 312 B (no prefix), signature 2 420 B, secret key 2 560 B |
| app-xrp APDU | `CLA 0xE0`, `INS 0x02` pubkey, `0x04` sign, `0x06` config; `P2 0x40` secp256k1, `0x80` ed25519 |
| ML-DSA APDU (device track) | `INS 0x10` public key, `0x11` sign, `0x12` signature; 250-byte chunks; signing data at most 2 048 B, `STX\0` included |
| Public AlphaNet | network 24100 |

## Appendix B: references

- Upstream: [XRPLF/rippled `alphanet`](https://github.com/XRPLF/rippled/tree/alphanet) · [LedgerHQ/app-xrp](https://github.com/LedgerHQ/app-xrp) · [ledger-secure-sdk PR #1617 (ML-DSA)](https://github.com/LedgerHQ/ledger-secure-sdk/pull/1617) · [ledger-app-zond](https://github.com/cyyber/ledger-app-zond) · [ledger-app-builder](https://github.com/LedgerHQ/ledger-app-builder) · [DMK XRPL example](https://github.com/LedgerHQ/device-management-kit-ts-workshop/tree/main/xrpl-hackathon).
- Standards and discussions: [XLS-75 permission delegation / #657 expiry](https://github.com/XRPLF/XRPL-Standards/discussions/657) · [#572 agent identity (amount cap)](https://github.com/XRPLF/XRPL-Standards/discussions/572) · [XLS-83 passkeys, one object vs list](https://github.com/XRPLF/XRPL-Standards/discussions/236) · [XLS-86 Firewall](https://github.com/XRPLF/XRPL-Standards/discussions/255) · [XLS-103 on-chain co-signer](https://github.com/XRPLF/XRPL-Standards/discussions/589) · [session keys sketch by Denis, Transia #29](https://github.com/Transia-RnD/rippled/pull/29#issuecomment-4243346546) · [role-based signature prefixes, rippled #8162](https://github.com/XRPLF/rippled/pull/8162).
- Ledger bounty page: https://developers.ledger.com/xrplnyc (Protocol Innovation, "there is still no XRPL transaction Clear Signing"; real device required; documentation feedback judged "as much as the code": what to include = overall experience with the Ledger docs and SDKs, gaps / confusing flows / missing context, specific improvements with screenshots or PRs; bonus = better tutorial or code sample ideas, portal navigation or search improvements, time-saver suggestions).

## Appendix C: setup checklist

- [ ] `docs/ledger-dx-feedback.md` created with its entry template; log started (§7.6).
- [ ] Disk space freed, `conan` on `PATH`, builder image pulled, `STAX_SDK` set.
- [ ] Stax unlocked, on the dashboard, firmware 1.11 confirmed, loading route chosen.
- [ ] Head of `XRPLF/rippled:alphanet` read; SHA recorded; background build started.
- [ ] Repository: two import commits, `UPSTREAM.md`, `README.md` skeleton, `docs/DEVLOG.md`.
- [ ] K5 run on the imported SHA; codes of §6.1 confirmed or renumbered everywhere.
- [ ] All `.macro` edits batched before the first full rebuild.
- [ ] Spikes K1-K3, K6 on the public AlphaNet with a **new account each**.
- [ ] Decisions D3, D4, D5 and D8 revisited before the format is frozen.
