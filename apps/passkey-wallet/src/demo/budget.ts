// The centre column: the agent's ID (to compare with the Stax review) and its budget as the
// ledger stores it (ledger_entry of the SigningSession): spent / cap, max per payment, and a
// countdown to its Expiration.

import type { AgentRequestRecord } from "../../server/agent-requests.ts";
import type { Connection } from "../account.ts";
import {
  type AgentSessionState,
  lastApprovedSession,
  readAgentSession,
  secondsUntil,
} from "../agent-approvals.ts";
import { agentIdOf } from "../agent-id.ts";
import { timelineAgentId } from "./timeline.ts";
import { ui } from "./ui.ts";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** The gauge turns amber past this share of the cap. */
const GAUGE_WARNING_SHARE = 0.8;
const NO_VALUE = "–";

/** Expiration of the session shown, in seconds since the XRPL epoch. */
let expiration: number | undefined;

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = String(seconds % SECONDS_PER_MINUTE).padStart(2, "0");
  return `${minutes}:${rest}`;
}

/** Redraws the countdown from the last Expiration read (called every second). */
export function tickCountdown(): void {
  if (expiration === undefined) {
    ui.countdown.textContent = NO_VALUE;
    ui.countdown.classList.remove("expired");
    return;
  }
  const left = secondsUntil(expiration);
  ui.countdown.textContent = left > 0 ? formatCountdown(left) : "expired";
  ui.countdown.classList.toggle("expired", left <= 0);
}

function showGauge(state: AgentSessionState | undefined): void {
  const share =
    state?.capXrp === undefined || state.capXrp === 0
      ? 0
      : Math.min(1, state.spentXrp / state.capXrp);
  ui.gaugeFill.style.setProperty("--fill", `${share * PERCENT}%`);
  ui.gaugeFill.classList.toggle("warning", share >= GAUGE_WARNING_SHARE);
  ui.spent.textContent = state === undefined ? "0" : String(state.spentXrp);
  ui.cap.textContent = state?.capXrp === undefined ? NO_VALUE : String(state.capXrp);
  ui.maxPerTx.textContent =
    state?.maxPerTxXrp === undefined ? NO_VALUE : `${state.maxPerTxXrp} XRP`;
}

function showState(text: string, tone: "open" | "waiting" | "over" | "idle"): void {
  ui.sessionState.textContent = text;
  ui.sessionState.className = `session-state session-${tone}`;
}

/** Reads the current run's session on the ledger and redraws the centre column. */
export async function refreshBudget(
  connection: Connection | undefined,
  records: readonly AgentRequestRecord[],
): Promise<void> {
  // Only the current run (the timeline's Agent ID): a previous run's session is not shown.
  const agentId = timelineAgentId();
  const run =
    agentId === undefined
      ? []
      : records.filter((record) => agentIdOf(record.request.sessionKey) === agentId);
  ui.agentId.textContent = agentId ?? "––––-––––";
  const session = lastApprovedSession(run);
  if (session === undefined) {
    expiration = undefined;
    showGauge(undefined);
    const waiting = run.some(
      (record) => record.request.kind === "session" && record.status === "pending",
    );
    showState(
      waiting ? "The agent is waiting for your approval on the Stax." : "No session yet.",
      waiting ? "waiting" : "idle",
    );
    tickCountdown();
    return;
  }
  if (connection === undefined) {
    showState("Node not connected.", "idle");
    return;
  }
  const state = await readAgentSession(connection, session);
  expiration = state?.expiration;
  showGauge(state);
  tickCountdown();
  if (state === undefined) showState("Session closed: no entry left on the ledger.", "over");
  else if (expiration !== undefined && secondsUntil(expiration) <= 0)
    showState("Session expired: the ledger refuses the agent's key.", "over");
  else showState("Session open: the agent pays alone, within these limits.", "open");
}
