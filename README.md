# carbs

**Ledger-enforced signing sessions for the XRP Ledger.**

On XRPL a key has all the authority of an account or none. A person who wants "approve once, then sign several transactions without a prompt", or an agent that must pay, has to hold an unbounded hot key or ask for a signature every time. carbs adds the missing middle: a **session**, a short-lived key (at most 10 minutes) whose limits are checked by **the ledger itself**.

| Mode  | A session key may                                              | Bound                                              |
| ----- | -------------------------------------------------------------- | -------------------------------------------------- |
| **A** | sign every delegable transaction type except an exclusion list | time, fee ceiling                                  |
| **P** | sign the listed XLS-75 permissions                             | time, the list, fee ceiling                        |
| **C** | send direct XRP `Payment` only                                 | time, a total XRP cap (fees included), fee ceiling |

A session is opened with **one ordinary signature**, either from a **passkey** or from a **Ledger Stax that shows the rules on its screen** (clear signing). A session key can never change who controls the account. It is a rippled amendment (`SigningSessions`), not a wrapper, which is what makes the bounds real.

> **Status: architecture only.** The repository contains the two upstream bases (imported unmodified), the workspace skeleton, CI, the architecture and the specification. There is no amendment, no Ledger clear signing and no client code yet. This README says what exists; it will be updated as it changes.

## Where to read

|                                                            |                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`FIANSO-SPEC.md`](FIANSO-SPEC.md)                         | The build specification: protocol, Ledger app, client, spikes, work breakdown, demo, conventions (Sofiane's spec) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)             | The map of the repository, wire formats, flows, hook points, commands                                             |
| [`docs/adr/`](docs/adr/)                                   | Decision records                                                                                                  |
| [`UPSTREAM.md`](UPSTREAM.md)                               | What was imported, from where, at which commit, under which licence                                               |
| [`docs/DEVLOG.md`](docs/DEVLOG.md)                         | What was done, removed, ignored or simulated, dated                                                               |
| [`docs/ledger-dx-feedback.md`](docs/ledger-dx-feedback.md) | Our feedback on the Ledger documentation and SDKs, written as we go                                               |

## Layout

```text
rippled/        XRPLF/rippled:alphanet, imported unmodified, then the amendment
ledger-app/     LedgerHQ/app-xrp, imported unmodified, then clear signing
packages/core/  @carbs/sessions: client library (no DOM, no framework)
packages/ledger/ @carbs/ledger: Device Management Kit library (stretch)
apps/web/       the demo application
infra/          standalone node configuration and the ledger closer
docs/           architecture, decisions, DEVLOG, Ledger feedback
```

## Before the kickoff / During the hackathon

Everything we submit as code is written during the hackathon (24-25 Oct 2026, kickoff 24 Oct 10:00 ET). What existed before, and what did not:

|                          | When                     | What                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Before the kickoff**   | 21-22 Oct                | An idea and a first design ("v2": a witness co-signer, `ForceQuantum`, XRP-only payments), an XLS draft and plans, in `STOOOKEEE/TTT`                                                                                                                                                                                              |
|                          | 21-23 Oct                | A full prototype of that v2 design (branch `feat/signing-sessions` of `STOOOKEEE/TTT`, one commit, 135 files). **It is not reused here**: nothing was copied, patched or retyped from it                                                                                                                                           |
|                          | 23 Oct - 24 Oct 08:32 ET | A review, and the "v3" preparation dossier (`docs/carbs/` in `STOOOKEEE/TTT`): the design this repository builds                                                                                                                                                                                                                   |
| **During the hackathon** | from 24 Oct 10:00 ET     | Updates to that dossier up to noon, then this repository from its first commit (24 Oct 11:24 ET): the specification (documentation, a consolidation and translation of the dossier), the two upstream imports, the workspace, CI, the architecture and decision records, and everything built after (see the DEVLOG and `git log`) |

The v3 design is of the same family as the v2 prototype (same ledger entry idea, same two transactions, same families of result codes). It differs in substance: no witness, three modes, relative duration, a fee ceiling, the XLS-75 engine, and the XRPLF base.

## Working on it

```sh
pnpm install            # Node >= 22.18, pnpm 10.18.3 (see .nvmrc, package.json)
pnpm format:check
pnpm typecheck
pnpm test
```

The daemon and the Ledger app have their own build and test commands, listed in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Commits and pull requests follow the rippled conventions (section 14 of the specification, [`.github/pull_request_template.md`](.github/pull_request_template.md)).

### Ripple DevRel DevEx capture hook (optional, per developer)

The organizers ask builders who use a coding agent to install the hook from `RippleDevRel/xrpl-devex-hook`. It records XRPL friction pseudonymously and nothing without an XRPL keyword. Each developer consents on their own; it is **not** committed to this repository (`xrpl-devex-hook/`, `.xrpl-devex/` and the agent skill folders are git-ignored). Follow the instructions in that repository, then use `/xrpl-feedback <what happened>` whenever the XRPL or Ledger documentation, the SDKs or the node cost you time.

## Licence

Imported code keeps its own licence (`rippled/LICENSE.md`, ISC; `ledger-app/LICENSE`, Apache-2.0). The licence of the code written in this repository is **not decided yet**.
