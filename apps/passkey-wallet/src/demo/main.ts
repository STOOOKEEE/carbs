// The stage demo (demo.html): the agent's timeline, its budget on the ledger, the Stax that
// approves it, and the two guardrail layers. One node connection, the wallet server polled.

import type { AgentRequestRecord } from "../../server/agent-requests.ts";
import type { Connection } from "../account.ts";
import { agentErrorText, fetchAgentRecords } from "../agent-approvals.ts";
import { NODE_URL } from "../config.ts";
import { loadDefinitions } from "../ledger.ts";
import { NodeClient } from "../rpc.ts";
import { refreshBudget, tickCountdown } from "./budget.ts";
import { refreshStaxPanel, setupStaxPanel } from "./stax-panel.ts";
import { clearRun, pollTimeline } from "./timeline.ts";
import { ui } from "./ui.ts";

/** The ledger_entry of the session and the requests: every 2 s. */
const REFRESH_INTERVAL_MS = 2_000;
/** The agent's events: every second, so the timeline follows the agent closely. */
const TIMELINE_INTERVAL_MS = 1_000;
const COUNTDOWN_INTERVAL_MS = 1_000;
/** Key that clears the page for a new stage run (without Cmd/Ctrl/Alt: Cmd+R still reloads). */
const RESET_KEY = "r";

let connection: Connection | undefined;
let nodeProblem: string | undefined = "connecting…";
let serverProblem: string | undefined;
let refreshing: Promise<void> | undefined;
let polling: Promise<void> | undefined;

function showConnection(): void {
  const node = nodeProblem === undefined ? `node ${NODE_URL}` : `node: ${nodeProblem}`;
  const server =
    serverProblem === undefined ? "wallet server joined" : `wallet server: ${serverProblem}`;
  ui.connection.textContent = `${node} · ${server}`;
  ui.connection.classList.toggle(
    "problem",
    nodeProblem !== undefined || serverProblem !== undefined,
  );
}

async function render(): Promise<void> {
  let records: AgentRequestRecord[];
  try {
    records = await fetchAgentRecords();
    serverProblem = undefined;
  } catch (error) {
    serverProblem = agentErrorText(error);
    showConnection();
    return;
  }
  try {
    await refreshBudget(connection, records);
    await refreshStaxPanel(connection, records);
    if (connection !== undefined) nodeProblem = undefined;
  } catch (error) {
    nodeProblem = agentErrorText(error);
  }
  showConnection();
}

/** Reads the requests and the ledger; a call during another one waits for it. */
function refresh(): Promise<void> {
  refreshing ??= render().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

function pollEvents(): void {
  polling ??= pollTimeline()
    .catch((error: unknown) => {
      serverProblem = agentErrorText(error);
      showConnection();
    })
    .finally(() => {
      polling = undefined;
    });
}

async function connect(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  connection = { node, defs: await loadDefinitions(node) };
  nodeProblem = undefined;
}

setupStaxPanel(() => connection, refresh);
setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
setInterval(pollEvents, TIMELINE_INTERVAL_MS);
setInterval(tickCountdown, COUNTDOWN_INTERVAL_MS);
pollEvents();
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== RESET_KEY || event.metaKey || event.ctrlKey || event.altKey)
    return;
  clearRun();
  void refresh();
});

connect()
  .catch((error: unknown) => {
    nodeProblem = `unreachable (${agentErrorText(error)})`;
  })
  .finally(() => void refresh());
