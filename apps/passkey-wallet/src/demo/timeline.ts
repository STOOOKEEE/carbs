// The left column and the footer: the agent's events, newest on top, read from the wallet
// server; each refusal lights the layer that made it (device policy or ledger).

import {
  AGENT_EVENTS_PATH,
  type TimelinePage,
  type TimelineRecord,
  isTimelinePage,
} from "../../server/agent-events.ts";
import { type Layer, TONE_ICONS, explainCode, refusingLayer, toneOf } from "./explain.ts";
import { ui } from "./ui.ts";

/** What fits in the column at 1440x900 without scrolling. */
const MAX_VISIBLE_EVENTS = 6;
const FLASH_MS = 2_500;
const HASH_PREFIX_LENGTH = 8;
/** Classic r-addresses in an event text, shown as their first 6 and last 4 characters. */
const ADDRESS_PATTERN = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
const ADDRESS_HEAD_LENGTH = 6;
const ADDRESS_TAIL_LENGTH = 4;

let after = 0;
let lastAgentId: string | undefined;
let placeholder = true;
const refusals: Record<Layer, number> = { device: 0, ledger: 0 };

async function fetchPage(since: number): Promise<TimelinePage> {
  const url = `${AGENT_EVENTS_PATH}?after=${since}`;
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`wallet server: HTTP ${answer.status} on ${url}`);
  const body: unknown = await answer.json();
  if (!isTimelinePage(body)) throw new Error("wallet server: unexpected agent events answer");
  return body;
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function detailOf(event: TimelineRecord): string | undefined {
  const parts: string[] = [];
  if (event.code !== undefined) {
    const explanation = explainCode(event.code);
    parts.push(explanation === undefined ? event.code : `${event.code}: ${explanation}`);
  }
  if (event.hash !== undefined) parts.push(`tx ${event.hash.slice(0, HASH_PREFIX_LENGTH)}…`);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function eventItem(event: TimelineRecord): HTMLLIElement {
  const tone = toneOf(event);
  const item = document.createElement("li");
  item.className = `event event-${tone} event-type-${event.type}`;
  const body = span("event-body", "");
  const text = event.text.replace(
    ADDRESS_PATTERN,
    (address) => `${address.slice(0, ADDRESS_HEAD_LENGTH)}…${address.slice(-ADDRESS_TAIL_LENGTH)}`,
  );
  const textNode = span("event-text", text);
  textNode.title = event.text;
  body.append(textNode);
  const detail = detailOf(event);
  if (detail !== undefined) body.append(span("event-detail", detail));
  item.append(span("event-icon", TONE_ICONS[tone]), body);
  if (event.amountXrp !== undefined) item.append(span("event-amount", `${event.amountXrp} XRP`));
  const time = document.createElement("time");
  time.className = "event-time";
  time.dateTime = new Date(event.at).toISOString();
  time.textContent = new Date(event.at).toLocaleTimeString("en-GB");
  item.append(time);
  return item;
}

function lightLayer(layer: Layer): void {
  refusals[layer] += 1;
  const { box, count } = ui.layers[layer];
  count.textContent = `${refusals[layer]} refused`;
  box.classList.add("lit", "flash");
  setTimeout(() => box.classList.remove("flash"), FLASH_MS);
}

function show(event: TimelineRecord): void {
  if (event.agentId !== undefined && event.agentId !== lastAgentId) {
    // A new agent run (fresh session key): the stage starts clean.
    clearRun();
    lastAgentId = event.agentId;
  }
  if (placeholder) {
    ui.timeline.innerHTML = "";
    placeholder = false;
  }
  ui.timeline.prepend(eventItem(event));
  // At most MAX_VISIBLE_EVENTS, and never a card cut by the bottom edge.
  while (
    ui.timeline.children.length > MAX_VISIBLE_EVENTS ||
    (ui.timeline.children.length > 1 && ui.timeline.scrollHeight > ui.timeline.clientHeight)
  )
    ui.timeline.lastElementChild?.remove();
  const layer = refusingLayer(event);
  if (layer !== undefined) lightLayer(layer);
}

/**
 * Clears the timeline, the layer counters and the Stax message; the budget follows, as it
 * only shows the current agent's session (timelineAgentId).
 */
export function clearRun(): void {
  lastAgentId = undefined;
  const waiting = document.createElement("li");
  waiting.className = "event event-quiet event-type-thought";
  const body = span("event-body", "");
  body.append(span("event-text", "Waiting for the agent."));
  waiting.append(span("event-icon", TONE_ICONS.quiet), body);
  ui.timeline.replaceChildren(waiting);
  placeholder = true;
  ui.staxMessage.hidden = true;
  for (const layer of ["device", "ledger"] as const) {
    refusals[layer] = 0;
    ui.layers[layer].count.textContent = "0 refused";
    ui.layers[layer].box.classList.remove("lit", "flash");
  }
}

/** Starts again from the first event (the wallet server restarted). */
function reset(): void {
  after = 0;
  clearRun();
}

/** Reads and shows the events posted since the last call. */
export async function pollTimeline(): Promise<void> {
  const page = await fetchPage(after);
  if (page.latest < after) {
    reset();
    return;
  }
  for (const event of page.events) show(event);
  after = page.latest;
}

/** The Agent ID of the current run: the newest event that carried one, none after a clear. */
export function timelineAgentId(): string | undefined {
  return lastAgentId;
}
