// The agent's side of the stage timeline: every step is posted to the wallet server
// (/api/agent/events) with the agent's ID, for the demo page (demo.html).

import {
  AGENT_EVENTS_PATH,
  type TimelineEvent,
  type TimelineEventType,
  clipText,
} from "../../server/agent-events.ts";

const HTTP_CREATED = 201;

/** Who posts: the wallet server and the agent's "XXXX-XXXX" identifier. */
export interface Reporter {
  walletUrl: string;
  agentId: string;
}

/** The optional facts of an event. */
export interface EventFacts {
  code?: string;
  hash?: string;
  amountXrp?: number;
}

/** Posts one event; throws when the wallet server does not take it. */
export async function report(
  reporter: Reporter,
  type: TimelineEventType,
  text: string,
  facts: EventFacts = {},
): Promise<void> {
  const event: TimelineEvent = {
    type,
    at: Date.now(),
    text: clipText(text),
    agentId: reporter.agentId,
    ...facts,
  };
  const url = `${reporter.walletUrl}${AGENT_EVENTS_PATH}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot reach the wallet server at ${url} (${reason})`);
  }
  if (response.status !== HTTP_CREATED)
    throw new Error(
      `the wallet server refused an event: ${response.status} ${await response.text()}`,
    );
}
