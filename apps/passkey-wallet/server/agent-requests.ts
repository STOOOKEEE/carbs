// What an AI agent asks its human: a session budget to open, or a payment above that budget.
// The wallet server keeps them in memory; the page shows them and the human decides on the
// Stax. Pure module (no I/O): the server, the page and the agent script share its types and
// validation. Runs under Node's type stripping (no enums, no parameter properties).

import { isValidClassicAddress } from "ripple-address-codec";

export type AgentRequestKind = "session" | "payment";

export interface SessionRequest {
  kind: "session";
  /** r-address of the agent's session key. */
  sessionKey: string;
  capXrp: number;
  maxPerTxXrp: number;
  durationSeconds: number;
  purpose: string;
}

export interface PaymentIntent {
  kind: "payment";
  destination: string;
  /** Identifies the invoice at the merchant (uint32), copied into the Payment's DestinationTag. */
  destinationTag?: number;
  amountXrp: number;
  reason: string;
  sessionKey: string;
}

export type AgentRequest = SessionRequest | PaymentIntent;

export type AgentRequestStatus = "pending" | "approved" | "rejected" | "failed";
export type AgentDecisionStatus = Exclude<AgentRequestStatus, "pending">;

export interface AgentDecision {
  status: AgentDecisionStatus;
  owner?: string;
  txHash?: string;
  result?: string;
  note?: string;
}

export interface AgentRequestRecord {
  id: string;
  createdAt: number;
  request: AgentRequest;
  status: AgentRequestStatus;
  owner?: string;
  txHash?: string;
  result?: string;
  note?: string;
}

/** Bounds of SessionDuration on the ledger, in seconds. */
export const MIN_SESSION_SECONDS = 1;
export const MAX_SESSION_SECONDS = 600;
/** Where the wallet server lists and receives the agent's requests. */
export const AGENT_REQUESTS_PATH = "/api/agent/requests";
export const MAX_TEXT_LENGTH = 200;
/** Oldest records are dropped beyond this. */
const MAX_RECORDS = 50;
const TX_HASH_PATTERN = /^[0-9A-Fa-f]{64}$/;
const MAX_DESTINATION_TAG = 0xffff_ffff;
const DECISION_STATUSES: readonly AgentDecisionStatus[] = ["approved", "rejected", "failed"];
const REQUEST_STATUSES: readonly AgentRequestStatus[] = ["pending", ...DECISION_STATUSES];

/** An invalid request body: the server answers 400 with its message. */
export class ValidationError extends Error {}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function field(body: object, name: string): unknown {
  return Reflect.get(body, name);
}

function address(body: object, name: string): string {
  const value = field(body, name);
  if (typeof value !== "string" || !isValidClassicAddress(value))
    throw new ValidationError(`${name} must be a classic XRPL address`);
  return value;
}

function positiveAmount(body: object, name: string): number {
  const value = field(body, name);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new ValidationError(`${name} must be a positive finite number`);
  return value;
}

function text(body: object, name: string): string {
  const value = field(body, name);
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TEXT_LENGTH)
    throw new ValidationError(
      `${name} must be a non-empty string of at most ${MAX_TEXT_LENGTH} characters`,
    );
  return value;
}

function optionalText(body: object, name: string): string | undefined {
  return field(body, name) === undefined ? undefined : text(body, name);
}

function parseSessionRequest(body: object): SessionRequest {
  const capXrp = positiveAmount(body, "capXrp");
  const maxPerTxXrp = positiveAmount(body, "maxPerTxXrp");
  if (maxPerTxXrp > capXrp) throw new ValidationError("maxPerTxXrp must not exceed capXrp");
  const durationSeconds = field(body, "durationSeconds");
  if (
    typeof durationSeconds !== "number" ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds < MIN_SESSION_SECONDS ||
    durationSeconds > MAX_SESSION_SECONDS
  ) {
    throw new ValidationError(
      `durationSeconds must be an integer from ${MIN_SESSION_SECONDS} to ${MAX_SESSION_SECONDS}`,
    );
  }
  return {
    kind: "session",
    sessionKey: address(body, "sessionKey"),
    capXrp,
    maxPerTxXrp,
    durationSeconds,
    purpose: text(body, "purpose"),
  };
}

function parsePaymentIntent(body: object): PaymentIntent {
  const destinationTag = field(body, "destinationTag");
  if (
    destinationTag !== undefined &&
    (typeof destinationTag !== "number" ||
      !Number.isInteger(destinationTag) ||
      destinationTag < 0 ||
      destinationTag > MAX_DESTINATION_TAG)
  ) {
    throw new ValidationError(`destinationTag must be an integer from 0 to ${MAX_DESTINATION_TAG}`);
  }
  return {
    kind: "payment",
    destination: address(body, "destination"),
    ...(destinationTag === undefined ? {} : { destinationTag }),
    amountXrp: positiveAmount(body, "amountXrp"),
    reason: text(body, "reason"),
    sessionKey: address(body, "sessionKey"),
  };
}

/** Validates a SessionRequest or a PaymentIntent; throws a ValidationError otherwise. */
export function parseAgentRequest(body: unknown): AgentRequest {
  if (!isObject(body)) throw new ValidationError("the body must be a JSON object");
  const kind = field(body, "kind");
  if (kind === "session") return parseSessionRequest(body);
  if (kind === "payment") return parsePaymentIntent(body);
  throw new ValidationError('kind must be "session" or "payment"');
}

function isDecisionStatus(value: unknown): value is AgentDecisionStatus {
  return DECISION_STATUSES.some((status) => status === value);
}

/** Validates the human's decision; throws a ValidationError otherwise. */
export function parseDecision(body: unknown): AgentDecision {
  if (!isObject(body)) throw new ValidationError("the body must be a JSON object");
  const status = field(body, "status");
  if (!isDecisionStatus(status))
    throw new ValidationError('status must be "approved", "rejected" or "failed"');
  const owner = field(body, "owner") === undefined ? undefined : address(body, "owner");
  const txHash = optionalText(body, "txHash");
  if (txHash !== undefined && !TX_HASH_PATTERN.test(txHash))
    throw new ValidationError("txHash must be 64 hexadecimal characters");
  const result = optionalText(body, "result");
  const note = optionalText(body, "note");
  return {
    status,
    ...(owner === undefined ? {} : { owner }),
    ...(txHash === undefined ? {} : { txHash }),
    ...(result === undefined ? {} : { result }),
    ...(note === undefined ? {} : { note }),
  };
}

function isRequestStatus(value: unknown): value is AgentRequestStatus {
  return REQUEST_STATUSES.some((status) => status === value);
}

/** Type guard for a record read back from the server (GET answers). */
export function isAgentRequestRecord(value: unknown): value is AgentRequestRecord {
  if (!isObject(value)) return false;
  if (typeof field(value, "id") !== "string" || typeof field(value, "createdAt") !== "number")
    return false;
  if (!isRequestStatus(field(value, "status"))) return false;
  const optionalStrings = ["owner", "txHash", "result", "note"].every((name) => {
    const member = field(value, name);
    return member === undefined || typeof member === "string";
  });
  if (!optionalStrings) return false;
  try {
    parseAgentRequest(field(value, "request"));
    return true;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

export type DecideOutcome =
  { ok: true; record: AgentRequestRecord } | { ok: false; reason: "not-found" | "not-pending" };

/** In-memory list of requests, newest first, capped at MAX_RECORDS. */
export class AgentRequestStore {
  private records: AgentRequestRecord[] = [];

  create(request: AgentRequest, now: number = Date.now()): AgentRequestRecord {
    const record: AgentRequestRecord = {
      id: crypto.randomUUID(),
      createdAt: now,
      request,
      status: "pending",
    };
    this.records = [record, ...this.records].slice(0, MAX_RECORDS);
    return record;
  }

  list(): AgentRequestRecord[] {
    return [...this.records];
  }

  get(id: string): AgentRequestRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  /** Only a pending request can be decided, once. */
  decide(id: string, decision: AgentDecision): DecideOutcome {
    const index = this.records.findIndex((record) => record.id === id);
    const current = this.records[index];
    if (current === undefined) return { ok: false, reason: "not-found" };
    if (current.status !== "pending") return { ok: false, reason: "not-pending" };
    const record: AgentRequestRecord = { ...current, ...decision };
    this.records[index] = record;
    return { ok: true, record };
  }
}
