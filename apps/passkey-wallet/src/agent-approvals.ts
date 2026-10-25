// What both pages do with the AI agent's requests, without any DOM: read them from the wallet
// server, approve one by signing it on the Stax (a session budget or an escalated payment),
// refuse one, and read the agent's session on the ledger. The wallet page (agent-panel.ts) and
// the stage demo (demo/) only differ in how they show it.

import { DeviceError, describeLedgerError } from "@carbs/ledger";

import {
  AGENT_REQUESTS_PATH,
  type AgentDecision,
  type AgentRequest,
  type AgentRequestRecord,
  DEVICE_POLICY_NOTE,
  MAX_TEXT_LENGTH,
  type PaymentIntent,
  isAgentRequestRecord,
} from "../server/agent-requests.ts";
import type { Connection } from "./account.ts";
import { agentIdOf } from "./agent-id.ts";
import { textMemos } from "./hex.ts";
import { type SubmittedTx, type TxJson, read } from "./ledger.ts";
import { RpcError } from "./rpc.ts";
import { openSessionTx, paymentTx } from "./session.ts";

const DROPS_PER_XRP = 1_000_000;
/** Seconds between the Unix epoch and the XRPL epoch (2000-01-01). */
const RIPPLE_EPOCH_OFFSET_S = 946_684_800;
const MS_PER_SECOND = 1_000;
/** MemoType of the escalated Payment: the agent's own words, for the human to read. */
const INTENT_MEMO_TYPE = "agent-intent";
/**
 * Longest memo text. The XRP app shows a Memo Data of printable ASCII (0x20-0x7E) as text,
 * anything else as hex (ledger-app/src/xrp/general.c blob_formatter); a field holds 1023
 * characters on the Stax (MAX_FIELD_LEN), so 80 keeps it to a few readable lines.
 */
const INTENT_MEMO_MAX_LENGTH = 80;
const ELLIPSIS = "...";
/** Anything outside printable ASCII would turn the whole memo into hex on the device. */
const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/g;

/** The Stax refused to open the session: it goes beyond the session policy set on the device. */
export class DevicePolicyRefusal extends Error {
  override readonly name = "DevicePolicyRefusal";
  constructor() {
    super("Blocked by your session policy on the Stax (0x6986)");
  }
}

/** Who signs an approval: the Stax account, on the device. */
export interface StaxSigner {
  address: string;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

/** The agent session the human approved last: the owner account and the agent's key. */
export interface AgentSession {
  owner: string;
  sessionKey: string;
}

/** The agent's SigningSession entry, in XRP; Expiration in seconds since the XRPL epoch. */
export interface AgentSessionState {
  spentXrp: number;
  capXrp: number | undefined;
  maxPerTxXrp: number | undefined;
  expiration: number | undefined;
}

export async function fetchAgentRecords(): Promise<AgentRequestRecord[]> {
  const answer = await fetch(AGENT_REQUESTS_PATH);
  if (!answer.ok) throw new Error(`wallet server: HTTP ${answer.status} on ${AGENT_REQUESTS_PATH}`);
  const body: unknown = await answer.json();
  if (!Array.isArray(body) || !body.every(isAgentRequestRecord))
    throw new Error("wallet server: unexpected agent requests answer");
  return body;
}

async function postDecision(id: string, decision: AgentDecision): Promise<void> {
  const answer = await fetch(`${AGENT_REQUESTS_PATH}/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (!answer.ok) {
    const body: unknown = await answer.json();
    const reason = read(body, ["error"]);
    throw new Error(
      `wallet server refused the decision: ${typeof reason === "string" ? reason : `HTTP ${answer.status}`}`,
    );
  }
}

/** One line for the user and the agent from whatever an approval threw. */
export function agentErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : describeLedgerError(error);
  return (message.trim() === "" ? "unknown error" : message).slice(0, MAX_TEXT_LENGTH);
}

/**
 * What the Stax shows as Memo Data on an escalated payment: `Agent XXXX-XXXX: <reason>`, in
 * printable ASCII, at most INTENT_MEMO_MAX_LENGTH characters. The agent's words, not verified.
 */
export function intentMemoText(request: PaymentIntent): string {
  const text = `Agent ${agentIdOf(request.sessionKey)}: ${request.reason}`
    // "é" → "e" + combining accent; the accent is dropped, other non-ASCII becomes a space.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(NON_PRINTABLE_ASCII, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= INTENT_MEMO_MAX_LENGTH
    ? text
    : `${text.slice(0, INTENT_MEMO_MAX_LENGTH - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/** Only the Payment the human signs on the Stax carries the memo: session payments cannot. */
function approvalTx(owner: string, request: AgentRequest): TxJson {
  if (request.kind === "session")
    return openSessionTx(owner, request.sessionKey, {
      mode: "cap",
      capXrp: request.capXrp,
      maxPerTxXrp: request.maxPerTxXrp,
      durationSeconds: request.durationSeconds,
    });
  return {
    ...paymentTx(owner, request.destination, request.amountXrp),
    ...(request.destinationTag === undefined ? {} : { DestinationTag: request.destinationTag }),
    Memos: textMemos(INTENT_MEMO_TYPE, intentMemoText(request)),
  };
}

/**
 * Signs the approval on the Stax, then reports approved or failed to the agent and returns
 * that decision. A refusal by the device's session policy is reported with DEVICE_POLICY_NOTE
 * (the agent then asks for less) and thrown as a DevicePolicyRefusal.
 */
export async function approveAgentRequest(
  record: AgentRequestRecord,
  signer: StaxSigner,
): Promise<AgentDecision> {
  let submitted: SubmittedTx;
  try {
    submitted = await signer.signAndSubmit(approvalTx(signer.address, record.request));
  } catch (error) {
    // Every device command goes through exchangeOk: a refusal is a typed DeviceError.
    const policyRefused = error instanceof DeviceError && error.kind === "sessionPolicyRefused";
    const refusal = policyRefused ? new DevicePolicyRefusal() : error;
    const note = policyRefused ? DEVICE_POLICY_NOTE : agentErrorText(error);
    try {
      await postDecision(record.id, { status: "failed", owner: signer.address, note });
    } catch (postError) {
      throw new Error(
        `${agentErrorText(refusal)}; the agent was not told: ${agentErrorText(postError)}`,
      );
    }
    throw refusal;
  }
  const decision: AgentDecision = {
    status: submitted.result === "tesSUCCESS" ? "approved" : "failed",
    owner: signer.address,
    txHash: submitted.hash,
    result: submitted.result,
  };
  await postDecision(record.id, decision);
  return decision;
}

export async function rejectAgentRequest(record: AgentRequestRecord): Promise<AgentDecision> {
  const decision: AgentDecision = { status: "rejected", note: "refused by the owner" };
  await postDecision(record.id, decision);
  return decision;
}

/** The newest approved session of the records (newest first). */
export function lastApprovedSession(
  records: readonly AgentRequestRecord[],
): AgentSession | undefined {
  const record = records.find(
    (candidate) =>
      candidate.request.kind === "session" &&
      candidate.status === "approved" &&
      candidate.owner !== undefined,
  );
  if (record?.owner === undefined) return undefined;
  return { owner: record.owner, sessionKey: record.request.sessionKey };
}

function dropsToXrp(drops: unknown): number | undefined {
  return typeof drops === "string" && /^\d+$/.test(drops)
    ? Number(drops) / DROPS_PER_XRP
    : undefined;
}

/** The session's ledger entry; undefined once it is gone (revoked or closed). */
export async function readAgentSession(
  connection: Connection,
  session: AgentSession,
): Promise<AgentSessionState | undefined> {
  let entry: unknown;
  try {
    entry = await connection.node.request("ledger_entry", {
      signing_session: { account: session.owner, session_key: session.sessionKey },
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const node = read(entry, ["node"]);
  if (node === undefined) return undefined;
  const expiration = read(node, ["Expiration"]);
  return {
    spentXrp: dropsToXrp(read(node, ["SessionSpent"])) ?? 0,
    capXrp: dropsToXrp(read(node, ["SessionCap"])),
    maxPerTxXrp: dropsToXrp(read(node, ["SessionMaxPerTx"])),
    expiration: typeof expiration === "number" ? expiration : undefined,
  };
}

/** Seconds from now to an XRPL-epoch time (negative once it passed). */
export function secondsUntil(rippleTime: number, nowMs: number = Date.now()): number {
  return rippleTime - (Math.floor(nowMs / MS_PER_SECOND) - RIPPLE_EPOCH_OFFSET_S);
}
