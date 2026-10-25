/**
 * The Agent ID the device shows after `Session key` (`docs/device-contract.md` section 6): the
 * first 4 bytes of the session key's AccountID, uppercase hex, as `XXXX-XXXX`. The agent shows the
 * same identifier, so the user can match the device screen to the agent.
 */

import { bytesToHex } from "@carbs/sessions";
import { decodeAccountID } from "ripple-address-codec";

/** Bytes of the AccountID the Agent ID shows (`ledger-app/src/xrp/signing_session.h`). */
const kAgentIdBytes = 4;
/** Hex characters before the `-`. */
const kAgentIdGroup = 4;

/** `rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy` → `A1E8-094F`. Throws on an invalid classic address. */
export function agentIdOf(address: string): string {
  // `bytesToHex` of `@carbs/sessions` answers uppercase hex.
  const hex = bytesToHex(decodeAccountID(address).subarray(0, kAgentIdBytes));
  return `${hex.slice(0, kAgentIdGroup)}-${hex.slice(kAgentIdGroup)}`;
}
