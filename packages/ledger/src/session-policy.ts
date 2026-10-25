/**
 * The device's session policy (`docs/device-contract.md` section 7): the user's own limits on the
 * signing sessions the device agrees to open, edited only from the device settings. The host reads
 * it with `INS 0x08` (`ledger-app/src/policy/session_policy.h`, `session_policy_serialize`).
 */

import { exchangeOk, kCla, kInsGetSessionPolicy, type ApduTransport } from "./apdu.js";

/** `SESSION_POLICY_FORMAT_VERSION`. */
export const kSessionPolicyVersion = 1;
/** `SESSION_POLICY_SERIALIZED_SIZE`: version, flags, max cap, max per payment, max duration. */
export const kSessionPolicySize = 22;

/** `SESSION_POLICY_FLAG_*`. */
const kFlagEnabled = 0x01;
const kFlagAllowAll = 0x02;
const kFlagAllowPermissions = 0x04;
const kFlagRequireWitness = 0x08;

const kOffsetVersion = 0;
const kOffsetFlags = 1;
const kOffsetMaxCap = 2;
const kOffsetMaxPerTx = 10;
const kOffsetMaxDuration = 18;

/** `SESSION_POLICY_NO_LIMIT`: a limit at this value is not checked. */
const kNoLimit = 0;
const kMaxUint64 = (1n << 64n) - 1n;
const kMaxUint32 = 0xffffffff;

export interface SessionPolicy {
  version: number;
  /** The policy is checked; when off, nothing else applies. */
  enabled: boolean;
  /** Mode A (`tfAllTransactions`) allowed. */
  allowAll: boolean;
  /** Mode P (`Permissions`) allowed. */
  allowPermissions: boolean;
  /** `SessionWitness` must be present. */
  requireWitness: boolean;
  /** Largest `SessionCap`, in drops; `null` = no limit. */
  maxCapDrops: bigint | null;
  /** Largest `SessionMaxPerTx`, in drops; `null` = no limit. */
  maxPerTxDrops: bigint | null;
  /** Largest `SessionDuration`, in seconds; `null` = no limit. */
  maxDurationSeconds: number | null;
}

/** Fresh install: all zero, policy off. */
export const kSessionPolicyOff: SessionPolicy = {
  version: kSessionPolicyVersion,
  enabled: false,
  allowAll: false,
  allowPermissions: false,
  requireWitness: false,
  maxCapDrops: null,
  maxPerTxDrops: null,
  maxDurationSeconds: null,
};

export class SessionPolicyError extends Error {
  override readonly name = "SessionPolicyError";
}

function limitOf<T extends bigint | number>(value: T, noLimit: T): T | null {
  return value === noLimit ? null : value;
}

/** The 22-byte `INS 0x08` answer → a policy. Throws `SessionPolicyError` on a wrong length or version. */
export function parseSessionPolicy(bytes: Uint8Array): SessionPolicy {
  if (bytes.length !== kSessionPolicySize) {
    throw new SessionPolicyError(
      `expected a ${kSessionPolicySize}-byte session policy, the device answered ${bytes.length} bytes`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(kOffsetVersion);
  if (version !== kSessionPolicyVersion) {
    throw new SessionPolicyError(
      `session policy format ${version} is not supported (expected ${kSessionPolicyVersion})`,
    );
  }
  const flags = view.getUint8(kOffsetFlags);
  return {
    version,
    enabled: (flags & kFlagEnabled) !== 0,
    allowAll: (flags & kFlagAllowAll) !== 0,
    allowPermissions: (flags & kFlagAllowPermissions) !== 0,
    requireWitness: (flags & kFlagRequireWitness) !== 0,
    maxCapDrops: limitOf(view.getBigUint64(kOffsetMaxCap), BigInt(kNoLimit)),
    maxPerTxDrops: limitOf(view.getBigUint64(kOffsetMaxPerTx), BigInt(kNoLimit)),
    maxDurationSeconds: limitOf(view.getUint32(kOffsetMaxDuration), kNoLimit),
  };
}

function checkDropsLimit(name: string, drops: bigint | null): bigint {
  if (drops === null) return BigInt(kNoLimit);
  if (drops <= 0n || drops > kMaxUint64) {
    throw new RangeError(`${name} must be between 1 and 2^64 - 1 drops, or null for no limit`);
  }
  return drops;
}

function checkSecondsLimit(seconds: number | null): number {
  if (seconds === null) return kNoLimit;
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > kMaxUint32) {
    throw new RangeError("maxDurationSeconds must be between 1 and 2^32 - 1, or null for no limit");
  }
  return seconds;
}

/** A policy → the 22 bytes the device answers to `INS 0x08` (`session_policy_serialize`). */
export function encodeSessionPolicy(policy: SessionPolicy): Uint8Array {
  const out = new Uint8Array(kSessionPolicySize);
  const view = new DataView(out.buffer);
  view.setUint8(kOffsetVersion, policy.version);
  view.setUint8(
    kOffsetFlags,
    (policy.enabled ? kFlagEnabled : 0) |
      (policy.allowAll ? kFlagAllowAll : 0) |
      (policy.allowPermissions ? kFlagAllowPermissions : 0) |
      (policy.requireWitness ? kFlagRequireWitness : 0),
  );
  view.setBigUint64(kOffsetMaxCap, checkDropsLimit("maxCapDrops", policy.maxCapDrops));
  view.setBigUint64(kOffsetMaxPerTx, checkDropsLimit("maxPerTxDrops", policy.maxPerTxDrops));
  view.setUint32(kOffsetMaxDuration, checkSecondsLimit(policy.maxDurationSeconds));
  return out;
}

/** `INS 0x08`, `P1 = P2 = 0x00`, no data: the session policy the user set on the device. */
export async function getSessionPolicy(transport: ApduTransport): Promise<SessionPolicy> {
  const data = await exchangeOk(transport, {
    cla: kCla,
    ins: kInsGetSessionPolicy,
    p1: 0,
    p2: 0,
    data: new Uint8Array(),
  });
  return parseSessionPolicy(data);
}
