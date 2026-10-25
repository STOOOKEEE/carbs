// The agent's short identifier, as the Stax shows it on a SigningSessionSet review ("Agent ID"
// row, ledger-app/src/xrp/general.c format_agent_id): the first 4 bytes of the session key's
// AccountID in upper-case hex, grouped "XXXX-XXXX". The human compares it with the agent's own.

import { decodeAccountID } from "ripple-address-codec";

const AGENT_ID_BYTES = 4;
const GROUP_LENGTH = 4;

/** "XXXX-XXXX", upper-case hexadecimal. */
export const AGENT_ID_PATTERN = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

export function agentIdOf(sessionKeyAddress: string): string {
  const hex = Array.from(decodeAccountID(sessionKeyAddress).subarray(0, AGENT_ID_BYTES), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return `${hex.slice(0, GROUP_LENGTH)}-${hex.slice(GROUP_LENGTH)}`;
}
