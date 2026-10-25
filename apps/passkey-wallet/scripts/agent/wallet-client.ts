// Client of the wallet server's agent requests: the agent posts what it needs from the human
// (a session budget, a payment above it) and polls until the human decided on the Stax.
// The wallet server never signs for the owner: it only relays requests and decisions.

import { setTimeout as delay } from "node:timers/promises";

import {
  type AgentRequest,
  type AgentRequestRecord,
  isAgentRequestRecord,
} from "../../server/agent-requests.ts";

const REQUESTS_PATH = "/api/agent/requests";
const POLL_INTERVAL_MS = 1_000;
const HTTP_CREATED = 201;

async function call(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach the wallet server at ${url} (${reason})`);
  }
}

async function recordOf(response: Response, expectedStatus: number): Promise<AgentRequestRecord> {
  const body: unknown = await response.json();
  if (response.status !== expectedStatus)
    throw new Error(`the wallet server answered ${response.status}: ${JSON.stringify(body)}`);
  if (!isAgentRequestRecord(body)) throw new Error("the wallet server answered an invalid record");
  return body;
}

export async function createRequest(
  baseUrl: string,
  request: AgentRequest,
): Promise<AgentRequestRecord> {
  const response = await call(`${baseUrl}${REQUESTS_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  return recordOf(response, HTTP_CREATED);
}

export async function getRequest(baseUrl: string, id: string): Promise<AgentRequestRecord> {
  const response = await call(`${baseUrl}${REQUESTS_PATH}/${encodeURIComponent(id)}`);
  return recordOf(response, 200);
}

/** Polls the request until the human decided; throws once timeoutMs has passed. */
export async function waitForDecision(
  baseUrl: string,
  id: string,
  timeoutMs: number,
): Promise<AgentRequestRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await getRequest(baseUrl, id);
    if (record.status !== "pending") return record;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`no decision on request ${id} after ${timeoutMs / 1_000} s`);
}
