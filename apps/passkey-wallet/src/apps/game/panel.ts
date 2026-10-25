// The centre column and the arena's counters: the session as the ledger holds it (spent / cap,
// tx count / max, max per payment, time left), one grid cell per session-signed transaction
// (pending, then validated), and the shots' tally.

import { secondsUntil } from "../../agent-approvals.ts";
import type { GameSessionState } from "./session-entry.ts";
import { ui } from "./ui.ts";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** A gauge turns amber past this share of its limit. */
const GAUGE_WARNING_SHARE = 0.8;
const NO_VALUE = "–";
/** Rounding of XRP amounts on screen (drops would be 6 digits). */
const XRP_DIGITS = 4;

export type CellState = "pending" | "hit" | "miss" | "failed" | "expired";
export type SessionTone = "open" | "over";

export interface Tally {
  fired: number;
  pending: number;
  validated: number;
  hits: number;
  wonXrp: number;
}

export const tally: Tally = { fired: 0, pending: 0, validated: 0, hits: 0, wonXrp: 0 };

let expiration: number | undefined;
let cells: HTMLElement[] = [];
let nextCell = 0;

export function formatXrp(xrp: number): string {
  return String(Number(xrp.toFixed(XRP_DIGITS)));
}

export function renderTally(): void {
  ui.stats.fired.textContent = String(tally.fired);
  ui.stats.pending.textContent = String(tally.pending);
  ui.stats.validated.textContent = String(tally.validated);
  ui.stats.hits.textContent = String(tally.hits);
  ui.stats.won.textContent = `${formatXrp(tally.wonXrp)} XRP`;
}

/** An empty grid of `size` cells, and a fresh tally, for a new session. */
export function resetGrid(size: number): void {
  ui.txGrid.replaceChildren();
  cells = Array.from({ length: size }, () => {
    const cell = document.createElement("span");
    cell.className = "tx-cell";
    ui.txGrid.append(cell);
    return cell;
  });
  nextCell = 0;
  Object.assign(tally, { fired: 0, pending: 0, validated: 0, hits: 0, wonXrp: 0 });
  renderTally();
}

/** The next free cell, now pending; its setter, or undefined once the grid is full. */
export function takeCell(): ((state: CellState) => void) | undefined {
  const cell = cells[nextCell];
  if (cell === undefined) return undefined;
  nextCell += 1;
  const setState = (state: CellState): void => {
    cell.className = `tx-cell cell-${state}`;
  };
  setState("pending");
  return setState;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** Called every second: the countdown from the last Expiration read. */
export function tickCountdown(): void {
  const left = expiration === undefined ? undefined : secondsUntil(expiration);
  ui.countdown.textContent =
    left === undefined ? NO_VALUE : left > 0 ? formatCountdown(left) : "expired";
  ui.countdown.classList.toggle("expired", left !== undefined && left <= 0);
}

function showGauge(fill: HTMLElement, value: number, limit: number | undefined): void {
  const share = limit === undefined || limit === 0 ? 0 : Math.min(1, value / limit);
  fill.style.setProperty("--fill", `${share * PERCENT}%`);
  fill.classList.toggle("warning", share >= GAUGE_WARNING_SHARE);
}

export function showSessionState(text: string, tone: SessionTone): void {
  ui.sessionState.textContent = text;
  ui.sessionState.className = `session-state session-${tone}`;
}

/** The entry as read on the ledger; undefined: no session (never opened, closed or deleted). */
export function renderSession(state: GameSessionState | undefined): void {
  expiration = state?.expiration;
  ui.spent.textContent = formatXrp(state?.spentXrp ?? 0);
  ui.cap.textContent = state?.capXrp === undefined ? NO_VALUE : formatXrp(state.capXrp);
  ui.count.textContent = String(state?.txCount ?? 0);
  ui.maxCount.textContent = state?.maxTxCount === undefined ? NO_VALUE : String(state.maxTxCount);
  ui.maxPerTx.textContent =
    state?.maxPerTxXrp === undefined ? NO_VALUE : `${formatXrp(state.maxPerTxXrp)} XRP`;
  showGauge(ui.spentFill, state?.spentXrp ?? 0, state?.capXrp);
  showGauge(ui.countFill, state?.txCount ?? 0, state?.maxTxCount);
  tickCountdown();
}
