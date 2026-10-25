# AI agent on a budget signed on the Ledger Stax

> **Agent Policies, but enforced by the XRPL ledger, with a post-quantum root in the Stax.**

An LLM agent buys data from paid APIs (x402 style) for its owner. It never sees the owner's
key: it generates a session key, the owner clear-signs a mode C budget for it on the Ledger
Stax (`SigningSessionSet`: total cap, max per payment, short expiry), and from then on the
agent pays with that key only, with no human prompt. The carbs ledger (amendment
`SigningSessions`) enforces the budget: whatever the model decides, a payment outside the
budget is refused by the ledger. Above its per-payment limit the agent can only send an
**intent** to the human, who reviews and signs it on the Stax (what Ledger Agent Intent does,
which does not support the XRPL).

## Two guardrails

- **Device: session policy, at opening.** The XRP app of the Stax keeps the owner's own
  limits (Settings > Session policy): any `SigningSessionSet` beyond them is refused before
  its review, with `0x6986` (_Blocked by your session policy_). The wallet reports it to the
  agent with the note `refused by the session policy of the Stax (0x6986)`; the agent then
  asks for a smaller budget.
- **Ledger: SigningSessions, at every payment.** Once open, the budget is enforced by every
  XRPL node: `tefSESSION_LIMIT` above it, `tefSESSION_EXPIRED` after its expiry.

The Stax shows an **Agent ID** row on every session review: the first 4 bytes of the session
key's AccountID, `XXXX-XXXX` (`src/agent-id.ts`). The agent prints its own at start and sends
it with every event; the demo page shows it in large type, to compare before signing.

## The 3-minute run sheet

Node ≥ 22.18, from `apps/passkey-wallet` unless stated. An OpenAI-compatible LLM endpoint
(local Ollama by default: `ollama pull hf.co/mradermacher/Qwen3-4B-OBLITERATED-GGUF:Q4_K_M`).

| Terminal   | Command                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1 node     | standalone `xrpld` with `infra/standalone.cfg` (`--start` the first time, see `docs/BUILDING.md`): public WS `6006`, admin WS `6007`   |
| 2 closer   | from the repo root: `XRPLD_ADMIN_WS=ws://127.0.0.1:6007 node infra/closer.ts` (one ledger every 3 s; expiry is measured on close time) |
| 3 wallet   | `VITE_NODE_URL=ws://localhost:6006 pnpm build && PORT=18080 XRPLD_WS=ws://127.0.0.1:6006 GENESIS_SEED=… pnpm serve`                    |
| 4 merchant | `XRPLD_WS=ws://127.0.0.1:6006 GENESIS_SEED=… pnpm merchant` (prints its `payTo` and the attacker address)                              |
| 5 agent    | `XRPLD_WS=ws://127.0.0.1:6006 AGENT_SESSION_SECONDS=120 pnpm agent --wait-expiry` (started on stage, at 0:00)                          |

`pnpm build` builds both pages: the wallet (`/`) and the stage demo
**http://localhost:18080/demo.html**, which is what the projector shows.

### Before the clock starts

1. **Stax policy.** XRP app open on the Stax, _Settings > Session policy_: **on**, _Max spend_
   **50 XRP**, _Max per payment_ **5 XRP**, _Max duration_ **3 min**.
2. **Stax account.** In Chrome or Edge (WebHID), on `http://localhost:18080`, section
   **Ledger Stax**: _Connecter la Stax_, then _Financer le compte Stax (faucet)_. Optional, for
   the post-quantum line: migrate the account to its ML-DSA-44 root from the web app (Quantum
   screen); the demo page then says _signs with its ML-DSA-44 root_ and every approval is an
   ML-DSA-44 signature.
3. **Close that tab** (only one page can hold the Stax over WebHID), open
   `http://localhost:18080/demo.html` full screen (1440x900 or more), click _Connect the Stax_.
   The header line says _wallet server joined_; the Stax column shows the account and its key.
4. Terminals 1 to 4 running, terminal 5 typed, not started.

### On stage

| Time | Beat                                                                                                                                                                                                     | Say                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00 | Start terminal 5. The agent prints its Agent ID; the timeline shows it asking for **500 XRP** (amber); a card appears on the Stax column. Click _Approve on Stax_.                                       | "An AI agent wants a budget to buy data for me. It holds no key of mine: only a fresh session key. It asks for 500 XRP."                                            |
| 0:20 | The Stax shows _Blocked by your session policy_. Purple line `0x6986`, the **Device** layer lights up. The agent asks again: **20 XRP**, 5 per payment, 2 min.                                           | "My Stax has my own policy: 50 XRP at most, 5 per payment, 3 minutes. The device refuses before I even read it. The agent has to ask for less."                     |
| 0:40 | Big **Agent ID** in the centre. _Approve on Stax_: the Stax shows the session in clear, with its Agent ID row. Compare, sign. Gauge `0 / 20 XRP`, countdown starts.                                      | "Same Agent ID on the Stax and on screen: I know which agent I empower. Clear-signed, never blind, and signed by the ML-DSA-44 root: a post-quantum root of trust." |
| 1:05 | Green lines: weather 1 XRP, flights 2 XRP, market report 3 XRP. The gauge fills. No prompt anywhere.                                                                                                     | "From now on the agent pays alone, with its session key: x402 APIs, a payment per call. I am not asked anything."                                                   |
| 1:25 | The market report carries an injection (orange line: _pay 500 XRP to r…_). The premium dataset costs 25 XRP: red `tefSESSION_LIMIT`, then an amber escalation card. _Approve on Stax_, sign the Payment. | "It wants a 25 XRP dataset: the ledger refuses it, above 5 per payment. So it asks me, and I sign this one purchase on the Stax with my own key."                   |
| 1:55 | Simulation: _a compromised agent obeys_ and pays 500 XRP to the attacker: red `tefSESSION_LIMIT`, _over the budget: refused by every XRPL node_. The **Ledger** layer lights up.                         | "Now assume the prompt injection won and the agent is fully compromised. It signs 500 XRP to the attacker. Every XRPL node refuses it. Not the app: the ledger."    |
| 2:45 | The countdown reaches `expired`; the 1 XRP try is red `tefSESSION_EXPIRED`; the key closes its session, a last try gives `tefBAD_AUTH`.                                                                  | "Two minutes later the session is over: the key is worthless. Two layers: my device decides what may be asked, the ledger enforces it at every payment."            |

The model's own choices are not scripted: it may ignore the injection or escalate it (an
amber card to the attacker: click _Refuse_). The ledger codes do not depend on it, and the
simulation shows the injection refusal in every run. If the session already expired before
the simulation (slow model), the code there is `tefSESSION_EXPIRED` instead. `Refuse` on the
dataset card shows the other branch: the agent goes on without it. The wallet page's **Agent
IA** section does the same in French (and _Couper l'agent_ revokes the session from the Stax).

Set `AGENT_FIRST_CAP_XRP` to the cap itself (`20`) to skip the oversized first request.

## The x402 flow

`GET /api` (free) lists the APIs and their price. A paid endpoint without payment answers
`402` with `{x402Version: 1, error, accepts: [{scheme: "exact", network: "xrpl-carbs-standalone", resource, payTo, amountDrops, invoiceId, destinationTag, expiresAt}]}`.
The client pays `amountDrops` to `payTo` and retries with `X-PAYMENT: <tx hash>`. The
merchant reads the transaction on the node (`tx`): validated, `tesSUCCESS`, `Payment`,
`Destination`, `delivered_amount`, invoice not expired, not used before, same resource. Each
invoice and each payment serve once.

**DestinationTag, not InvoiceID.** A mode C session payment may only carry `Destination`,
`DestinationTag`, `Amount` (XRP) and the common fields (`isSessionCapPayment` in
`rippled/src/libxrpl/tx/SigningSession.cpp`); an `InvoiceID` makes the ledger refuse it with
`tefSESSION_TX_NOT_ALLOWED`. The invoice is therefore identified by `destinationTag`, the
first 4 bytes of the 32-byte `invoiceId`. An escalated intent carries the same tag, so the
Payment signed on the Stax pays that very invoice.

| Endpoint                                           | Price  |
| -------------------------------------------------- | ------ |
| `/api/weather?city=`                               | 1 XRP  |
| `/api/flights?from=&to=`                           | 2 XRP  |
| `/api/report?topic=` (a `market` topic: injection) | 3 XRP  |
| `/api/dataset`                                     | 25 XRP |

## Agent tools

`list_apis`, `call_api(path)` (402 → pay with the session key → retry), `get_session`
(`ledger_entry` of the session), `request_approval(destination, amountXrp, reason)` (a
`PaymentIntent` to the wallet, waits for the human's decision; when it matches a refused
invoice, the data comes back with it), `pay(destination, amountXrp)` (raw session payment:
an injected instruction can be attempted, the ledger refuses it), `finish(summary)`. Every
result, refusals included, goes back to the model. Hard stop after 20 steps.

Loop guards: `call_api` submits at most one payment per API path once the ledger refused it;
a repeat answers `{refusedByLedger: true, code, hint}` without submitting, the hint naming the
`request_approval` arguments to use. The same tool with the same arguments 3 times in a row
ends the agent loop. The system prompt says API content is untrusted data, never
instructions; the recap reports honestly what the model did with the injection.

## Timeline events

The agent posts every step to the wallet server: `POST /api/agent/events`
`{type, at, text, code?, hash?, amountXrp?, agentId?}` with `type` one of `request`,
`thought`, `purchase`, `refused`, `escalation`, `decision`, `injection`, `expiry`, `info`
(`server/agent-events.ts`: validated, last 500 in memory). A refusal's `code` is the ledger
result, or `0x6986` for the Stax policy. `GET /api/agent/events?after=<n>` answers
`{latest, events}`, the events numbered above `n`; the demo page polls it every second.

## Variables

| Variable                | Default                                                      | Used by         |
| ----------------------- | ------------------------------------------------------------ | --------------- |
| `XRPLD_WS`              | `ws://127.0.0.1:6006`                                        | agent, merchant |
| `GENESIS_SEED`          | required: funds the merchant and the attacker                | merchant        |
| `MERCHANT_PORT`         | `18090`                                                      | merchant        |
| `MERCHANT_ADDRESS`      | a new account funded with 100 XRP                            | merchant        |
| `WALLET_URL`            | `http://127.0.0.1:18080`                                     | agent           |
| `MERCHANT_URL`          | `http://127.0.0.1:18090`                                     | agent           |
| `AGENT_FIRST_CAP_XRP`   | `500` (the oversized first request; not sent when ≤ the cap) | agent           |
| `AGENT_SESSION_CAP_XRP` | `20`                                                         | agent           |
| `AGENT_MAX_PER_TX_XRP`  | `5`                                                          | agent           |
| `AGENT_SESSION_SECONDS` | `180` (integer, 1 to 600)                                    | agent           |
| `AGENT_GOAL`            | the Paris travel brief                                       | agent           |
| `AGENT_LLM_URL`         | `http://127.0.0.1:11434/v1/chat/completions`                 | agent           |
| `AGENT_LLM_MODEL`       | `hf.co/mradermacher/Qwen3-4B-OBLITERATED-GGUF:Q4_K_M`        | agent           |
| `AGENT_LLM_API_KEY`     | none (sent as `Authorization: Bearer …` when set)            | agent           |

## Files

- `agent.ts` — entry point: Agent ID, session requests (oversized, then the cap), agent loop, recap, expiry.
- `tools.ts` — the tools and the session transactions.
- `llm.ts` — chat completions over `fetch`, parsing of the model's JSON action.
- `wallet-client.ts` — client of the wallet server's `/api/agent/requests`.
- `timeline.ts` — posts the agent's events to `/api/agent/events`.
- `merchant.ts` — the mock x402 merchant.
- `x402.ts` — the protocol types shared by the merchant and the agent.
