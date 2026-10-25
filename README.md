# carbs

**Quantum-safe by default, delegable signing for the XRP Ledger: the rules are enforced by the ledger and read on a Ledger device.**

On XRPL a key has all the authority of an account or none, and a public key that has signed once stays visible forever, which is a forgery target for a future quantum computer. carbs adds three things that fit together:

1. **A post-quantum root in hardware.** A Ledger Stax holds an **ML-DSA-44** key and clear-signs XRPL transactions with it, so an account can drop its classical keys (`SetRegularKey` to the ML-DSA key, then `asfDisableMaster`).
2. **Sessions enforced by the ledger.** A rippled amendment, `SigningSessions`, lets an account open a short-lived key (at most 10 minutes, measured in ledger close time: from the parent ledger's close time at opening, against the parent close time of each later ledger) that signs without prompting, bounded by the **ledger itself**:

   | Mode  | A session key may                                              | Bound                                              |
   | ----- | -------------------------------------------------------------- | -------------------------------------------------- |
   | **A** | sign every delegable transaction type except an exclusion list | time, fee ceiling                                  |
   | **P** | sign the listed XLS-75 permissions                             | time, the list, fee ceiling                        |
   | **C** | send direct XRP `Payment` only                                 | time, a total XRP cap (fees included), fee ceiling |

   A session is opened with **one ordinary signature**, from the Stax (which shows the rules on its screen) or from a passkey. A session key can never change who controls the account. The session's own close (a `SigningSessionDelete` signed by the session key) is exempt from the expiry and from the cap: its fee is not counted in mode C, and it may pay no more than the base fee its type requires, so a mode C account loses at most the cap plus one base fee. While the open ledger's fee is escalated above that, the own close can at best be queued, alone in its account's queue; the owner's close has no such ceiling and applies at once if it pays the open ledger's fee, at the account's sequence or with a ticket.

3. **A quantum exposure check and a guided migration** for any XRPL account, plus the `@carbs/sessions` library. Planned, **not built**: a Device Management Kit Ledger adapter for `xrpl-connect` and a `create-xrp` sessions template (spec 8.8, tasks E1 and E2).

> **Status.** The two upstream bases are imported unmodified and the specification is [`FIANSO-SPEC.md`](FIANSO-SPEC.md). Built and tested so far, on `develop`: the `SigningSessions` amendment in `rippled/` (modes A, P and C, the authorization hook, the accounting and its invariant), the client library `@carbs/sessions` (definitions from `server_definitions`, encoding, signatures, session builders, the quantum exposure check and migration, the passkey wallet) and `@carbs/ledger` (the device contract and a software double of the device), and the web app (`apps/web`) with its five screens. The web app runs on a **SIMULATED** backend by default (a striped badge marks every result that comes from it) and on a **live** one with `pnpm demo`: against the standalone node with the amendment it opens sessions on a local node, runs six kinds of transaction in modes A and P (payments in mode C) with no prompt and shows the node's own refusals (the stores were run from Node against a real node; the screens were not run in a browser); its Quantum screen reads the real AlphaNet and mainnet (read-only) and migrates a fresh AlphaNet account. **Still SIMULATED everywhere:** the Ledger device (a software double of the device contract) and the passkey authenticator in tests. **Not done:** the screens in a browser against a node, a real WebAuthn ceremony (human-only), a session opened and used from the real Stax with the amendment (W3, W7, L1 acceptance), the Device Management Kit and WebHID path in the web app, spikes K2, K4 (partly), K6 and K8, the end-to-end test in CI (W8), `infra/Dockerfile`, and the ecosystem tasks E1 and E2. What was not run, what is simulated and what failed is dated in [`docs/DEVLOG.md`](docs/DEVLOG.md).

## Where to read

|                                                            |                                                                                                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [`FIANSO-SPEC.md`](FIANSO-SPEC.md)                         | The specification: protocol, Ledger app, post-quantum root, exposure check, client, spikes, work breakdown, demo, conventions (Sofiane's spec) |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)             | The map of the repository, wire formats, flows, hook points, commands                                                                          |
| [`docs/adr/`](docs/adr/)                                   | Decision records                                                                                                                               |
| [`UPSTREAM.md`](UPSTREAM.md)                               | What was imported, from where, at which commit, under which licence                                                                            |
| [`docs/DEVLOG.md`](docs/DEVLOG.md)                         | What was done, removed, ignored or simulated, dated                                                                                            |
| [`docs/ledger-dx-feedback.md`](docs/ledger-dx-feedback.md) | Our feedback on the Ledger documentation and SDKs, written as we go                                                                            |

## Layout

```text
rippled/          XRPLF/rippled:alphanet, imported unmodified, then the amendment
ledger-app/       LedgerHQ/app-xrp, imported unmodified, then clear signing and ML-DSA
packages/core/    @carbs/sessions: client library (sessions, signing, quantum exposure check)
packages/ledger/  @carbs/ledger: Device Management Kit library (stretch)
apps/web/         the web app: five screens, wallet entry, static build (docs/DEPLOY.md)
infra/            standalone node configuration and the ledger closer
docs/             architecture, decisions, DEVLOG, Ledger feedback
```

## Prior work

An earlier design ("v2": a witness co-signer, `ForceQuantum`, XRP-only payments) and a prototype of it exist in `STOOOKEEE/TTT` (branch `feat/signing-sessions`), along with the preparation dossier of the current design (`docs/carbs/`). **Nothing from the prototype is used here**: no file was copied, patched or retyped. The history of this repository starts with the specification; every code commit after it is written here, and the two upstream bases are imported unmodified in their own commits ([`UPSTREAM.md`](UPSTREAM.md)).

## Working on it

```sh
pnpm install            # Node >= 22.18, pnpm 10.33.0 (see .nvmrc, package.json)
pnpm format:check
pnpm typecheck
pnpm test

# the standalone node, its closer, a dev faucet and the web app on the live backend:
XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo
```

The daemon and the Ledger app have their own build and test commands: see [`docs/BUILDING.md`](docs/BUILDING.md) (recorded from a working daemon build) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Commits and pull requests follow the rippled conventions (section 14 of the specification, [`.github/pull_request_template.md`](.github/pull_request_template.md)).

### Ripple DevRel DevEx capture hook (optional, per developer)

Builders who use a coding agent are asked to install the hook from `RippleDevRel/xrpl-devex-hook`. It records XRPL friction pseudonymously and nothing without an XRPL keyword. Each developer consents on their own; it is **not** committed to this repository (`xrpl-devex-hook/`, `.xrpl-devex/` and the agent skill folders are git-ignored). Follow the instructions in that repository, then use `/xrpl-feedback <what happened>` whenever the XRPL or Ledger documentation, the SDKs or the node cost you time.

## Licence

Apache-2.0 for the code written in this repository (see [`LICENSE`](LICENSE)); changes made inside `rippled/` that are meant for the XRPL code base follow its ISC licence. Imported code keeps its own licence (`rippled/LICENSE.md`, ISC; `ledger-app/LICENSE`, Apache-2.0).
