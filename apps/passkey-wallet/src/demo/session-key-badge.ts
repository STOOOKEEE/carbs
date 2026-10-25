// The session key's algorithm next to the Agent ID, shown once the current agent announced it.

import { type SessionKeyAlgorithm, SESSION_KEY_LABELS } from "./session-key.ts";
import { ui } from "./ui.ts";

/** undefined: no agent yet (or the page was cleared), badge hidden. */
export function showSessionKey(algorithm: SessionKeyAlgorithm | undefined): void {
  ui.sessionKey.hidden = algorithm === undefined;
  ui.sessionKey.textContent =
    algorithm === undefined ? "" : `session key ${SESSION_KEY_LABELS[algorithm]}`;
  ui.sessionKey.classList.toggle("post-quantum", algorithm === "ml-dsa-44");
}
