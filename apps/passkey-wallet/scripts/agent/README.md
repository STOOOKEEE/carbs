# AI agent on a signing session

An LLM agent that pays invoices for its owner with **no human prompt and no access to the
owner's master key**. It holds only the seed of a session key; the carbs ledger (amendment
`SigningSessions`, mode C) enforces the budget, the cap per payment and the expiry.

## What it shows

1. **Owner side** (plain code): funds an owner and 3 merchants from genesis, then opens a
   mode C session for a fresh key, signed by the owner's master key:
   `SessionCap` 40 XRP, `SessionMaxPerTx` 10 XRP, 300 s.
2. **Agent side**: receives only the session key seed and a goal. At each step the LLM
   picks one tool and says why:
   - `get_invoices` — 5 invoices of 4, 7, 12, 9 and 15 XRP (12 and 15 exceed the per-payment cap);
   - `get_session` — `ledger_entry` of the session: spent, cap, max per payment, seconds left;
   - `pay(invoiceId)` — a Payment from the owner account, signed by the session key only;
   - `finish(summary)`.

   Every result, refusals included (`tefSESSION_LIMIT`), goes back to the model so it adapts.
   Hard stop after 15 steps (unparseable answers count).

3. **Result**: `SessionSpent` vs cap, each invoice paid or refused by the ledger, then the
   session key closes its own session (`SigningSessionDelete`).

Expected outcome with the defaults: 4, 7 and 9 XRP are paid; 12 and 15 XRP are refused by the
ledger with `tefSESSION_LIMIT`, whatever the model tries.

## Run

Needs a carbs node with `SigningSessions` enabled and an OpenAI-compatible LLM endpoint
(local Ollama by default: `ollama pull hf.co/mradermacher/Qwen3-4B-OBLITERATED-GGUF:Q4_K_M`).
Node ≥ 22.18. From `apps/passkey-wallet`:

```sh
GENESIS_SEED=… pnpm agent        # or: node scripts/agent/agent.ts
```

| Variable                | Default                                                   |
| ----------------------- | --------------------------------------------------------- |
| `GENESIS_SEED`          | required: seed of the funded genesis account              |
| `XRPLD_WS`              | `ws://127.0.0.1:16006`                                    |
| `AGENT_LLM_URL`         | `http://127.0.0.1:11434/v1/chat/completions`              |
| `AGENT_LLM_MODEL`       | `hf.co/mradermacher/Qwen3-4B-OBLITERATED-GGUF:Q4_K_M`     |
| `AGENT_LLM_API_KEY`     | none (sent as `Authorization: Bearer …` when set)         |
| `AGENT_GOAL`            | pay the invoices cheapest first without going over budget |
| `AGENT_SESSION_CAP_XRP` | `40`                                                      |
| `AGENT_MAX_PER_TX_XRP`  | `10`                                                      |

An unreachable LLM or node stops the script with an error; there is no fallback.

## Files

- `agent.ts` — entry point: owner setup, agent loop, final report and close.
- `llm.ts` — chat completions over `fetch`, parsing of the model's JSON action.
- `tools.ts` — the tools and the session transactions.
