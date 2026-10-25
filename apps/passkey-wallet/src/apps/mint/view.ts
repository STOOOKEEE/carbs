// What the page shows from the last ledger reads: the session card (Agent ID, count, time left,
// spent / cap), the owner's XRP (balance, fees, reserve) and the gallery of tickets.

import { secondsUntil } from "../../agent-approvals.ts";
import { agentIdOf } from "../../agent-id.ts";
import type { MintedTicket, OwnerState, ReserveSettings, SessionEntry } from "./ledger-reads.ts";
import type { MintSession } from "./mint-session.ts";
import { ui } from "./ui.ts";

const DROPS_PER_XRP = 1_000_000;
const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** The gauge turns amber past this share of the transaction count. */
const GAUGE_WARNING_SHARE = 0.8;
/** The gallery shows the newest tickets only. */
const GALLERY_MAX_ITEMS = 60;
const NFTOKEN_ID_HEAD = 8;
const NFTOKEN_ID_TAIL = 6;
const NO_VALUE = "–";
const NO_AGENT_ID = "––––-––––";

export interface PageState {
  session: MintSession | undefined;
  /** The session entry; undefined while none is open or once it is gone. */
  entry: SessionEntry | undefined;
  owner: OwnerState | undefined;
  /** The owner account just before it opened the session. */
  baseline: OwnerState | undefined;
  reserve: ReserveSettings | undefined;
  tickets: MintedTicket[];
  /** NFTokenIDs the owner held before the session opened: the others are the session's. */
  heldBeforeSession: Set<string> | undefined;
}

function formatXrp(drops: number): string {
  const xrp = (drops / DROPS_PER_XRP).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return `${xrp} XRP`;
}

function signedXrp(drops: number): string {
  return drops >= 0 ? `+${formatXrp(drops)}` : `−${formatXrp(-drops)}`;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

/** Seconds left in the session; undefined without an open entry. */
export function secondsLeft(state: PageState): number | undefined {
  return state.entry === undefined ? undefined : secondsUntil(state.entry.expiration);
}

/** Redraws the countdown (every second). */
export function tickCountdown(state: PageState): void {
  const left = secondsLeft(state);
  ui.countdown.textContent =
    left === undefined ? NO_VALUE : left > 0 ? formatCountdown(left) : "expired";
  ui.countdown.classList.toggle("expired", left !== undefined && left <= 0);
}

function showSessionState(state: PageState): void {
  const left = secondsLeft(state);
  const [text, tone]: [string, "idle" | "over" | "open"] =
    state.session === undefined
      ? ["No session yet.", "idle"]
      : state.entry === undefined
        ? ["Session closed: no entry left on the ledger.", "over"]
        : left !== undefined && left <= 0
          ? ["Session expired: the ledger refuses the desk's key.", "over"]
          : ["Session open: the desk's key mints alone, within these limits.", "open"];
  ui.sessionState.textContent = text;
  ui.sessionState.className = `session-state session-${tone}`;
}

function showSessionCard(state: PageState): void {
  const { session, entry } = state;
  ui.agentId.textContent = session === undefined ? NO_AGENT_ID : agentIdOf(session.keyAddress);
  ui.txCount.textContent = entry === undefined ? NO_VALUE : String(entry.txCount);
  ui.txMax.textContent = entry?.maxTxCount === undefined ? NO_VALUE : String(entry.maxTxCount);
  const share =
    entry?.maxTxCount === undefined || entry.maxTxCount === 0
      ? 0
      : Math.min(1, entry.txCount / entry.maxTxCount);
  ui.gaugeFill.style.setProperty("--fill", `${share * PERCENT}%`);
  ui.gaugeFill.classList.toggle("warning", share >= GAUGE_WARNING_SHARE);
  // Mode P has no SessionCap: the session cannot move XRP at all, it only pays its fees.
  ui.spent.textContent =
    session === undefined
      ? NO_VALUE
      : `${formatXrp(session.feesPaidDrops)} fees / no cap: no XRP can move`;
  showSessionState(state);
  tickCountdown(state);
}

function showReserveCard(state: PageState): void {
  const { owner, baseline, reserve, session } = state;
  ui.balance.textContent = owner === undefined ? NO_VALUE : formatXrp(owner.balanceDrops);
  ui.fees.textContent = session === undefined ? NO_VALUE : formatXrp(session.feesPaidDrops);
  if (owner === undefined || reserve === undefined) {
    ui.reserve.textContent = NO_VALUE;
    ui.reserveDelta.textContent = NO_VALUE;
    return;
  }
  const locked = reserve.baseDrops + owner.ownerCount * reserve.incrementDrops;
  ui.reserve.textContent = `${formatXrp(locked)} (${formatXrp(reserve.baseDrops)} + ${owner.ownerCount} objects × ${formatXrp(reserve.incrementDrops)})`;
  if (baseline === undefined) {
    ui.reserveDelta.textContent = NO_VALUE;
    return;
  }
  const objects = owner.ownerCount - baseline.ownerCount;
  const balance = owner.balanceDrops - baseline.balanceDrops;
  ui.reserveDelta.textContent = `balance ${signedXrp(balance)} (fees only) · ${objects >= 0 ? "+" : "−"}${Math.abs(objects)} objects, ${signedXrp(objects * reserve.incrementDrops)} locked in reserve`;
}

function shortId(nftokenId: string): string {
  return `${nftokenId.slice(0, NFTOKEN_ID_HEAD)}…${nftokenId.slice(-NFTOKEN_ID_TAIL)}`;
}

function galleryItem(minted: MintedTicket, fresh: boolean): HTMLLIElement {
  const item = document.createElement("li");
  item.className = fresh ? "ticket ticket-fresh" : "ticket";
  item.title = minted.nftokenId;
  const seat = document.createElement("span");
  seat.className = "ticket-seat";
  seat.textContent = minted.ticket.seat;
  const number = document.createElement("span");
  number.className = "ticket-number";
  number.textContent = `#${minted.ticket.number}`;
  const id = document.createElement("span");
  id.className = "ticket-id";
  id.textContent = shortId(minted.nftokenId);
  item.append(seat, number, id);
  return item;
}

function showGallery(state: PageState): void {
  ui.galleryCount.textContent = String(state.tickets.length);
  ui.gallery.replaceChildren(
    ...state.tickets
      .slice(0, GALLERY_MAX_ITEMS)
      .map((minted) =>
        galleryItem(minted, state.heldBeforeSession?.has(minted.nftokenId) === false),
      ),
  );
}

export function render(state: PageState): void {
  showSessionCard(state);
  showReserveCard(state);
  showGallery(state);
}
