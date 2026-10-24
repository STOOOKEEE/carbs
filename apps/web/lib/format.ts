import { DROPS_PER_XRP } from "./constants";

/** `3500000` -> `3.5 XRP`; sub-XRP amounts stay in drops. */
export function formatXrp(drops: number): string {
  if (Math.abs(drops) < DROPS_PER_XRP / 100 && drops !== 0) return `${drops} drops`;
  const xrp = drops / DROPS_PER_XRP;
  return `${Number.isInteger(xrp) ? xrp.toFixed(0) : xrp.toFixed(6).replace(/0+$/, "")} XRP`;
}

export function xrpToDrops(xrp: number): number {
  return Math.round(xrp * DROPS_PER_XRP);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  const text = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return `${text} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** `mm:ss` for a countdown. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
  const ss = String(clamped % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function shortAddress(address: string): string {
  return address.length <= 14 ? address : `${address.slice(0, 7)}…${address.slice(-5)}`;
}

export function shortHex(hex: string, keep = 10): string {
  return hex.length <= keep * 2 + 1 ? hex : `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}
