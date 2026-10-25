// An AI agent that lives on a signing session: the owner opens a mode C session (total cap,
// cap per payment, 300 s) for a fresh key, and the agent gets only that key's seed and a goal.
// It pays invoices with no human prompt; the ledger, not the agent, enforces the budget.
//   GENESIS_SEED=… node scripts/agent/agent.ts

import type { XrplDefinitions } from "ripple-binary-codec";
import { generateSeed } from "ripple-keypairs";

import {
  type TxJson,
  addressOfSeed,
  autofill,
  loadDefinitions,
  signWithSeed,
  submitAndWait,
} from "../../src/ledger.ts";
import { NodeClient } from "../../src/rpc.ts";
import { type ChatMessage, type LlmConfig, chat, parseAction } from "./llm.ts";
import {
  type AgentContext,
  TOOL_DESCRIPTIONS,
  closeSessionTx,
  describeInvoice,
  describeSession,
  makeInvoices,
  openSessionTx,
  paymentTx,
  readSession,
  runTool,
  submitAsSession,
  hashPrefix,
} from "./tools.ts";

const DEFAULT_NODE_WS = "ws://127.0.0.1:16006";
const DEFAULT_LLM_URL = "http://127.0.0.1:11434/v1/chat/completions";
const DEFAULT_LLM_MODEL = "hf.co/mradermacher/Qwen3-4B-OBLITERATED-GGUF:Q4_K_M";
const DEFAULT_GOAL =
  "You run errands for your owner: pay the merchants' invoices listed by get_invoices, cheapest first, without going over budget; stop when nothing more can be paid";
const DEFAULT_CAP_XRP = 40;
const DEFAULT_MAX_PER_TX_XRP = 10;
const SESSION_DURATION_S = 300;
const MAX_STEPS = 15;
const OWNER_FUNDING_XRP = 1_000;
const MERCHANT_FUNDING_XRP = 100;
const MERCHANT_COUNT = 3;
const WHY_MAX_LENGTH = 90;
/** Qwen3 soft switch that skips the reasoning block; other models read it as plain text. */
const NO_THINK_SWITCH = "/no_think";

function positiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function systemPrompt(owner: string): string {
  const tools = Object.entries(TOOL_DESCRIPTIONS)
    .map(([name, description]) => `- ${name}: ${description}`)
    .join("\n");
  return [
    `You are an autonomous agent acting for the XRPL account ${owner}.`,
    "You hold only a signing session key: the ledger itself limits what you may spend, how much per payment and for how long.",
    "A payment the ledger refuses comes back with its result code (tefSESSION_LIMIT: over the session limits; tefSESSION_EXPIRED: session over). Adapt to it, never retry the same refused payment.",
    `Tools:\n${tools}`,
    'Answer with exactly one JSON object and nothing else: {"tool": "<name>", "args": {...}, "why": "<one short sentence>"}',
    NO_THINK_SWITCH,
  ].join("\n\n");
}

/** Owner side: funds the owner and the merchants, then opens the session with the master key. */
async function setup(node: NodeClient, defs: XrplDefinitions) {
  const genesisSeed = requiredEnv("GENESIS_SEED");
  const capXrp = positiveNumberEnv("AGENT_SESSION_CAP_XRP", DEFAULT_CAP_XRP);
  const maxPerTxXrp = positiveNumberEnv("AGENT_MAX_PER_TX_XRP", DEFAULT_MAX_PER_TX_XRP);

  const submitAsOwnerSide = async (label: string, tx: TxJson, seed: string): Promise<void> => {
    const filled = await autofill(node, defs, tx);
    const { hash, result } = await submitAndWait(node, defs, signWithSeed(defs, filled, seed));
    console.log(`  ${label.padEnd(52)} ${result.padEnd(14)} ${hashPrefix(hash)}`);
    if (result !== "tesSUCCESS") throw new Error(`${label}: ${result}`);
  };
  const fundNewAccount = async (label: string, xrp: number) => {
    const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
    const address = addressOfSeed(seed);
    await submitAsOwnerSide(
      `fund ${label} ${address}`,
      paymentTx(addressOfSeed(genesisSeed), address, xrp),
      genesisSeed,
    );
    return { seed, address };
  };

  console.log("— Owner side: accounts and session");
  const owner = await fundNewAccount("owner", OWNER_FUNDING_XRP);
  const merchants: string[] = [];
  for (let index = 1; index <= MERCHANT_COUNT; index++)
    merchants.push((await fundNewAccount(`merchant ${index}`, MERCHANT_FUNDING_XRP)).address);
  const sessionSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const sessionKey = addressOfSeed(sessionSeed);
  await submitAsOwnerSide(
    `open session: ${capXrp} XRP, ${maxPerTxXrp} per payment, ${SESSION_DURATION_S} s`,
    openSessionTx(owner.address, sessionKey, SESSION_DURATION_S, capXrp, maxPerTxXrp),
    owner.seed,
  );
  // From here on, only the session key seed is handed over: the owner seed stays here.
  return { owner: owner.address, sessionKey, sessionSeed, merchants };
}

async function runAgent(context: AgentContext, goal: string, llm: LlmConfig): Promise<void> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(context.owner) },
    { role: "user", content: `Goal: ${goal}` },
  ];
  console.log(`\n— Agent (${llm.model}), goal: ${goal}`);
  for (let step = 1; step <= MAX_STEPS; step++) {
    const label = `#${String(step).padStart(2, "0")}`;
    const raw = await chat(llm, messages);
    messages.push({ role: "assistant", content: raw });
    const parsed = parseAction(raw);
    if (!parsed.ok) {
      console.log(`${label} (unparseable answer) → ${parsed.error}`);
      messages.push({
        role: "user",
        content: `Error: ${parsed.error}. Reply with exactly one JSON object {"tool": ..., "args": {...}, "why": ...}.`,
      });
      continue;
    }
    const { tool, args, why } = parsed.action;
    const outcome = await runTool(context, tool, args);
    const shortWhy = why.length > WHY_MAX_LENGTH ? `${why.slice(0, WHY_MAX_LENGTH)}…` : why;
    console.log(`${label} ${tool} ${JSON.stringify(args)} | ${shortWhy} | → ${outcome.line}`);
    if (outcome.done) return;
    messages.push({
      role: "user",
      content: `Result of ${tool}: ${JSON.stringify(outcome.forModel)}`,
    });
  }
  console.log(`hard stop after ${MAX_STEPS} steps`);
}

async function report(context: AgentContext): Promise<void> {
  console.log("\n— Result");
  console.log(`  session: ${describeSession(await readSession(context))}`);
  for (const invoice of context.invoices) console.log(`  ${describeInvoice(invoice)}`);
  const { hash, result } = await submitAsSession(
    context,
    closeSessionTx(context.owner, context.sessionKey),
  );
  console.log(`  the session key closes its own session: ${result} ${hashPrefix(hash)}`);
}

async function main(): Promise<void> {
  const llm: LlmConfig = {
    url: process.env["AGENT_LLM_URL"] ?? DEFAULT_LLM_URL,
    model: process.env["AGENT_LLM_MODEL"] ?? DEFAULT_LLM_MODEL,
    apiKey: process.env["AGENT_LLM_API_KEY"],
  };
  const goal = process.env["AGENT_GOAL"] ?? DEFAULT_GOAL;
  const node = await NodeClient.connect(process.env["XRPLD_WS"] ?? DEFAULT_NODE_WS);
  try {
    const defs = await loadDefinitions(node);
    const { owner, sessionKey, sessionSeed, merchants } = await setup(node, defs);
    const context: AgentContext = {
      node,
      defs,
      owner,
      sessionKey,
      sessionSeed,
      invoices: makeInvoices(merchants),
    };
    try {
      await runAgent(context, goal, llm);
    } finally {
      await report(context);
    }
  } finally {
    node.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`agent stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
