# carbs: FIANSO-SPEC v1 (draft)

| | |
|---|---|
| **Author** | Sofiane ("fianso", [@STOOOKEEE](https://github.com/STOOOKEEE)). |
| **Status** | **Draft of a possible next version.** [`FIANSO-SPEC.md`](FIANSO-SPEC.md) (v0, on `main`) remains the reference until a decision says otherwise. This file lives on the personal branch `fianso/spec-v1`. Nothing here is decided; items needing a decision are listed in [§9](#9-decisions-to-take-for-v1). |
| **Written** | 2026-10-24, around noon ET, after the 10:00 ET kickoff and before any implementation code. Documentation only. |
| **Relation to v0** | v1 keeps everything in v0 (protocol, Ledger clear signing, client, spikes, conventions) and **adds what makes it useful to the whole XRPL community** instead of one demo. Sections not repeated here are unchanged. Note that v1 was written after the kickoff, like v0 (see the README, "Before the kickoff / During the hackathon"). |

---

## 1. Thesis

v0 answers a protocol gap. v1 asks what the community would actually *use* on Monday morning, and ships that with the protocol:

> **carbs: ledger-enforced spending authority for humans and agents on the XRP Ledger.** A person (passkey or Ledger) authorizes a short-lived key whose limits are checked by the ledger itself; an AI agent can then act and pay inside those limits, with no custodian and no policy server that could be bypassed.

Four deliverables, in dependency order:

| # | Deliverable | Who benefits | Where it lives |
|---|---|---|---|
| **D-1** | **Protocol**: the `SigningSessions` amendment (v0 §6): time, permissions or XRP cap, enforced by the ledger | wallets, agents, institutions | `rippled/` |
| **D-2** | **A Device Management Kit Ledger adapter for `xrpl-connect`**, with a clear / blind / refused preview and session opening; proposed upstream as a pull request | every dApp that uses `xrpl-connect` (Xaman, GemWallet, WalletConnect, Ledger…) | PR to `XRPL-Commons/xrpl-connect` |
| **D-3** | **`@carbs/sessions`** (TypeScript library) and a **sessions template for `create-xrp`** (scaffold-xrp): a new dApp gets session keys, passkey opening and Ledger opening in one command | developers starting on XRPL | `packages/core`, template PR |
| **D-4** | **Agent budget demo**: an agent pays x402 invoices with a mode-C session key whose budget a human approved on the Ledger | the "AI & Fintech" story; Ledger "agents that pay, with a human approving on device" | `apps/web`, `examples/agent` |

Plus the documentation and developer-experience feedback to Ledger and to Ripple DevRel (v0 §7.6), now fed by the Ripple DevEx capture hook (§7).

---

## 2. Evidence: what the community is asking for

**Read from GitHub (verified with the API on 2026-10-24).**

| Source | What it says | Why it matters here |
|---|---|---|
| XRPL-Standards [#657](https://github.com/XRPLF/XRPL-Standards/discussions/657) "Delegate auto-expiry" (opened 2026-10-08, open) | XLS-75 grants have no expiry; "the narrow grant must be able to end without the master key coming back online". Mayukha asks what happens when permissions are updated before and after expiry, and prefers one clock | Sessions *are* expiring grants. v0 makes update impossible (delete and reopen) and uses time only |
| XRPL-Standards [#572](https://github.com/XRPLF/XRPL-Standards/discussions/572) "Agent Identity" | Mayukha: "What new functionality does this provide that isn't already satisfied by XLS-40/70/75?" | The honest answer is the **amount cap** and the **expiry**; mode C is exactly that |
| XRPL-Standards [#574](https://github.com/XRPLF/XRPL-Standards/discussions/574) "Direct Debit" (8 upvotes) and [#222](https://github.com/XRPLF/XRPL-Standards/discussions/222) Subscriptions | Pull-payment limits per pull / per interval | Neighbouring problem; sessions bound the *signer*, not the payee |
| XRPL-Standards [#589](https://github.com/XRPLF/XRPL-Standards/discussions/589) "On-Chain Cosigner" (5 upvotes) | Native on-ledger signature collection; the authors ask "is anyone actually experiencing this problem?" | Lesson: proposals are asked for **real users and evidence**; D-2 to D-4 are how we bring them |
| XRPL-Standards [#236](https://github.com/XRPLF/XRPL-Standards/discussions/236) / [#237](https://github.com/XRPLF/XRPL-Standards/discussions/237) passkeys | Passkey signature support and ES256 | Our passkey opening builds on it |
| `XRPL-Commons/xrpl-connect` `packages/adapters/ledger` | The Ledger adapter uses the **legacy** `@ledgerhq/hw-app-xrp` + `hw-transport-webhid` / `webusb`, plain `signTransaction`, no preview, package version 0.8.2 on `develop` (the coordinated v1.0.0 release PRs were merged in October) | A concrete, reviewable gap that Ledger itself wants closed (Device Management Kit, not legacy) |
| `XRPL-Commons/scaffold-xrp` | `npx create-xrp` generates a Next.js or **Nuxt (Vue)** app with `xrpl-connect` (Xaman, GemWallet, WalletConnect), Testnet / Devnet; no Ledger | The starting point of new XRPL dApps, and it has no hardware-wallet path |
| Hackathon platform | `Feedback Plugin` (`RippleDevRel/xrpl-devex-hook`) and Ledger's "XRP Signer" (DMK) and "Ledger for Agents" are the listed resources | Judges care about developer experience and the Ledger SDK path |

**Read from X on 2026-10-24 (read-only browsing; engagement figures as displayed; not independently re-verified).**

| Signal | Posts |
|---|---|
| XLS-75 Permission Delegation went **live on mainnet** (Oct 8) and is pitched as "only specific things, limits enforced onchain" | `x.com/Vet_X0/status/2108310135630111109` (1.2k likes), `x.com/Archie_XRPL/status/2108106063165698082`, `x.com/piggedup/status/2108171034138427528` |
| Agent payments are the loudest XRPL topic: 10M+ x402 payments settled, XRPL AI Starter Kit, Privy wallets with **off-ledger policies**, Open Wallet Standard / Stripe-Tempo MPP | `x.com/ja_akinyele/status/2108670853831671918` (1.7k), `x.com/RippleXDev/status/2064701950285713878` (1.3k), `x.com/XRPLF/status/2110049938281464157`, `x.com/Ripple/status/2110047614922375447` (4.3k) |
| Ledger's own bounty text: "Agents that pay, with a human approving on device", "Build what Ledger doesn't support yet" | `x.com/Ledger/status/2113254052989374684` |
| Hardware-backed and biometric unlock are a live trend; Flare "smart accounts" pitch the one-click wallet as a competitor narrative | `x.com/xrplto/status/2113805243779608837`, `x.com/webauthwallet/status/1990845466297192871`, `x.com/0xQuantic/status/2104165896189071708` |
| Quantum-resistant accounts already demoed publicly with Batch by Denis; our PQ story must extend it, not repeat it | `x.com/angell_denis/status/2108681010288156819` |

**Synthesis.** (1) Agents that can pay, *safely*: the only control layer visible on X is an off-ledger policy engine, and a ledger-enforced limit is the gap. (2) Granular delegation instead of sharing a whole key: XLS-75 just shipped, without a time limit or an amount cap. (3) A human approving on a hardware device. (4) Hardware or biometric login. (5) Quantum safety without a hard fork. v0 covers 1 to 3 and 5 at the protocol level; v1 makes them *reachable* by developers and agents.

---

## 3. What changes in the protocol work (D-1)

Unchanged from v0 §6 except:

1. **Re-base the text on the live XLS-75.** Permission Delegation is active on mainnet since Oct 8 (per the X posts above; check `feature` on the node). The XLS draft cites #657 and #572 and states what sessions add (time bound, amount cap, a key rather than a second funded account).
2. **Mode C for assets other than XRP is the open design question.** x402 on XRPL settles in XRP and RLUSD (per the `@t54ai` facilitator post: `x.com/t54ai/status/2081412669022564707`, to confirm in spike K7). v0 mode C is **XRP only** by design, because the cap counts native XRP. Two options:
   - **v1-A (default, no protocol change)**: the demo uses XRP x402 payments in mode C.
   - **v1-B (protocol extension, research)**: `SessionCap` may be an issued-currency amount for a single (currency, issuer); the whitelist then allows only a direct payment in that asset; the invariant compares the trust-line balance delta with the counter; fees stay bounded by the XRP fee ceiling. This needs new invariants and a test for every path (paths, `SendMax`, partial payments, transfer fees, freeze, clawback), and v0 §4.5 explicitly excludes it today. Do it only if v1-A shows a real need.
3. **Publish the draft after the event** as an XRPL-Standards discussion that links #657 and #572 (and credits the people who asked the questions). Not before a decision; never sent by an agent.

---

## 4. D-2: a Device Management Kit Ledger adapter for `xrpl-connect`

**Why.** The current adapter signs with the legacy ledgerjs stack and gives the dApp no information about what the device will show. Ledger's own tooling is the Device Management Kit; its XRP signer (`@ledgerhq/device-signer-kit-xrp` 0.3.0) forwards raw transaction bytes. The adapter is small, isolated, reviewable, and used by every dApp built on the toolkit.

**Scope.**
- A new package `packages/adapters/ledger-dmk` implementing `WalletAdapter` (connect, account, sign transaction, sign message, events, errors) on `@ledgerhq/device-management-kit` + `device-signer-kit-xrp` + `@ledgerhq/device-transport-kit-web-hid`. Keep the legacy `adapter-ledger` untouched so nothing breaks.
- **Signing preview**: `previewSignature(tx)` returns `clear`, `blind` or `refused` for a given transaction type, using the app version and a table of types the app clear-signs. Shown in the connect UI so users know what they will see on the device. (The prediction logic is shared with L4 in v0 §7.4.)
- **Session support**: `openSession({ mode, duration, permissions | cap })` builds `SigningSessionSet`, has the device sign it, and returns a session handle usable by the app; available only when the connected node advertises `SigningSessions`.
- Tests with the DMK mock server, docs under `docs/`, a changeset or release note as their contribution guide asks.

**Process (their CONTRIBUTING and adapter guide).** Open an issue first for a non-trivial change; **fork** `XRPL-Commons/xrpl-connect`; follow `docs/guide/adapter-integration.md` (it explicitly starts with "Fork and Clone"); Node 20.19+/22.18+/24.11+, pnpm 10.18.3, Vite+ (`pnpm exec vp install`, `vp run test`, `vp check`). One PR per change, in the style of their recent PRs: scoped conventional commits such as `fix(ui): ...`, `feat(adapter-ghostsig): ...`, referencing the issue number. Each upstream repository's own convention wins over ours (v0 §14).

**UNVERIFIED.** The exact `WalletAdapter` interface and event contract (read `packages/core` and the Xaman reference adapter first); whether their maintainers prefer a replacement or a sibling package; how multisigning is handled by the DMK signer (their legacy adapter implements it).

---

## 5. D-3: `@carbs/sessions` and a `create-xrp` template

- `packages/core` is published as an installable library (`@carbs/sessions`): definitions from `server_definitions`, encoding, session key lifecycle (WebCrypto non-extractible), `buildSessionSet`, `buildSessionDelete`, passkey opening, Ledger opening via D-2, node client, typed errors including the three `tefSESSION_*` codes.
- A **sessions template** for `create-xrp` (Nuxt, Vue 3, same stack as v0 §8): the generated app has a "Session" page (open with passkey or Ledger, countdown, spent / cap, close) next to the payment form. Contribution path: `packages/create-xrp` of `XRPL-Commons/scaffold-xrp` (templates ship with each CLI release, so it is a PR, not a fork of a moving branch).
- **The front of carbs itself** starts from the generated `create-xrp` Nuxt app rather than a blank Vite project: it brings wallet connection, the Testnet / Devnet selector and the payment form for free, and shows the judges that we build on their tooling. The generated tree is recorded in `UPSTREAM.md` like the other imports. Wallet signing for our new types does not go through Xaman or GemWallet (they do not know types 130 / 131); it goes through our own signers.

**UNVERIFIED.** How the Nuxt template handles client-only APIs (WebAuthn, WebHID, WebCrypto) under SSR (use `<ClientOnly>` and dynamic imports; `ssr: false` for the app is the safe default).

---

## 6. D-4: the agent budget demo

**Scene.** A person opens a mode-C session from the Ledger: "20 XRP, 10 minutes", read and approved on the Stax. An agent (a script, optionally driven by an LLM) holds only the non-extractible session key and pays x402 invoices from a paid API; the ledger refuses the payment that would exceed 20 XRP, `tefSESSION_LIMIT`, no matter what the agent's code or prompt says. The person can also kill the session at any time.

**Why it lands.** It is the same sentence as Ledger's agentic bounty ("agents that pay, with a human approving on device"), the hackathon's "AI & Fintech" theme, and it contrasts with the only control layer visible today on X (an off-ledger policy engine): here the limit is a **consensus rule**.

**Parts.** `examples/agent` (TypeScript): a minimal x402 client on XRPL, a toy paid endpoint, a loop that shows each payment with its node result; the web app's Session screen shows the same budget bar. **Spike K7** (before anything else): how x402 on XRPL works today (which scheme, which assets, which facilitator API, how the payment transaction is signed), so we pay an invoice with a **direct XRP `Payment`** a mode-C key may sign; if the schemes force RLUSD, see §3, option v1-B.

---

## 7. Documentation and developer-experience feedback (extends v0 §7.6)

- The Ripple DevRel capture hook (`RippleDevRel/xrpl-devex-hook`, listed on the hackathon platform as "Feedback Plugin" and presented at the kickoff workshop as "if you are using an agent to code, install this plug-in") is installed in the build repository. It records XRPL friction (docs gaps, misleading result codes, SDK footguns, retries) pseudonymously for the organizers. **`/xrpl-feedback <what happened>` takes five seconds**: use it every time something in the XRPL docs, `rippled`, `xrpl.js`, the faucets or the Ledger docs costs us time.
- The same events feed `docs/ledger-dx-feedback.md` (Ledger) and the XRPL feedback (RippleX, XRPL Commons), with honest minutes lost, screenshots and pull requests.
- XRPL Commons said developer experience is important to them: the xrpl-connect and scaffold-xrp contributions (§4, §5) are the strongest form of that feedback, because they fix what we hit.

---

## 8. How v1 fits the judging

| Criterion (25% each) | v0 | v1 adds |
|---|---|---|
| Idea | ledger-enforced session keys, three modes | the agent-budget framing and an answer to two open standards discussions (#657, #572) |
| Implementation | amendment, clear-signing app, client | a reviewed DMK adapter and a template that other teams can use during the same weekend |
| Demo quality | session from the Stax, refusals with node codes | the agent scene with a refused 6th payment, and "new dApp with sessions in one command" |
| Potential | embedded wallets, agents, custody | an upstream path: standards discussion, `xrpl-connect` PR, `create-xrp` template, Ledger docs PRs |

Tracks and opt-ins as decided in v0 (D6: Protocol Innovation + Ledger Protocol Innovation). See D6 in §9.

---

## 9. Decisions to take for v1

| # | Question | Proposal |
|---|---|---|
| **D9** | Adopt v1 as the plan (D-1 to D-4), or stay on v0 | v1, with D-1 as the critical path and D-2 to D-4 as additive, independently deliverable pieces |
| **D6 (revisit)** | v0 opted for Protocol Innovation + Ledger Protocol Innovation only. The agent-budget scene is literally Ledger's Agentic bounty ("agents that pay, with a human approving on device") | Keep the decision unless the cap on partner bounties allows a third; **confirm the cap with the organizers on site** |
| **D10** | Front base | the `create-xrp` Nuxt template (generated, recorded in `UPSTREAM.md`) |
| **D11** | Issued-currency cap (v1-B) | Only if spike K7 shows x402 needs it |
| **D12** | Fork or import for `rippled/` | Import (v0 §4), plus a real **fork** of `xrpl-connect` (and `scaffold-xrp`) for the upstream PRs, because their contribution guide requires it |
| **D13** | Publish the XLS draft and the PRs | After the event, by Sofiane, never by an agent |

---

## 10. Risks specific to v1 and plan B

| Risk | Plan B |
|---|---|
| The adapter interface or maintainer preferences make the `xrpl-connect` PR slow to merge | The adapter still ships in our repository as a package and the PR stays open; the judges see the contribution, not the merge |
| x402 on XRPL cannot be paid with a direct XRP payment | The demo uses a plain "agent buys API calls" flow with XRP payments to a toy endpoint and states how x402 maps (§3, v1-B) |
| Template work competes with the critical path (D-1) | D-2 to D-4 are additive: the protocol, L0 and L1 come first (v0 §10) |
| Over-claiming | Every number in the README and pitch is the repository's; what is simulated is said so (v0 §3) |

---

## Appendix: sources checked on 2026-10-24

GitHub API (discussions #657, #572, #574, #589, #236, #237, #222; `XRPL-Commons/xrpl-connect` adapter and CONTRIBUTING; `XRPL-Commons/scaffold-xrp` README; `RippleDevRel/xrpl-devex-hook`); the hackathon platform's published data (resources, tracks, team size 2 to 8); X posts listed in §2 (read-only).
