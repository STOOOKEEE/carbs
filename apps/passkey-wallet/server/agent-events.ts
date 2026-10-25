// The agent's live timeline: every step it takes (request, thought, purchase, ledger or device
// refusal, escalation, decision, injection, expiry) is posted to the wallet server, which keeps
// the last ones in memory for the stage demo page. Pure module (no I/O), shared by the server,
// the page and the agent script. Runs under Node's type stripping.

import { AGENT_ID_PATTERN } from "../src/agent-id.ts";
import {
  MAX_TEXT_LENGTH,
  TX_HASH_PATTERN,
  ValidationError,
  field,
  isObject,
  text,
} from "./agent-requests.ts";

export const TIMELINE_EVENT_TYPES = [
  "request",
  "thought",
  "purchase",
  "refused",
  "escalation",
  "decision",
  "injection",
  "expiry",
  "info",
] as const;

export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface TimelineEvent {
  type: TimelineEventType;
  /** Unix time in milliseconds, set by the agent. */
  at: number;
  text: string;
  /** A ledger result (tesSUCCESS, tefSESSION_LIMIT…) or DEVICE_POLICY_CODE. */
  code?: string;
  hash?: string;
  amountXrp?: number;
  /** The agent's "XXXX-XXXX" identifier (src/agent-id.ts). */
  agentId?: string;
}

/** An event as the server stores it: numbered from 1, in arrival order. */
export interface TimelineRecord extends TimelineEvent {
  seq: number;
}

/** GET answer: the events after the asked sequence number, and the last number given. */
export interface TimelinePage {
  latest: number;
  events: TimelineRecord[];
}

/** Where the agent posts its events and the demo page reads them. */
export const AGENT_EVENTS_PATH = "/api/agent/events";
/** The code of a refusal by the Stax session policy (SW_SESSION_POLICY_REFUSED). */
export const DEVICE_POLICY_CODE = "0x6986";
/** Oldest events are dropped beyond this. */
const MAX_EVENTS = 500;
const CODE_PATTERN = /^[A-Za-z0-9_]{1,40}$/;

function isTimelineEventType(value: unknown): value is TimelineEventType {
  return TIMELINE_EVENT_TYPES.some((type) => type === value);
}

function optionalMatch(body: object, name: string, pattern: RegExp): string | undefined {
  const value = field(body, name);
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value))
    throw new ValidationError(`${name} is malformed`);
  return value;
}

/** Validates an event posted by the agent; throws a ValidationError otherwise. */
export function parseTimelineEvent(body: unknown): TimelineEvent {
  if (!isObject(body)) throw new ValidationError("the body must be a JSON object");
  const type = field(body, "type");
  if (!isTimelineEventType(type))
    throw new ValidationError(`type must be one of ${TIMELINE_EVENT_TYPES.join(", ")}`);
  const at = field(body, "at");
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0)
    throw new ValidationError("at must be a Unix time in milliseconds");
  const amountXrp = field(body, "amountXrp");
  if (
    amountXrp !== undefined &&
    (typeof amountXrp !== "number" || !Number.isFinite(amountXrp) || amountXrp < 0)
  )
    throw new ValidationError("amountXrp must be a non-negative finite number");
  const code = optionalMatch(body, "code", CODE_PATTERN);
  const hash = optionalMatch(body, "hash", TX_HASH_PATTERN);
  const agentId = optionalMatch(body, "agentId", AGENT_ID_PATTERN);
  return {
    type,
    at,
    text: text(body, "text"),
    ...(code === undefined ? {} : { code }),
    ...(hash === undefined ? {} : { hash }),
    ...(amountXrp === undefined ? {} : { amountXrp }),
    ...(agentId === undefined ? {} : { agentId }),
  };
}

function isTimelineRecord(value: unknown): value is TimelineRecord {
  if (!isObject(value)) return false;
  const seq = field(value, "seq");
  if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0) return false;
  try {
    parseTimelineEvent(value);
    return true;
  } catch (error) {
    if (error instanceof ValidationError) return false;
    throw error;
  }
}

/** Type guard for the GET answer. */
export function isTimelinePage(value: unknown): value is TimelinePage {
  if (!isObject(value)) return false;
  const latest = field(value, "latest");
  const events = field(value, "events");
  return (
    typeof latest === "number" &&
    Number.isSafeInteger(latest) &&
    Array.isArray(events) &&
    events.every(isTimelineRecord)
  );
}

/** Cuts a text to what the server accepts. */
export function clipText(value: string): string {
  return value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH - 1)}…` : value;
}

/** In-memory ring of the last MAX_EVENTS events, oldest first. */
export class TimelineStore {
  private events: TimelineRecord[] = [];
  private latest = 0;

  append(event: TimelineEvent): TimelineRecord {
    this.latest += 1;
    const record: TimelineRecord = { ...event, seq: this.latest };
    this.events.push(record);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    return record;
  }

  after(seq: number): TimelinePage {
    return { latest: this.latest, events: this.events.filter((event) => event.seq > seq) };
  }
}
