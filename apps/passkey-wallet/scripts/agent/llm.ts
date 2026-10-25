// OpenAI-compatible chat completions over fetch (local Ollama by default), and the
// parsing of the model's answer into one action.

import { read } from "../../src/ledger.ts";
import { type ToolName, isToolName } from "./tools.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  url: string;
  model: string;
  apiKey: string | undefined;
}

export interface Action {
  tool: ToolName;
  /** The tool's arguments object; each tool reads the members it needs. */
  args: unknown;
  why: string;
}

export type ParsedAction = { ok: true; action: Action } | { ok: false; error: string };

/** Low temperature: the agent should follow the rules, not improvise. */
const TEMPERATURE = 0.2;
/** One action is a short JSON object; the cap stops a model that rambles. */
const MAX_ANSWER_TOKENS = 400;
/** Without it, Qwen3 can reason for minutes before answering (seen: no answer after 300 s). */
const REASONING_EFFORT = "none";
const REQUEST_TIMEOUT_MS = 120_000;
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;
/** A reasoning block cut off before its closing tag. */
const UNCLOSED_THINK = /<think>[\s\S]*$/;
const CODE_FENCE = /```(?:json)?/g;

export async function chat(config: LlmConfig, messages: ChatMessage[]): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey !== undefined) headers["Authorization"] = `Bearer ${config.apiKey}`;
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_ANSWER_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach the LLM at ${config.url} (${reason})`);
  }
  if (!response.ok)
    throw new Error(
      `the LLM at ${config.url} answered ${response.status}: ${await response.text()}`,
    );
  const content = read(await response.json(), ["choices", "0", "message", "content"]);
  if (typeof content !== "string") throw new Error("the LLM answer has no message content");
  return content;
}

/** The first balanced {...} of the text, braces inside JSON strings ignored. */
function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

export function parseAction(raw: string): ParsedAction {
  const cleaned = raw.replace(THINK_BLOCK, "").replace(UNCLOSED_THINK, "").replace(CODE_FENCE, "");
  const json = firstJsonObject(cleaned);
  if (json === undefined) return { ok: false, error: "no JSON object found in your answer" };
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `invalid JSON (${reason})` };
  }
  // A balanced {...} always parses to an object: only its members need checking.
  const tool = read(value, ["tool"]);
  const args = read(value, ["args"]) ?? {};
  const why = read(value, ["why"]);
  if (!isToolName(tool)) return { ok: false, error: `unknown tool ${JSON.stringify(tool)}` };
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return { ok: false, error: '"args" must be a JSON object' };
  return { ok: true, action: { tool, args, why: typeof why === "string" ? why : "" } };
}
