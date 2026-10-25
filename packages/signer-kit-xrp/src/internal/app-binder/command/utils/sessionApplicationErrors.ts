import {
  type CommandErrorArgs,
  type CommandErrors,
  DeviceExchangeError,
} from "@ledgerhq/device-management-kit";

import { XRP_APP_ERRORS, type XrpErrorCodes } from "./xrpApplicationErrors";

/**
 * Status words of an XRP app that supports signing sessions and the ML-DSA-44
 * root key, on top of {@link XrpErrorCodes}. They are kept out of the shared
 * map: the official app never answers them.
 *
 * Both are answered before any review:
 * - `6815` is `0x6800 | SESSION_BLIND_SIGN_REFUSED`: a `SigningSessionSet` or
 *   `SigningSessionDelete` (or a `Batch` holding one) that the app cannot show
 *   in full. Session transactions are never blind-signed, whatever the
 *   blind-signing setting says.
 * - `6986`: a session that the user's session policy (edited on the device
 *   only) refuses. The policy is checked first, so such a session answers
 *   `6986`, never `6815`.
 */
export type XrpSessionErrorCodes = XrpErrorCodes | "6815" | "6986";

export const XRP_SESSION_APP_ERRORS: CommandErrors<XrpSessionErrorCodes> = {
  ...XRP_APP_ERRORS,
  "6815": {
    message:
      "Session transaction refused: the app cannot show it in full, and session transactions are never blind-signed",
  },
  "6986": {
    message: "Session refused by the session policy set on the device",
  },
};

export class XrpSessionCommandError extends DeviceExchangeError<XrpSessionErrorCodes> {
  constructor(args: CommandErrorArgs<XrpSessionErrorCodes>) {
    super({ tag: "XrpAppCommandError", ...args });
  }
}

export const XrpSessionCommandErrorFactory = (
  args: CommandErrorArgs<XrpSessionErrorCodes>,
) => new XrpSessionCommandError(args);
