<div align="center">

# 🔐 carbs

**Quantum-safe by default, delegable signing for the XRP Ledger: a post-quantum ML-DSA-44 root key on a Ledger Stax, and signing sessions whose rules the ledger enforces and the device shows.**

[![Live demo](https://img.shields.io/badge/demo-carbs--kappa.vercel.app-000?style=flat-square)](https://carbs-kappa.vercel.app)
[![XRPL AlphaNet](https://img.shields.io/badge/XRPL-AlphaNet%20%2824100%29-1257d4?style=flat-square)](https://custom.xrpl.org/alphanet.xrpl.org)
[![rippled amendment](https://img.shields.io/badge/rippled-SigningSessions-363636?style=flat-square)](./docs/XLS-Sessions.md)
[![Ledger Stax](https://img.shields.io/badge/Ledger%20Stax-ML--DSA--44-7c3aed?style=flat-square)](#on-the-device)
[![Device Management Kit](https://img.shields.io/badge/Ledger-Device%20Management%20Kit-000?style=flat-square)](./docs/device-contract.md)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat-square)](./LICENSE)

🗽 **Built at the XRPL Hackathon NYC — Protocol Innovation · Ledger Protocol Innovation · New York, 24–25 October 2026**

**[Open the app](https://carbs-kappa.vercel.app)** · **[XLS draft](./docs/XLS-Sessions.md)** · **[Developer feedback](./docs/ledger-dx-feedback.md)** · **[Specification](./FIANSO-SPEC.md)** · **[Architecture](./docs/ARCHITECTURE.md)** · **[DEVLOG](./docs/DEVLOG.md)**

</div>

carbs lets an XRP Ledger account delegate signing without handing over its key, under a
post-quantum root. A Ledger Stax holds an **ML-DSA-44** key and clear-signs XRPL transactions with
it, so the account can retire its classical keys. A rippled amendment, **`SigningSessions`**, lets
the account open a short-lived key that signs with no prompt, inside limits the **ledger** checks
on every transaction: one of three modes, at most 10 minutes, a fee ceiling, and optional bounds on
spend, payment size, transaction count or a co-signer. A **quantum exposure check** tells any
account whether its public key is already on the ledger, and guides the move to the post-quantum
key.

> On the XRP Ledger a key holds all of an account's authority or none of it, so an app, a game or
> an AI agent that signs for you either holds your full key or asks you every time. XLS-75
> delegation gives rights to another funded account, with no expiry and no amount cap. And a public
> key that has signed once stays on the ledger for good: a forgery target for a future quantum
> computer. carbs moves the expiry, the caps and the post-quantum root into the protocol and the
> device.

> 🗽 **Built at the XRPL Hackathon NYC, New York, 24–25 October 2026,** for two tracks: **Protocol
> Innovation** and **Ledger Protocol Innovation**. Ledger's
> [track brief](https://developers.ledger.com/xrplnyc) requires a real device and weighs
> developer-experience feedback "as much as the code"; ours is
> [`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md).

## Table of contents

- [Try it yourself](#try-it-yourself)
- [How carbs fits the tracks](#how-carbs-fits-the-tracks)
- [How it works](#how-it-works)
- [On the ledger](#on-the-ledger)
- [On the device](#on-the-device)
- [Every claim, verified](#every-claim-verified)
- [What building it made visible](#what-building-it-made-visible)
- [Limits and roadmap](#limits-and-roadmap)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Contributing back](#contributing-back)
- [Team](#team)
- [License](#license)

## Try it yourself

The web app is deployed at **https://carbs-kappa.vercel.app**, a static build of `apps/web`
(deployment notes in [`docs/DEPLOY.md`](./docs/DEPLOY.md)). No node that carries the amendment is
public, so on the hosted page **Session, Actions and Attack run on the SIMULATED backend**: a
simulated node that applies the specification's rules in order and answers with their result
codes, with a striped badge on every result that comes from it. The **Quantum** screen is live: it
reads the real public AlphaNet or mainnet (mainnet only ever read) and migrates fresh AlphaNet
accounts.

1. **Quantum.** Paste an AlphaNet or mainnet address: the report says whether each of its keys is
   already on the ledger, and which transaction first revealed it. _Start with a fresh AlphaNet
   account_ runs the three migration steps on the real AlphaNet, signed by a simulated device by
   default (the page also offers a Stax over USB, which needs this repository's XRP app).
2. **Account.** Create a Ledger account (post-quantum root, master key disabled) or a Mac account
   (master key and a passkey).
3. **Session.** Open a session in mode A, P or C: the device review shows its rules, then the page
   counts down and fills the spent bar.
4. **Actions.** Six transaction types signed by the session key, with no prompt.
5. **Attack.** Replay what a stolen key would try: change the keys, add a passkey, open a second
   session, burn fees, overspend the cap, sign after expiry.
6. **Apps.** The stage demos below, one card each: the session it opens (mode, Stax profile,
   limits), what the ledger and the Stax refuse, and a link that opens only on the team's network.

**Locally, on the amendment node.** `pnpm demo` starts, on your machine, the standalone node built
from `rippled/`, its ledger closer, a dev faucet and the web app on the live backend: the same
screens, answered by the node's own result codes (see [Getting started](#getting-started)). The
device stays a software double of the device contract unless a real Stax is picked over USB.

**The stage demos.** `apps/passkey-wallet` is a test wallet with five single-screen demos on the
amendment node, each opening one session and letting the session key act alone: an AI agent that
buys data from paid APIs on a mode C budget (a scripted compromised-agent step sends the 500 XRP a
prompt injection asks for, and the ledger refuses it with `tefSESSION_LIMIT`), an arcade of
micro-bets, a grid market maker limited to offers, a pay-per-second stream and a ticket minting
desk. They run with the node on the team's own network (`infra/compose.yaml`, HTTPS through
Tailscale), not on a public host; the web app's **Apps** screen lists them and links to them. Run
sheet:
[`apps/passkey-wallet/scripts/agent/README.md`](./apps/passkey-wallet/scripts/agent/README.md).

## How carbs fits the tracks

**Protocol Innovation, XRPL Commons** (core infrastructure, clients and developer tooling):

- **Core infrastructure, in C++.** The `SigningSessions` amendment in rippled: a ledger entry, two
  transactions, an authorization check in `preclaim`, accounting at two points of
  `Transactor::operator()` and an invariant, with an XLS draft written from the implementation. Two
  defects of the base fixed behind their own amendments, `fixPasskeyChallenge` and
  `fixP256StrictDer`, each with a test that failed first.
- **Client.** `@carbs/sessions`: definitions read from `server_definitions`, encoding, session keys
  (P-256 and ML-DSA-44), the node client and the quantum exposure check.
- **Developer tooling.** A native fuzz loop for the XRP app's parser, a per-assertion record of the
  base tree's own failures, and the developer feedback log.

**Ledger** (bring the modern Ledger stack into XRPL, and lean into the gaps):

- **XRPL transaction Clear Signing.** Two new transaction types clear-signed on the Stax
  (`SigningSessionSet`, `SigningSessionDelete`), every inner transaction of a `Batch` shown before
  it is signed, and session transactions never blind-signed. The client predicts the device's review
  line for line from the same fields, checked against frozen screen vectors
  ([`docs/device-contract.md`](./docs/device-contract.md)).
- **Things Ledger does not support yet.** ML-DSA-44 signing of XRPL transactions on the Stax, with a
  clear-signed review, validated on the public AlphaNet; a session policy and per-app profiles
  (agent, game, trading, streaming, minting) that the device enforces before any review.
- **The Device Management Kit, and Ledger's XRP signer kit extended.** The client reaches the device
  through the Device Management Kit only (WebHID), and through Ledger's official
  `device-signer-kit-xrp`, imported unmodified into `packages/signer-kit-xrp` and extended in its
  own style (commands, tasks, device actions, use cases, `SignerXrp` methods): `getPqPublicKey`,
  `signTransactionPq` and `getSessionPolicy` next to its addresses, classical signing and app
  configuration, and the app's session refusals (`0x6815`, `0x6986`) in its error mapping. Its 106
  upstream tests run unedited next to ours, and the extension is drafted as an upstream pull request
  ([`UPSTREAM-PR.md`](./packages/signer-kit-xrp/UPSTREAM-PR.md), not sent). The gaps we hit are in
  [`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md).
- **Ledger-secured flows.** The trading (order book offers), minting (NFTs) and streaming apps open
  their session on the Stax with a profile the device checks; the session key then signs alone,
  inside limits the ledger enforces.
- **A real device.** The ML-DSA-44 payments above were signed by our Stax; the agent demo ran end to
  end on a real Stax against the standalone node (reported in #83).
- **Developer feedback**, weighed by the track as much as the code: 54 entries in
  [`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md).

## How it works

```text
owner: the Stax's ML-DSA-44 root (Ledger account) or a passkey (Mac account)
  └─▶ SigningSessionSet, one ordinary signature; the Stax shows the rules in clear
       └─▶ SigningSession entry: session key, Expiration (at most 600 s), mode A, P or C,
           optional SessionMaxPerTx, SessionMaxTxCount, SessionWitness
            └─▶ the session key signs with no prompt, LastLedgerSequence on every transaction
                 ├─ inside the rules  → applied; the entry counts XRP spent and transactions
                 └─ outside the rules → tefSESSION_*: never in a ledger, no fee
            └─▶ SigningSessionDelete: by the owner, by the key itself, or by anyone after expiry
```

**1. A post-quantum root in hardware.** The XRP app on the Stax derives an ML-DSA-44 key from the
24 words (SLIP-21, so the same key comes back after a reinstall; builds before the seed fix of 25
October derived one public, all-zero-seed key on every device, see below) and signs XRPL transactions with
it after showing them in clear. The account moves to it in three transactions, in an order the node
enforces: `SetRegularKey` to the ML-DSA key, signed by the master key; a proof transaction signed
by the ML-DSA key; then `asfDisableMaster`, which only the master key may set. The old classical
key then gets `tefMASTER_DISABLED`. The client refuses the last step until the proof is validated,
the key is shown recoverable (or backed up) and the account's other authorities are reviewed.

**2. Sessions enforced by the ledger.** The account opens a session with **one ordinary
signature** from a key that already has full authority: the Stax, which shows the rules on its
screen, or a passkey. It is not a multisig. The session key then signs alone, in exactly one mode:

| Mode  | The session key may                                                            | Bound                                              |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| **A** | sign every delegable transaction type except five (66 types, pinned by a test) | time, fee ceiling                                  |
| **P** | sign the 1 to 10 XLS-75 permissions it lists                                   | time, the list, fee ceiling                        |
| **C** | send direct XRP `Payment` only                                                 | time, a total XRP cap (fees included), fee ceiling |

Optional bounds, in any combination, each checked by the ledger:

| Field                              | Mode | The ledger refuses                                                                     | With                    |
| ---------------------------------- | ---- | -------------------------------------------------------------------------------------- | ----------------------- |
| `SessionMaxPerTx`                  | C    | a payment above it, its fee not included                                               | `tefSESSION_LIMIT`      |
| `SessionMaxTxCount` (1 to 100,000) | any  | any transaction once the session has signed that many                                  | `tefSESSION_LIMIT`      |
| `SessionWitness`                   | any  | a transaction without the witness account's co-signature (`WitnessSignature`, `WTS\0`) | `tefSESSION_NO_WITNESS` |

Time runs on the ledger's clock: `Expiration` is the parent ledger's close time at opening plus at
most 600 seconds, compared with the parent close time of each later ledger. A session key can never
change who controls the account: no session signs `SetRegularKey`, `SignerListSet`,
`PasskeyListSet` or `AccountSet`, and the `ValidSigningSession` invariant checks after every
session-signed transaction that the account's keys, signers, passkeys, delegates, beneficiary and
firewall did not move. The key can always give up its session: its own close escapes the expiry,
the cap and the witness, and pays at most the base fee of its type, so a mode C account loses at
most the cap plus one base fee. The owner revokes with any full-authority key, by sequence or by
ticket, and a session key can neither use the account's tickets nor outbid the owner's queued
close.

Two account profiles share the engine:

| Profile                      | Full authority                                                                 | Opens a session with                             | Session key                                         |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------- |
| **Ledger account** (default) | the Stax's ML-DSA-44 key as `RegularKey`, master key disabled, never a passkey | an ML-DSA-44 signature on the Stax, clear-signed | ML-DSA-44, made in the client, fresh per session    |
| **Mac account**              | the master key and a passkey                                                   | the passkey (WebAuthn)                           | P-256 WebCrypto, non-extractible, fresh per session |

A Mac account is not post-quantum: its master key, passkey and session keys are classical. A
Ledger account never gets a passkey, because a passkey keeps full authority and this base cannot
remove one (defect P6, [below](#what-building-it-made-visible)).

The test wallet also has a **post-quantum Touch ID account** (`apps/passkey-wallet`, #106): Touch ID
releases a per-credential secret through the WebAuthn PRF extension, which decrypts an ML-DSA-44
key kept in the browser (HKDF-SHA256, then AES-256-GCM with the account as associated data). That
key is the account's `RegularKey`, a temporary classical key that set it up is disabled once an
ML-DSA-44 proof transaction succeeds, and no P-256 key ever reaches the ledger. It ran end to end
on a local node with a virtual authenticator that has PRF, not with a real Touch ID.

**Key rotation on every payment** (#105) keeps even the classical exposure to one key per payment:
with the master key disabled, each payment is an all-or-nothing `Batch` signed by the current
`RegularKey` that carries the payment and a `SetRegularKey` to the next key, so a payment reveals
only the key it retires. The suite `KeyRotationBatch` checks it on the ledger state, and a script
runs it on a live node with an `account_tx` audit.

**3. A quantum exposure check.** `checkExposure` (in `@carbs/sessions`) answers `exposed`,
`no-exposure-found` or `unknown` for any account, with the transaction that first revealed each
key. It tells the master key from the regular key and the other authorities, reports separately
what survives `asfDisableMaster` (passkeys, a beneficiary key, delegates, signer lists), and
answers `unknown` rather than guessing when the node's history or the search bound does not cover
the account. Mainnet is only ever read.

## On the ledger

One amendment, `SigningSessions`, on `XRPLF/rippled` `alphanet`; it requires XLS-75's
`PermissionDelegationV1_1`. The public AlphaNet does not carry it: sessions run on our standalone
node ([`infra/`](./infra/)), which enables it in its genesis ledger.

| Signing sessions | On the ledger                                                                                  | Notes                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A session        | `SigningSession` entry (`signing_session`)                                                     | one per account and session key, one owner reserve, never reserve-sponsored                             |
| Opening          | `SigningSessionSet`                                                                            | not delegable, never signed by a session; refused for a key that already has authority over the account |
| Closing          | `SigningSessionDelete`                                                                         | by the owner, by the session key itself, or by anyone once it has expired, to reclaim the reserve       |
| Time             | `SessionDuration`, then `Expiration`                                                           | 1 to 600 seconds, on the parent ledger's close time                                                     |
| Mode             | `tfAllTransactions`, `Permissions` or `SessionCap`                                             | exactly one                                                                                             |
| Spend and count  | `SessionSpent`, `SessionTxCount`                                                               | the only fields that ever change                                                                        |
| Co-signer        | `SessionWitness`, `WitnessSignature`                                                           | signed by the witness account's master key or `RegularKey`                                              |
| Refusals         | `tefSESSION_TX_NOT_ALLOWED`, `tefSESSION_EXPIRED`, `tefSESSION_LIMIT`, `tefSESSION_NO_WITNESS` | `tef`: never in a ledger, never a fee                                                                   |

What every node checks on a session-signed transaction, in this order:

| #   | Rule                                                                                                                  | Refusal                                     |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0   | not a pseudo-account; the key type may sign (P-256 needs `Passkey` and `fixP256StrictDer`, ML-DSA-44 needs `Quantum`) | `tefBAD_AUTH`, `tefSESSION_TX_NOT_ALLOWED`  |
| 1   | the mode allows the type; never `Batch` or `LoanSet`; no `TicketSequence`, except for the own close                   | `tefSESSION_TX_NOT_ALLOWED`                 |
| 2   | `LastLedgerSequence` present, at most 256 ledgers ahead                                                               | `tefSESSION_TX_NOT_ALLOWED`                 |
| 3   | before `Expiration` (the own close is exempt)                                                                         | `tefSESSION_EXPIRED`                        |
| 4   | `Fee` at most the base fee of the type plus 1,000 base fee units (the own close: its base fee only)                   | `tefSESSION_LIMIT`                          |
| 5   | mode C: `Fee + Amount` within what is left of `SessionCap`, and `Amount` within `SessionMaxPerTx`                     | `tefSESSION_LIMIT`                          |
| 6   | fewer than `SessionMaxTxCount` transactions signed so far                                                             | `tefSESSION_LIMIT`                          |
| 7   | a `WitnessSignature` from the witness account when the session has one, and none otherwise                            | `tefSESSION_NO_WITNESS`, `tefBAD_SIGNATURE` |

The check replaces the transaction's signature check in `preclaim`, so a refusal is never included
in a ledger and never charged. Accounting runs at exactly two places in `Transactor::operator()`, so
a fee-claiming `tec` counts too: a leaked mode C key that only burns fees is stopped by its cap
(the anti-drain test). The invariant ties `SessionSpent` to the XRP that actually left the account.
`ledger_entry` reads a session by index or by account and session key, `account_objects` lists
them, and `server_definitions` serves every new type, field and code: the client reads them from
the node, never from a hand-typed table.

**What modes A and P do not bound.** They bound when the key can sign, not what the signed
transactions leave behind: an escrow, a check, a channel or an offer outlives the session. Only
mode C bounds the XRP that leaves the account, and `SessionMaxTxCount` bounds how many transactions
any mode signs. Every rule, with the `path:line` that implements it, is in the XLS draft,
[`docs/XLS-Sessions.md`](./docs/XLS-Sessions.md).

## On the device

The XRP app of the Stax (`ledger-app/`, from `LedgerHQ/app-xrp`) gains a post-quantum signing path
and guardrails for sessions. The client reaches it through the Device Management Kit only, over
WebHID; every APDU, status word and screen line is in
[`docs/device-contract.md`](./docs/device-contract.md).

- **The ML-DSA-44 root.** Three instructions: `0x10` reads the 1,312-byte public key, `0x11` takes
  the signing data in chunks (at most 2,048 bytes, key included), `0x12` returns the 2,420-byte
  signature. Pure ML-DSA-44 over `STX\0` and the fields, exactly what the node verifies. Built for
  Stax, Flex and Apex P; the working buffers overlay the transaction context to fit 36 KB of SRAM.
- **Clear signing on the post-quantum path.** The app strips the prefix, runs the transaction
  through its own parser and shows the same review as a classical signature. While a review is on
  screen the bytes cannot change: an approval signs only what was shown (a SHA-256 check). The
  blind-signing setting is honoured.
- **Sessions in clear, never blind.** A `SigningSessionSet` reads _Open session_, the account, the
  session key and its **Agent ID** (the first 4 bytes of its AccountID, which the agent prints
  too), then _Allows_, _Valid for_, _Max spend_, _Max per payment_, _Witness_, _Max transactions_
  and the note _Cannot change keys or signers_. A session transaction the app cannot show in full
  is refused (`0x6815`) whatever the blind-signing setting, and a signed field that forges one of
  the app's own rows is refused.
- **The owner's own limits.** A session policy, edited only on the device (max spend, max per
  payment, max duration, modes A and P allowed, witness required), is checked before any review,
  on both signing paths: above it the Stax says why and answers `0x6986`. Five profiles (agent,
  game, trading, streaming, minting), named by a memo, carry their own limits and require a
  transaction count.
- **Batch.** A `Batch` is clear-signed inner transaction by inner transaction; one the app cannot
  read to its end is refused, since a session could hide in the unread part.
- **Not claimed.** Ledger's v1 ML-DSA has no side-channel or fault-injection countermeasures, by
  Ledger's own statement. The screen proves the rules, not who holds the session key.

## Every claim, verified

### The post-quantum root, on the public AlphaNet

Three payments of 1 XRP, each signed with an ML-DSA-44 key held by our Ledger Stax, verified with
`@noble/post-quantum` before submission, and validated `tesSUCCESS` on the public AlphaNet, network
24100, on 24 October ([DEVLOG](./docs/DEVLOG.md)). To our knowledge, the first post-quantum
signatures made by a hardware wallet on the XRP Ledger.

| Signed by                                      | Review on the Stax                                                                | Account                              | Transaction hash                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| the XRP app of this repository                 | **clear**: the app parsed the payment and showed its type, amount and destination | `rGcT27HiGhoJWYRxqg9jcnPboGD4RGuLLm` | `46F4D08446F73FDF4DA648EB5E050B7BF0C8FA882B35B53B8D90E2BFD6F6F3EE` |
| the XRP app of this repository                 | blind: the message size and a SHA-256 prefix                                      | `rpxMtodcdjFGpssK5k7D4CixifFBCLS7eV` | `7654683C8DBBD091941A6BBD369DA25F0E5888B2C5C21A1340DFDCD6C652436B` |
| a throw-away spike app, not in this repository | blind                                                                             | `rs3drHLeUPmQmnYNmeVGnFwY68xDnA5G8T` | `B55E26D1E387C2D277A9EA8F7AE4AC1F98FEFE6A28796DB51F4EFD30710C698D` |

The public AlphaNet servers keep a rolling window of recent ledgers (from ledger 240005 on 25
October), so neither they nor the XRPL Explorer serve these three transactions any more. What they
left still reads on the ledger: each account has an ML-DSA key account as `RegularKey` and its
master key disabled (`account_info`). The first two share the device's key account,
`rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2`: the same key came back after the app was reinstalled.

> **Correction (25 October): the key of those two accounts is not secret.** The XRP app then
> derived its ML-DSA-44 seed from bytes the OS never writes, so every device produced
> `ML-DSA-44.KeyGen_internal(32 zero bytes)`, whose address is exactly
> `rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2`; "the same key came back after a reinstall" was the
> symptom. `rGcT27…` and `rpxMto…` are test accounts with no value, controlled by anyone who runs
> that key generation. The signatures were still made and checked on the Stax, but they prove the
> signing path, not a hardware-held secret. The fixed app derives the key from the device's own
> SLIP-21 key ([DEVLOG](./docs/DEVLOG.md), "the ML-DSA root key was the zero-seed key");
> the throw-away spike account `rs3drH…` came from another app and another derivation (a BIP32
> key, not in this repository), which this correction does not cover.

Account page:
[`rGcT27…`](https://custom.xrpl.org/alphanet.xrpl.org/accounts/rGcT27HiGhoJWYRxqg9jcnPboGD4RGuLLm).

### The amendment, on our node

- **Every case of the test plan has a test that asserts its exact result code**: suites
  `SigningSessions` (cases 1 to 20 and 22 to 27), `SigningSessionsBatch` (case 28) and
  `InvariantsSigningSession` (case 21, one test per invariant rule on a mutated view). They and
  `P256StrictDer` pass with no failure in the last runs recorded; `SigningSessions` alone holds 49
  cases and 3,586 checks.
- **Tests first, then mutations.** Each rule's test was run failing before its code existed, then
  proven to bite: a temporary mutation of the rule (expiry one step late, the fee ceiling one base
  fee higher, a call site of the accounting removed…) makes it fail, and is reverted. The counts are
  in the DEVLOG.
- **The full rippled suite.** The last full `./xrpld --unittest` ran on the final tree (25 October,
  `6b189db`, before the last two gate follow-ups, which ran their neighbouring suites): 286 suites,
  5,411 cases, 1,315,625 tests. Its failures are the imported tree's own, listed per assertion in
  [`docs/base-failures.txt`](./docs/base-failures.txt) before we changed anything, and three suites
  that fail only under parallel jobs and pass alone (`SignatureVerification`, `ValidatorSite`,
  `ValidatorSiteV2`). No failure comes from the session code.
- **On a real node.** The web app's live backend, driven from Node against the standalone node
  with the amendment (`pnpm --filter web live-run`, which asserts every code). Its printed output,
  lines grouped, as recorded in the DEVLOG on 24 October on the build of `develop` at #53:

```text
[A] open: tesSUCCESS
[A] action payment, offer, trust, ticket, mint, check: tesSUCCESS (six times)
[A] attack regular-key, passkey, disable-master, open-session: tefSESSION_TX_NOT_ALLOWED, fee charged: false
[A] attack fee-burn: tefSESSION_LIMIT fee charged: false
[A] attack no-last-ledger: tefSESSION_TX_NOT_ALLOWED fee charged: false
[A] attack other-account: tefBAD_AUTH fee charged: false
[A] own close: tesSUCCESS
[P] (the same, with the six types listed): identical results
[C] open: tesSUCCESS
[C] payment 1..5: tesSUCCESS, spent 3500010, 7000020, 10500030, 14000040, 17500050
[C] payment 6: tefSESSION_LIMIT, spent 17500050
[C] ticket: tefSESSION_TX_NOT_ALLOWED
[C] cap overflow: tefSESSION_LIMIT
[expiry] after expiry: tefSESSION_EXPIRED
[expiry] own close: tesSUCCESS
```

### The client, the web app and the device

- **395 TypeScript tests**, run again for this page on `develop` (`6b189db`): `@carbs/sessions`
  102, `@carbs/ledger` 57, the web app 229, `scripts` 7. CI runs the format check, the typecheck,
  these tests and a scan of the static build (no inline script, no third-party origin) on every
  pull request.
- **The client and the device agree byte for byte.** `encodeForDevice` reproduces the seven valid
  session vectors of the Ledger app, and the client's predicted review reproduces the app's frozen
  screen vectors line for line.
- **The device.** cmocka unit tests (16 cases on the ML-DSA instructions alone: chunking, the
  2,048-byte limit, the review lock, the blind-signing setting) and Ragger snapshots on the Speculos
  emulator for Stax, Flex, Apex P, Nano S Plus and Nano X: emulator screens, not photographs of the
  Stax.
- **Fuzzed.** The XRP app's transaction parser and session policy, built natively under
  AddressSanitizer and UndefinedBehaviorSanitizer, took 448 million random mutations of the fuzz
  corpus and of every test vector in 15 minutes with no crash (`ledger-app/fuzzing/native/run.sh`).
  This loop is not coverage-guided; the ClusterFuzzLite fuzzer of `ledger-app/fuzzing/` needs Docker
  and was not run.
- **Reviewed.** Protocol changes went through independent read-only review gates, whose verdicts
  are in the DEVLOG. They found defects in our own work too, such as a `WitnessSignature` that
  anyone could add to a transaction to change its hash, opened by our witness extension and closed
  in #92. Each fix landed with a test that failed first.

### What is real, what is simulated, what is not done

|                             | Real                                                                                                                                                                                                                                    | Simulated, or not done                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Node with the amendment** | a standalone `xrpld` built from `rippled/`; every mode, refusal and the expiry checked against it                                                                                                                                       | not on a public network: the public AlphaNet does not carry `SigningSessions`                                                                                                                                                                    |
| **Ledger Stax**             | the ML-DSA-44 key and the three AlphaNet payments above; the review of a `SigningSessionSet` in modes C and P, signed with the classical and the ML-DSA-44 key and verified locally (not submitted then: no node had the amendment yet) | the DEVLOG does not yet record a session opened on the Stax and accepted by the node (tasks W3 and W7); the other device screens are emulator snapshots; the web app's default device is a software double of the device contract                |
| **Passkey**                 | WebAuthn assertions over the binary signing data, verified by our node with `fixPasskeyChallenge`                                                                                                                                       | every recorded run used a software authenticator (real P-256, no prompt); no real WebAuthn ceremony is recorded                                                                                                                                  |
| **Web app**                 | the Quantum screen against the real AlphaNet and mainnet; the live backend's stores against the amendment node, driven from Node                                                                                                        | on the hosted page, Session, Actions and Attack are SIMULATED; the screens were not run in a browser against the amendment node                                                                                                                  |
| **Stage demos and agent**   | built on the amendment node, the device contract and a real Stax over WebHID; the wallet's end-to-end script passed its 38 checks against the final node                                                                                | no automated tests in CI; they run on the team's network only                                                                                                                                                                                    |
| **Not done**                |                                                                                                                                                                                                                                         | a coverage-guided fuzzing run (only the native mutation loop ran); an end-to-end test in CI (the rippled and device suites run by hand, recorded in the DEVLOG); `infra/Dockerfile`; the ecosystem tasks E1 and E2 ([below](#contributing-back)) |

## What building it made visible

Developer feedback is a deliverable of the Ledger track, written as we went:
[`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md) holds 48 entries and 428 minutes lost
where we measured them. The recurring pattern is not missing features but unstated facts. What cost
us the most:

- **ML-DSA is not in the Stax's OS crypto library.** It sits in the SDK sources, not in
  `cx.export`, so an app compiles it itself; nothing says so, and the first link attempt is the
  documentation. `HAVE_MLDSA_OPTIMIZATION` selects the low-RAM variant, not a faster one, and the
  budget is tight: about 31 KB of statics on 36 KB of SRAM that also holds the stack, with no tool
  that reports what is left.
- **Clear-signing a new XRPL transaction type touches about eight places** in app-xrp, and a missed
  one silently falls back to blind signing or "Unknown", or clear-signs flag bits it should not.
- **Who adds the signing prefix is unstated.** The app prepends `STX\0` itself and the Device
  Management Kit forwards the bytes unchanged; a client that adds it gets a signature over the
  wrong bytes.
- **Loading from macOS.** Docker Desktop does not pass USB to a container, so loading goes through
  `ledgerblue`; a locked device answers `0x5515`, an open app `0x6d00`, and side-loading an app
  named `XRP` deletes the store version first.
- **The XRPL side.** A browser cannot POST JSON to the AlphaNet RPC (its CORS preflight answers
  400); `account_tx` with `forward` gets an HTTP 403 from its proxy; `account_objects` reads the
  validated ledger, so a freshly funded account is not there yet; `ripple-binary-codec` 2.11.0
  leaves `PermissionValue` without a serializer under custom definitions (root cause and workaround
  in the log); xrpl.js rejects `PasskeyListSet`; and a standalone node seeds its genesis amendments
  from `[amendments]`, not `[features]`.

**In the imported bases:**

- **P5, the WebAuthn challenge.** Where `char` is signed (x86-64, macOS on arm64), the challenge
  comparison fails for any byte at or above `0x80`, and every challenge holds one (`0xF6`, the
  P-256 key prefix): the unchanged node refuses every WebAuthn signature. Shown by a test that
  failed first (with a software authenticator), then fixed behind a new amendment,
  `fixPasskeyChallenge`.
- **P-256 malleability.** The DER parser accepted non-canonical forms and a high S and could read
  one byte past a signature, the node's own signer produced a high S half the time, a
  `PasskeySignature` or a `TxnSignature` could sit unread next to the signature that counts, and a
  channel claim or a cross-chain attestation took the lax form: anyone relaying a P-256 or
  passkey-signed transaction could change its hash. Fixed behind a new amendment,
  `fixP256StrictDer`, plus two fixes that need none. Still open, and documented:
  `PasskeySignature.PasskeyID` is neither signed nor checked.
- **P6, the passkey list.** A second `PasskeyListSet` fails with `tefEXCEPTION`, so a passkey can
  be neither rotated nor revoked while it keeps full authority (verified on the public AlphaNet;
  not fixed).
- **A `Batch` hides a failed key migration.** An all-or-nothing `Batch` of `SetRegularKey` and
  `asfDisableMaster` returns `tesSUCCESS` and applies neither, because an inner transaction carries
  no signature of its own; now pinned in a test.
- **The alphanet tree fails its own suites**: 201 assertions in seven suites, and one gtest, so
  every change was judged per assertion against [`docs/base-failures.txt`](./docs/base-failures.txt).

## Limits and roadmap

Quantum-safe by default means that the default profile, the Ledger account, has its master key
disabled and no passkey, and uses ML-DSA-44 session keys. It holds while the account has no other
authority that survives `asfDisableMaster` (a signer list, a delegate, a beneficiary key), and the
session key's type is a client policy that neither the ledger nor the device enforces. Section 16
of the specification gives the reason and the code behind each limit:

| Limit                                                                                           | Bounded today by                                                                                          | Roadmap                                                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Mac accounts are classical: P-256 master key, passkey and session keys                          | the session rules; the test wallet's post-quantum Touch ID account puts no P-256 key on the ledger (#106) | ML-DSA-44 session keys there too, once they can be non-extractible |
| ML-DSA-44 session keys live in page memory: WebCrypto has no ML-DSA                             | the ledger-side bounds, a fresh key per session, CSP `script-src 'self'`                                  | a non-extractible ML-DSA key from the platform                     |
| A Ledger-account transaction carries a 1,312-byte key and a 2,420-byte signature                | the base fee is unchanged; the device signs at most 2,048 bytes                                           | measure the largest transactions                                   |
| A passkey list can be neither replaced nor removed (P6)                                         | a Ledger account starts fresh and never gets a passkey                                                    | a protocol fix upstream                                            |
| `PasskeySignature.PasskeyID` is neither signed nor checked: a relay can change it, and the hash | the client finds a transaction by account and sequence; the apps still poll by hash                       | bind it under `fixP256StrictDer`, or report it upstream            |
| The P5 and P-256 fixes exist on our node only                                                   | `fixPasskeyChallenge` and `fixP256StrictDer` there; the public AlphaNet has neither                       | offer both upstream                                                |
| Ledger's v1 ML-DSA on the device has no side-channel countermeasures                            | stated wherever the root key is described                                                                 | Ledger's hardened ML-DSA                                           |
| A `Batch` cannot migrate keys atomically                                                        | three transactions with a proof step in between                                                           | none needed                                                        |

## Tech stack

- **Protocol**: C++, a rippled amendment on `XRPLF/rippled` `alphanet` (xrpld 3.4.1, imported at
  `68bd02b647`), with jtx and gtest suites.
- **Device**: C, the XRP app (`LedgerHQ/app-xrp` 2.8.2) with the Ledger Secure SDK's ML-DSA in its
  low-RAM variant and NBGL screens; cmocka unit tests, Ragger on the Speculos emulator.
- **Client**: TypeScript 5.9 strict. `ripple-binary-codec` 2.11.0 with the node's own
  `server_definitions` (xrpl.js rejects the new types), `@noble/post-quantum` 0.7.1 for ML-DSA-44,
  non-extractible WebCrypto P-256 keys, WebAuthn, and the Ledger Device Management Kit 1.11.0 over
  WebHID with Ledger's XRP signer kit 0.3.0, extended: no legacy ledgerjs package.
- **Web app**: Nuxt 3, Vue 3 and Tailwind, generated from XRPL Commons' `create-xrp` 0.5.0; a
  wallet entry on the `xrpl-connect` 1.0.0 `WalletAdapter` interface; CSP `script-src 'self'` and no
  third-party script; a static build on Vercel.
- **Infra**: a standalone `xrpld` with its ledger closer (one ledger every 3 seconds) and a dev
  faucet, started together by `pnpm demo`; Docker Compose for the team's stack.
- **Agent demo**: an OpenAI-compatible LLM endpoint (a local Ollama model by default) and a mock
  x402 merchant.

## Repository structure

```text
rippled/                XRPLF/rippled alphanet, imported unmodified, then the amendment and the upstream fixes
  include/xrpl/tx/SigningSession.h      the session-signed predicate and the excluded types
  src/libxrpl/tx/transactors/session/   SigningSessionSet, SigningSessionDelete
  src/libxrpl/tx/invariants/            ValidSigningSession, with the other invariants
  src/test/app/                         SigningSessions, SigningSessionsBatch, P256StrictDer, among the suites
ledger-app/             LedgerHQ/app-xrp, imported unmodified, then clear signing, ML-DSA-44 and the session policy
  src/pq/               the post-quantum root, instructions 0x10 to 0x12
  src/policy/           the session policy and its profiles
packages/core/          @carbs/sessions: definitions, encoding, session keys, node client, quantum exposure check
packages/ledger/        @carbs/ledger: the device contract over the Device Management Kit, and a software double
packages/signer-kit-xrp/  Ledger's XRP signer kit, imported unmodified, then the ML-DSA-44 root and the session policy
apps/web/               the web app: six screens (Apps links to the stage demos), the wallet entry, a static build
apps/passkey-wallet/    the test wallet and the stage demos: agent, game, DEX, stream, mint
  scripts/agent/        the AI agent on a budget, the mock x402 merchant and the run sheet
infra/                  the standalone node's configuration, the ledger closer, the compose stack
scripts/                pnpm demo: the node, the closer, a dev faucet and the web app on the live backend
docs/
  XLS-Sessions.md       the XLS draft, written from the implementation
  ARCHITECTURE.md       map, wire formats, flows, hook points, limits and roadmap
  device-contract.md    every APDU, status word and screen line between the client and the app
  ledger-dx-feedback.md the developer feedback deliverable
  DEVLOG.md             what was done, simulated, failed or not run, dated
  adr/                  decision records
  base-failures.txt     the imported tree's own test failures, one assertion per line
FIANSO-SPEC.md          the specification (Sofiane's), the reference for every decision
UPSTREAM.md             what was imported, from where, at which commit, under which licence
```

## Getting started

Node 22.18 or newer and pnpm 10.33.0 (`.nvmrc`, `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck        # also prepares Nuxt, which the web app's tests need
pnpm test             # @carbs/sessions, @carbs/ledger, the web app, scripts

# the standalone node with the amendment, its closer, a dev faucet and the web app on the live backend
XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo
# with the node started by `pnpm demo --no-web`: the flows of the DEVLOG, asserting the node's codes
pnpm --filter web live-run
```

The daemon builds from `rippled/` with Conan and CMake ([`docs/BUILDING.md`](./docs/BUILDING.md),
recorded from a working build), and the protocol suites run from its build directory:

```sh
./xrpld --unittest=SigningSessions,SigningSessionsBatch,InvariantsSigningSession,P256StrictDer
```

The Ledger app builds in the `ledger-app-builder` image and loads from macOS with `ledgerblue`; its
unit tests run natively ([`docs/BUILDING.md`](./docs/BUILDING.md)). The genesis seed of `pnpm demo`
comes from the environment: it is never written, and never passed to the node, the closer or the
web app.

### Ripple DevRel DevEx capture hook (optional, per developer)

Builders who use a coding agent are asked to install the hook from `RippleDevRel/xrpl-devex-hook`.
It records XRPL friction pseudonymously and nothing without an XRPL keyword. Each developer
consents on their own; it is **not** committed to this repository (`xrpl-devex-hook/`,
`.xrpl-devex/` and the agent skill folders are git-ignored). Follow the instructions in that
repository, then use `/xrpl-feedback <what happened>` whenever the XRPL or Ledger documentation, the
SDKs or the node cost you time.

## Contributing back

Nothing has been sent upstream yet: decision D7 of the specification keeps the defects for the
presentation. Ready to offer, each with tests that failed before its fix (written as separate
commits, then squashed into #87 on `develop`):

- **`fixPasskeyChallenge`**: passkeys work on servers where `char` is signed (P5).
- **`fixP256StrictDer`**: strict DER and a low S for every P-256 signature a transaction carries,
  and no signature field left unread; with two fixes that need no amendment, the parser's
  over-read and low-S signing.
- **Documented for upstream, not fixed**: the passkey list that cannot be replaced (P6) and the
  unsigned `PasskeyID`, in `rippled/API-CHANGELOG.md` under _Known issues_.
- **The XLS draft**, [`docs/XLS-Sessions.md`](./docs/XLS-Sessions.md), and the developer feedback,
  with a suggested fix for each entry.
- **Planned, not built**: a Device Management Kit adapter for `xrpl-connect`, whose Ledger adapter
  uses the legacy ledgerjs packages, and a sessions template for `create-xrp` (tasks E1 and E2).

Commits and pull requests follow rippled's conventions (section 14 of the specification,
[`.github/pull_request_template.md`](./.github/pull_request_template.md)). `rippled/` and
`ledger-app/` are unmodified upstream imports up to their import commits
([`UPSTREAM.md`](./UPSTREAM.md)), and no upstream test is removed or edited to make it pass.

## Team

**carbs**: Sofiane Ben Taleb ([@gamween](https://github.com/gamween)) and Armand Séchon
([@STOOOKEEE](https://github.com/STOOOKEEE)).

**Prior work.** An earlier design ("v2": a witness co-signer, `ForceQuantum`, XRP-only payments)
and a prototype of it exist in `STOOOKEEE/TTT` (branch `feat/signing-sessions`), along with the
preparation dossier of the current design (`docs/carbs/`). **Nothing from the prototype is used
here**: no file was copied, patched or retyped. The history of this repository starts with the
specification; every code commit after it is written here, and the upstream bases are imported
unmodified in their own commits ([`UPSTREAM.md`](./UPSTREAM.md)). The witness and the per-payment
cap of today's amendment were first written in this repository, in pull request #29, and landed on
`develop` in #59.

The web app starts from XRPL Commons' `create-xrp` template and follows the look of
xrpl-commons.org, with its fonts self-hosted under their own licences.

## License

[Apache-2.0](./LICENSE) for the code written in this repository; changes made inside `rippled/`
that are meant for the XRPL code base follow its ISC licence. Imported code keeps its own licence:
`rippled/LICENSE.md` (ISC), `ledger-app/LICENSE` (Apache-2.0) and `apps/web/LICENSE` (MIT, the
`create-xrp` template). The fonts are Clash Display under the ITF Free Font License and Plus
Jakarta Sans under the SIL Open Font License 1.1
([`apps/web/public/fonts/README.md`](./apps/web/public/fonts/README.md)).

<div align="center">
<sub>Built at the XRPL Hackathon NYC · October 2026 · Protocol Innovation and Ledger Protocol Innovation</sub>
</div>
