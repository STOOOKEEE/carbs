// The centre column: the session key's Agent ID and the session as the ledger holds it
// (SessionTxCount / SessionMaxTxCount, spent / cap, Expiration counted down).

import { secondsUntil } from "../../agent-approvals.ts";
import { agentIdOf } from "../../agent-id.ts";
import {
  TRADING_MAX_TX_COUNT,
  TRADING_PERMISSION_NAMES,
  TRADING_SESSION_SECONDS,
} from "./rules.ts";
import type { SessionEntry } from "./session-key.ts";
import { ui } from "./ui.ts";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** The gauge turns amber past this share of the transaction count. */
const GAUGE_WARNING_SHARE = 0.8;
const NO_VALUE = "–";
const NO_AGENT_ID = "––––-––––";
const SPENT_DECIMALS = 6;

export type SessionPhase = "none" | "open" | "closed";

/** Expiration of the session shown, in seconds since the XRPL epoch. */
let expiration: number | undefined;

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** The numbers of the honest note, from the rules the page opens with. */
export function showRuleLimits(): void {
  ui.session.honestLimits.textContent = `${TRADING_SESSION_SECONDS / SECONDS_PER_MINUTE} min, ${TRADING_MAX_TX_COUNT} transactions`;
}

/** Redraws the countdown from the last Expiration read (called every second). */
export function tickCountdown(): void {
  if (expiration === undefined) {
    ui.session.countdown.textContent = NO_VALUE;
    ui.session.countdown.classList.remove("expired");
    return;
  }
  const left = secondsUntil(expiration);
  ui.session.countdown.textContent = left > 0 ? formatCountdown(left) : "expired";
  ui.session.countdown.classList.toggle("expired", left <= 0);
}

function showState(text: string, tone: "open" | "over" | "idle"): void {
  ui.session.state.textContent = text;
  ui.session.state.className = `session-state session-${tone}`;
}

function showCount(entry: SessionEntry | undefined): void {
  const max = entry?.maxTxCount;
  const share =
    entry === undefined || max === undefined || max === 0 ? 0 : Math.min(1, entry.txCount / max);
  ui.session.txCount.textContent = String(entry?.txCount ?? 0);
  ui.session.maxTxCount.textContent = max === undefined ? NO_VALUE : String(max);
  ui.session.gaugeFill.style.setProperty("--fill", `${share * PERCENT}%`);
  ui.session.gaugeFill.classList.toggle("warning", share >= GAUGE_WARNING_SHARE);
}

/** Redraws the column from the session's entry (undefined: no entry on the ledger). */
export function renderSession(
  sessionKey: string | undefined,
  entry: SessionEntry | undefined,
  phase: SessionPhase,
): void {
  ui.session.agentId.textContent = sessionKey === undefined ? NO_AGENT_ID : agentIdOf(sessionKey);
  if (entry !== undefined) expiration = entry.expiration;
  else if (phase !== "open") expiration = undefined;
  showCount(entry);
  ui.session.spent.textContent =
    entry === undefined
      ? NO_VALUE
      : `${entry.spentXrp.toFixed(SPENT_DECIMALS)} XRP / ${entry.capXrp === undefined ? "no cap" : `${entry.capXrp} XRP`}`;
  ui.session.permissions.textContent = entry === undefined ? NO_VALUE : TRADING_PERMISSION_NAMES;
  tickCountdown();
  if (phase === "none") showState("No session yet.", "idle");
  else if (entry === undefined) showState("Session closed: no entry left on the ledger.", "over");
  else if (expiration !== undefined && secondsUntil(expiration) <= 0)
    showState("Session expired: the ledger refuses the bot's key.", "over");
  else showState("Session open: the bot quotes alone, offers only.", "open");
}
