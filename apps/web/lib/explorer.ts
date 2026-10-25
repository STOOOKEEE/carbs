/**
 * Links to the public explorer of the network a value lives on: the page of an account (its
 * transactions) or of a transaction. Only a well-formed classic address or transaction hash on a
 * network with a public explorer gets one (AlphaNet, mainnet); the local node has none, and the
 * callers pass no network for a SIMULATED value, so those stay plain text. Links are navigation:
 * the explorers are not in `connect-src`.
 */

import { isClassicAddress } from "@carbs/sessions";
import { explorerAccountUrl, explorerTxUrl, type AppNetwork } from "./networks";

/** An account (or key) address, or a transaction hash. */
export type ExplorerKind = "account" | "tx";

const TX_HASH = /^[0-9A-F]{64}$/i;

/** What `value` is, when it is a real address or transaction hash; null otherwise. */
function kindOf(value: string): ExplorerKind | null {
  if (TX_HASH.test(value)) return "tx";
  return isClassicAddress(value) ? "account" : null;
}

/** The explorer page of `value` on `network`, or null: no network, no explorer, or not a `kind`. */
export function explorerLink(
  network: AppNetwork | null,
  kind: ExplorerKind,
  value: string,
): string | null {
  if (network === null || kindOf(value) !== kind) return null;
  return kind === "tx" ? explorerTxUrl(network, value) : explorerAccountUrl(network, value);
}

export interface ExplorerSegment {
  text: string;
  /** What the text is when it names an address or a transaction hash; null for plain text. */
  kind: ExplorerKind | null;
}

/** An r-address or 64 hex characters, as a whole word: what a sentence may name. */
const CANDIDATE = /\b(?:r[1-9A-HJ-NP-Za-km-z]{24,34}|[0-9A-Fa-f]{64})\b/g;

/** A sentence cut into plain text and the real addresses and transaction hashes it names. */
export function explorerSegments(text: string): ExplorerSegment[] {
  const segments: ExplorerSegment[] = [];
  let done = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    const value = match[0];
    const kind = kindOf(value);
    if (kind === null) continue;
    const start = match.index ?? 0;
    if (start > done) segments.push({ text: text.slice(done, start), kind: null });
    segments.push({ text: value, kind });
    done = start + value.length;
  }
  if (done < text.length) segments.push({ text: text.slice(done), kind: null });
  return segments;
}
