// What the streaming page knows at any moment: the owner, the session and its ledger entry,
// the provider's verdict, and the player. main.ts changes it, view.ts draws it.

import type { AccessAnswer } from "./contract.ts";
import type { Owner } from "./owner.ts";
import type { SessionEntry, StreamSession } from "./session-key.ts";

export interface StreamState {
  connected: boolean;
  /** Why the node or the provider cannot be reached; undefined when all is well. */
  problem: string | undefined;
  owner: Owner | undefined;
  provider: string | undefined;
  session: StreamSession | undefined;
  /** The session is closed (its entry is gone). */
  sessionOver: boolean;
  /** Why the stream stopped for good (ledger refusal, close); undefined while it may play. */
  endReason: string | undefined;
  /** Play pressed: the meter pays every PAY_INTERVAL_MS. */
  wantsToPlay: boolean;
  /** An owner action or an abuse attempt is running: their buttons stay off. */
  busy: boolean;
  /** Payments the session key got applied to the open ledger. */
  sentPayments: number;
  entry: SessionEntry | undefined;
  access: AccessAnswer | undefined;
  watchedSeconds: number;
}

export const state: StreamState = {
  connected: false,
  problem: "connecting…",
  owner: undefined,
  provider: undefined,
  session: undefined,
  sessionOver: false,
  endReason: undefined,
  wantsToPlay: false,
  busy: false,
  sentPayments: 0,
  entry: undefined,
  access: undefined,
  watchedSeconds: 0,
};

/** A session is open and this page holds its key. */
export function isActive(current: StreamState): boolean {
  return current.session !== undefined && !current.sessionOver;
}
