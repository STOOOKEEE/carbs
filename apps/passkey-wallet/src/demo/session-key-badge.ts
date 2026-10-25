// The session key's algorithm next to the Agent ID, and the header's "session key ML-DSA-44"
// claim, shown only when the current agent announced an ML-DSA-44 key.

import { type SessionKeyAlgorithm, SESSION_KEY_LABELS } from "./session-key.ts";
import { ui } from "./ui.ts";

/** undefined: no agent yet (or the page was cleared), both hidden. */
export function showSessionKey(algorithm: SessionKeyAlgorithm | undefined): void {
  ui.sessionKey.hidden = algorithm === undefined;
  ui.sessionKey.textContent =
    algorithm === undefined ? "" : `session key ${SESSION_KEY_LABELS[algorithm]}`;
  ui.sessionKey.classList.toggle("post-quantum", algorithm === "ml-dsa-44");
  ui.sessionKeyClaim.hidden = algorithm !== "ml-dsa-44";
}
