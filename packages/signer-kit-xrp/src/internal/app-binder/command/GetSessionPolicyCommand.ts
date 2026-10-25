import {
  type Apdu,
  ApduBuilder,
  type ApduBuilderArgs,
  type ApduResponse,
  ByteArrayParser,
  type Command,
  type CommandResult,
  CommandResultFactory,
  InvalidResponseFormatError,
} from "@ledgerhq/device-management-kit";
import { CommandErrorHelper } from "@ledgerhq/signer-utils";
import { Maybe } from "purify-ts";

import {
  SESSION_PROFILE_NAMES,
  type SessionMode,
  type SessionPolicy,
  type SessionProfilePolicy,
} from "@api/model/SessionPolicy";

import { INS, P1_DEFAULT, P2_DEFAULT, XRP_CLA } from "./utils/apduHeaderUtils";
import {
  XRP_APP_ERRORS,
  XrpAppCommandErrorFactory,
  type XrpErrorCodes,
} from "./utils/xrpApplicationErrors";

/** `SESSION_POLICY_FORMAT_VERSION`: version 1 had no profiles. */
const SESSION_POLICY_VERSION = 2;

/** `SESSION_POLICY_FLAG_*`. */
const FLAG_ENABLED = 0x01;
const FLAG_ALLOW_ALL = 0x02;
const FLAG_ALLOW_PERMISSIONS = 0x04;
const FLAG_REQUIRE_WITNESS = 0x08;

/** `SESSION_PROFILE_FLAG_ENABLED`. */
const PROFILE_FLAG_ENABLED = 0x01;

/** `SESSION_MODE_*`, the bits of a profile's modes byte. */
const MODE_BITS: ReadonlyArray<[SessionMode, number]> = [
  ["cap", 0x01],
  ["all", 0x02],
  ["permissions", 0x04],
];

/**
 * `SESSION_PROFILE_MAX_PERMISSIONS`: the app stores at most this many
 * permissions per profile, so a longer list is not an answer it can give.
 */
const SESSION_PROFILE_MAX_PERMISSIONS = 2;

/** `SESSION_POLICY_NO_LIMIT`: a limit of the default policy that is not set. */
const NO_LIMIT = 0;

export type GetSessionPolicyCommandResponse = SessionPolicy;

class SessionPolicyFormatError extends Error {}

/**
 * Reads the session policy the user set on the device (`INS 0x08`, P1 and P2
 * `00`, no data). The host can only read it: it is edited in the app's
 * settings.
 *
 * The answer, format version 2, big-endian (`session_policy_serialize` in the
 * app's `src/policy/session_policy.c`), is a 23-byte header (version, flags,
 * max `SessionCap` and max `SessionMaxPerTx` in drops on 8 bytes, max
 * `SessionDuration` in seconds on 4 bytes, the number of profiles), then one
 * record per profile in id order: id, flags, modes, max `SessionCap`, max
 * `SessionMaxPerTx`, max `SessionDuration`, max `SessionMaxTxCount`, then the
 * number of permissions and each `PermissionValue` on 4 bytes. Another
 * version, an unknown or misplaced profile, a truncated record and trailing
 * bytes are refused rather than read as a policy the device does not have.
 */
export class GetSessionPolicyCommand
  implements Command<GetSessionPolicyCommandResponse, void, XrpErrorCodes>
{
  readonly name = "GetSessionPolicy";

  private readonly errorHelper = new CommandErrorHelper<
    GetSessionPolicyCommandResponse,
    XrpErrorCodes
  >(XRP_APP_ERRORS, XrpAppCommandErrorFactory);

  getApdu(): Apdu {
    const getSessionPolicyArgs: ApduBuilderArgs = {
      cla: XRP_CLA,
      ins: INS.GET_SESSION_POLICY,
      p1: P1_DEFAULT,
      p2: P2_DEFAULT,
    };

    return new ApduBuilder(getSessionPolicyArgs).build();
  }

  parseResponse(
    apduResponse: ApduResponse,
  ): CommandResult<GetSessionPolicyCommandResponse, XrpErrorCodes> {
    return Maybe.fromNullable(
      this.errorHelper.getError(apduResponse),
    ).orDefaultLazy(() => {
      try {
        return CommandResultFactory({
          data: parseSessionPolicy(new ByteArrayParser(apduResponse.data)),
        });
      } catch (error) {
        if (!(error instanceof SessionPolicyFormatError)) {
          throw error;
        }
        return CommandResultFactory({
          error: new InvalidResponseFormatError(error.message),
        });
      }
    });
  }
}

/** Reads a field or fails: a truncated answer is never read as a policy. */
const required = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) {
    throw new SessionPolicyFormatError(`Session policy truncated in ${what}`);
  }
  return value;
};

const limitOrNull = <T extends number | bigint>(value: T): T | null =>
  Number(value) === NO_LIMIT ? null : value;

function parseProfile(
  parser: ByteArrayParser,
  index: number,
): SessionProfilePolicy {
  const what = `profile ${index}`;
  const id = required(parser.extract8BitUInt(), what);
  const name = SESSION_PROFILE_NAMES[index];
  if (id !== index || name === undefined) {
    throw new SessionPolicyFormatError(
      `Session policy profile ${index} has id ${id}`,
    );
  }
  const flags = required(parser.extract8BitUInt(), what);
  const modeBits = required(parser.extract8BitUInt(), what);
  const maxCap = required(parser.extract64BitUInt(), what);
  const maxPerTx = required(parser.extract64BitUInt(), what);
  const maxDurationSeconds = required(parser.extract32BitUInt(), what);
  const maxTxCount = required(parser.extract32BitUInt(), what);
  const permissionsCount = required(parser.extract8BitUInt(), what);
  if (permissionsCount > SESSION_PROFILE_MAX_PERMISSIONS) {
    throw new SessionPolicyFormatError(
      `Session policy profile ${index} lists ${permissionsCount} permissions, at most ${SESSION_PROFILE_MAX_PERMISSIONS}`,
    );
  }
  const permissions = Array.from({ length: permissionsCount }, () =>
    required(parser.extract32BitUInt(), what),
  );
  const modes = MODE_BITS.filter(([, bit]) => (modeBits & bit) !== 0).map(
    ([mode]) => mode,
  );
  const hasCap = modes.includes("cap");

  return {
    id,
    name,
    enabled: (flags & PROFILE_FLAG_ENABLED) !== 0,
    modes,
    maxCapDrops: hasCap ? maxCap : null,
    maxPerTxDrops: hasCap ? maxPerTx : null,
    maxDurationSeconds,
    maxTxCount,
    permissions,
  };
}

function parseSessionPolicy(parser: ByteArrayParser): SessionPolicy {
  const version = required(parser.extract8BitUInt(), "its version");
  if (version !== SESSION_POLICY_VERSION) {
    throw new SessionPolicyFormatError(
      `Session policy format ${version} is not supported (expected ${SESSION_POLICY_VERSION})`,
    );
  }
  const flags = required(parser.extract8BitUInt(), "its header");
  const maxCap = required(parser.extract64BitUInt(), "its header");
  const maxPerTx = required(parser.extract64BitUInt(), "its header");
  const maxDuration = required(parser.extract32BitUInt(), "its header");
  const count = required(parser.extract8BitUInt(), "its header");
  if (count !== SESSION_PROFILE_NAMES.length) {
    throw new SessionPolicyFormatError(
      `Expected ${SESSION_PROFILE_NAMES.length} session profiles, the app answered ${count}`,
    );
  }
  const profiles = Array.from({ length: count }, (_, index) =>
    parseProfile(parser, index),
  );
  const trailing = parser.getUnparsedRemainingLength();
  if (trailing !== 0) {
    throw new SessionPolicyFormatError(
      `Session policy has ${trailing} bytes after its last profile`,
    );
  }

  return {
    version,
    enabled: (flags & FLAG_ENABLED) !== 0,
    allowAll: (flags & FLAG_ALLOW_ALL) !== 0,
    allowPermissions: (flags & FLAG_ALLOW_PERMISSIONS) !== 0,
    requireWitness: (flags & FLAG_REQUIRE_WITNESS) !== 0,
    maxCapDrops: limitOrNull(maxCap),
    maxPerTxDrops: limitOrNull(maxPerTx),
    maxDurationSeconds: limitOrNull(maxDuration),
    profiles,
  };
}
