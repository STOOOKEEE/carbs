// Draws the streaming page from its state: the player and its meter, the session as the
// ledger holds it, the provider's verdict, and which buttons are usable.

import { agentIdOf } from "../../agent-id.ts";
import { secondsUntil } from "../../agent-approvals.ts";
import { NODE_URL } from "../../config.ts";
import { DROPS_PER_XRP } from "./config.ts";
import { GRACE_LEDGERS } from "./contract.ts";
import { type StreamState, isActive } from "./state.ts";
import { ui } from "./ui.ts";

const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
/** The gauge turns amber past this share of the cap. */
const GAUGE_WARNING_SHARE = 0.8;
const ADDRESS_PREFIX_LENGTH = 8;
/** XRP shown with at most this many decimals (one drop). */
const XRP_DECIMALS = 6;
const NO_VALUE = "–";
const NO_AGENT_ID = "––––-––––";

type PlayerTone = "idle" | "buffering" | "playing" | "paused" | "cut" | "over";
type SessionTone = "open" | "waiting" | "over" | "idle";

function xrp(drops: number): string {
  return String(Number((drops / DROPS_PER_XRP).toFixed(XRP_DECIMALS)));
}

function shortAddress(address: string): string {
  return `${address.slice(0, ADDRESS_PREFIX_LENGTH)}…`;
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  return `${minutes}:${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}

function secondsLeft(s: StreamState): number | undefined {
  const expiration = s.entry?.expiration;
  return expiration === undefined ? undefined : secondsUntil(expiration);
}

function playerView(s: StreamState): { tone: PlayerTone; text: string } {
  if (s.session === undefined) return { tone: "idle", text: "Open a streaming session to watch." };
  if (s.endReason !== undefined) return { tone: "over", text: s.endReason };
  if (!s.wantsToPlay)
    return {
      tone: "paused",
      text: `Paused: no payment, no stream. The provider cuts it within ${GRACE_LEDGERS} ledgers.`,
    };
  if (s.access?.granted === true) return { tone: "playing", text: "" };
  if (s.access !== undefined && s.access.payments > 0)
    return {
      tone: "cut",
      text: `Held by the provider: no validated payment in the last ${GRACE_LEDGERS} ledgers.`,
    };
  return { tone: "buffering", text: "Paying… the stream starts once the ledger validates it." };
}

function renderPlayer(s: StreamState): void {
  const { tone, text } = playerView(s);
  ui.player.className = `player player-${tone}`;
  ui.playerOverlay.textContent = text;
  ui.playerOverlay.hidden = text === "";
  ui.watched.textContent = clock(s.watchedSeconds);
  ui.paid.textContent = xrp(s.access?.paidDrops ?? 0);
  ui.payments.textContent = String(s.access?.payments ?? 0);
}

function providerText(s: StreamState): { text: string; granted: boolean | undefined } {
  if (s.provider === undefined) return { text: "Provider: not reached yet.", granted: undefined };
  const who = `Provider ${shortAddress(s.provider)}`;
  if (s.access === undefined) return { text: `${who}: waiting for a session.`, granted: undefined };
  if (s.access.granted)
    return {
      text: `${who}: streaming · last payment in ledger ${s.access.lastPaidLedger ?? NO_VALUE}, validated ${s.access.validatedLedger}`,
      granted: true,
    };
  if (s.access.payments === 0)
    return { text: `${who}: holds the stream until a payment lands.`, granted: false };
  return {
    text: `${who}: stream cut, no payment in the last ${GRACE_LEDGERS} ledgers.`,
    granted: false,
  };
}

function renderProvider(s: StreamState): void {
  const { text, granted } = providerText(s);
  ui.provider.textContent = text;
  ui.provider.classList.toggle("provider-ok", granted === true);
  ui.provider.classList.toggle("provider-cut", granted === false);
}

function sessionView(s: StreamState): { tone: SessionTone; text: string } {
  if (s.session === undefined) return { tone: "idle", text: "No session yet." };
  if (s.sessionOver) return { tone: "over", text: "Session closed: no entry left on the ledger." };
  if (s.entry === undefined) return { tone: "waiting", text: "Reading the session on the ledger…" };
  const left = secondsLeft(s);
  if (left !== undefined && left <= 0)
    return { tone: "over", text: "Session expired: the ledger refuses the key." };
  return { tone: "open", text: "Session open: the key pays alone, within these limits." };
}

function renderSession(s: StreamState): void {
  const entry = s.entry;
  ui.agentId.textContent = s.session === undefined ? NO_AGENT_ID : agentIdOf(s.session.keyAddress);
  const share =
    entry?.capDrops === undefined || entry.capDrops === 0
      ? 0
      : Math.min(1, entry.spentDrops / entry.capDrops);
  ui.gaugeFill.style.setProperty("--fill", `${share * PERCENT}%`);
  ui.gaugeFill.classList.toggle("warning", share >= GAUGE_WARNING_SHARE);
  ui.spent.textContent = xrp(entry?.spentDrops ?? 0);
  ui.cap.textContent = entry?.capDrops === undefined ? NO_VALUE : xrp(entry.capDrops);
  ui.count.textContent =
    entry === undefined ? NO_VALUE : `${entry.txCount} / ${entry.maxTxCount ?? NO_VALUE}`;
  ui.maxPerTx.textContent =
    entry?.maxPerTxDrops === undefined ? NO_VALUE : `${xrp(entry.maxPerTxDrops)} XRP`;
  const left = secondsLeft(s);
  ui.countdown.textContent =
    left === undefined || s.sessionOver ? NO_VALUE : left > 0 ? clock(left) : "expired";
  ui.countdown.classList.toggle("expired", left !== undefined && left <= 0 && !s.sessionOver);
  const { tone, text } = sessionView(s);
  ui.sessionState.textContent = text;
  ui.sessionState.className = `session-state session-${tone}`;
}

function renderControls(s: StreamState): void {
  const active = isActive(s);
  const ended = s.endReason !== undefined;
  ui.connectStax.disabled = !s.connected || active || s.busy;
  ui.usePasskey.disabled = !s.connected || active || s.busy;
  ui.open.disabled =
    !s.connected || s.owner === undefined || s.provider === undefined || active || s.busy;
  ui.play.disabled = !active || ended || s.wantsToPlay;
  ui.pause.disabled = !active || !s.wantsToPlay;
  ui.abuseBig.disabled = !active || s.busy;
  ui.abuseBinge.disabled = !active || ended || s.busy;
  ui.abuseDevice.disabled = !s.connected || s.owner?.kind !== "stax" || s.busy;
  ui.close.disabled = !active || s.busy;
}

function renderHeader(s: StreamState): void {
  ui.connection.textContent =
    s.problem === undefined ? `node ${NODE_URL} · provider joined` : s.problem;
  ui.connection.classList.toggle("problem", s.problem !== undefined);
  ui.ownerLine.textContent = s.owner === undefined ? "No owner yet" : `owner: ${s.owner.label}`;
  ui.ownerLine.classList.toggle("root-muted", s.owner?.kind !== "stax");
  ui.ownerStatus.textContent =
    s.owner === undefined
      ? "Choose who opens the session."
      : `${s.owner.label} · ${shortAddress(s.owner.address)}`;
}

export function render(s: StreamState): void {
  renderHeader(s);
  renderPlayer(s);
  renderProvider(s);
  renderSession(s);
  renderControls(s);
}
