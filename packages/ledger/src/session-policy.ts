/**
 * The device's session policy (`docs/device-contract.md` section 7): the user's own limits on the
 * signing sessions the device agrees to open, edited only from the device settings. The default
 * limits apply to a `SigningSessionSet` that names no profile; one that names a profile (a memo
 * `carbs-profile`) is checked against that profile instead. The host reads it all with `INS 0x08`
 * (`ledger-app/src/policy/session_policy.h`, `session_policy_serialize`).
 */

import { bytesToHex, hexToBytes } from "@carbs/sessions";
import { kInsGetSessionPolicy } from "./apdu.js";
import { kitFlows, kSkipOpenApp, runDeviceAction, type XrpTransport } from "./kit.js";

/** `SESSION_POLICY_FORMAT_VERSION`. A version 1 answer (no profiles) is refused. */
export const kSessionPolicyVersion = 2;
/** `SESSION_POLICY_HEADER_SIZE`: version, flags, max cap, max per payment, max duration. */
const kHeaderSize = 22;
/** `SESSION_PROFILE_RECORD_SIZE`: one profile without its permissions. */
const kProfileRecordSize = 28;

/** `SESSION_POLICY_FLAG_*`. */
const kFlagEnabled = 0x01;
const kFlagAllowAll = 0x02;
const kFlagAllowPermissions = 0x04;
const kFlagRequireWitness = 0x08;
/** `SESSION_PROFILE_FLAG_ENABLED`. */
const kProfileFlagEnabled = 0x01;
/** `SESSION_MODE_*`. */
const kSessionModes = ["cap", "all", "permissions"] as const;
const kModeBits: Record<SessionMode, number> = { cap: 0x01, all: 0x02, permissions: 0x04 };

const kOffsetVersion = 0;
const kOffsetFlags = 1;
const kOffsetMaxCap = 2;
const kOffsetMaxPerTx = 10;
const kOffsetMaxDuration = 18;

/** `SESSION_POLICY_NO_LIMIT`: a limit at this value is not checked. */
const kNoLimit = 0;
const kMaxUint64 = (1n << 64n) - 1n;
const kMaxUint32 = 0xffffffff;
const kMaxUint8 = 0xff;
const kDropsPerXrp = 1_000_000n;

/** The profiles, in the order of their ids (`session_profile_id_t`). */
export const kSessionProfileNames = ["agent", "game", "trading", "streaming", "minting"] as const;
export type SessionProfileName = (typeof kSessionProfileNames)[number];
/** The memo that selects a profile: `MemoType` this text, `MemoData` the profile's name. */
export const kSessionProfileMemoType = "carbs-profile";

export type SessionMode = (typeof kSessionModes)[number];

export interface SessionProfilePolicy {
  name: SessionProfileName;
  /** Turned off in the settings: a session naming it is refused. */
  enabled: boolean;
  /** The modes it allows (fixed per profile). */
  modes: SessionMode[];
  /** Largest `SessionCap`, in drops; `null` outside mode C. */
  maxCapDrops: bigint | null;
  /** Largest `SessionMaxPerTx`, in drops (required under a cap); `null` outside mode C. */
  maxPerTxDrops: bigint | null;
  /** Largest `SessionDuration`, in seconds. */
  maxDurationSeconds: number;
  /** Largest `SessionMaxTxCount`, which a session naming the profile must carry. */
  maxTxCount: number;
  /** The `PermissionValue`s it allows in mode P (fixed per profile). */
  permissions: number[];
}

export interface SessionPolicy {
  version: number;
  /** The policy is checked; when off, nothing else applies. */
  enabled: boolean;
  /** Mode A (`tfAllTransactions`) allowed, without a profile. */
  allowAll: boolean;
  /** Mode P (`Permissions`) allowed, without a profile. */
  allowPermissions: boolean;
  /** `SessionWitness` must be present, profile or not. */
  requireWitness: boolean;
  /** Largest `SessionCap` without a profile, in drops; `null` = no limit. */
  maxCapDrops: bigint | null;
  /** Largest `SessionMaxPerTx` without a profile, in drops; `null` = no limit. */
  maxPerTxDrops: bigint | null;
  /** Largest `SessionDuration` without a profile, in seconds; `null` = no limit. */
  maxDurationSeconds: number | null;
  /** Every profile, in the order of `kSessionProfileNames`. */
  profiles: SessionProfilePolicy[];
}

const xrp = (amount: bigint) => amount * kDropsPerXrp;

/** The profiles of a fresh install: on, with their default limits (`session_profiles.c`). */
export const kDefaultSessionProfiles: readonly SessionProfilePolicy[] = [
  {
    name: "agent",
    enabled: true,
    modes: ["cap"],
    maxCapDrops: xrp(50n),
    maxPerTxDrops: xrp(5n),
    maxDurationSeconds: 180,
    maxTxCount: 20,
    permissions: [],
  },
  {
    name: "game",
    enabled: true,
    modes: ["cap"],
    maxCapDrops: xrp(5n),
    maxPerTxDrops: xrp(1n) / 10n,
    maxDurationSeconds: 600,
    maxTxCount: 500,
    permissions: [],
  },
  {
    name: "trading",
    enabled: true,
    modes: ["permissions"],
    maxCapDrops: null,
    maxPerTxDrops: null,
    maxDurationSeconds: 600,
    maxTxCount: 200,
    // OfferCreate (7 + 1) and OfferCancel (8 + 1)
    permissions: [8, 9],
  },
  {
    name: "streaming",
    enabled: true,
    modes: ["cap"],
    maxCapDrops: xrp(2n),
    maxPerTxDrops: xrp(1n) / 100n,
    maxDurationSeconds: 600,
    maxTxCount: 1000,
    permissions: [],
  },
  {
    name: "minting",
    enabled: true,
    modes: ["permissions"],
    maxCapDrops: null,
    maxPerTxDrops: null,
    maxDurationSeconds: 600,
    maxTxCount: 100,
    // NFTokenMint (25 + 1)
    permissions: [26],
  },
];

/** Fresh install: all zero in NVM, policy off, every profile on with its defaults. */
export const kSessionPolicyOff: SessionPolicy = {
  version: kSessionPolicyVersion,
  enabled: false,
  allowAll: false,
  allowPermissions: false,
  requireWitness: false,
  maxCapDrops: null,
  maxPerTxDrops: null,
  maxDurationSeconds: null,
  profiles: kDefaultSessionProfiles.map((profile) => ({
    ...profile,
    modes: [...profile.modes],
    permissions: [...profile.permissions],
  })),
};

/** `Game` for `game`: the profile's name on the device screens (`session_profile_title`). */
export function sessionProfileTitle(name: SessionProfileName): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The `carbs-profile` memos of a transaction (`session_profile_memo_t`). */
export type ProfileMemo =
  | { kind: "none" }
  | { kind: "found"; name: SessionProfileName }
  | { kind: "unknown" }
  | { kind: "duplicate" };

const kProfileMemoTypeHex = bytesToHex(new TextEncoder().encode(kSessionProfileMemoType));

/** The decoded `Memos` → its `carbs-profile` memos, as `session_profile_read_memo`. */
export function profileMemoOf(memos: unknown): ProfileMemo {
  if (!Array.isArray(memos)) return { kind: "none" };
  let found: ProfileMemo = { kind: "none" };
  for (const wrapped of memos) {
    const memo: unknown =
      typeof wrapped === "object" && wrapped !== null ? Reflect.get(wrapped, "Memo") : undefined;
    if (typeof memo !== "object" || memo === null) continue;
    const type: unknown = Reflect.get(memo, "MemoType");
    if (typeof type !== "string" || type.toUpperCase() !== kProfileMemoTypeHex) continue;
    if (found.kind !== "none") return { kind: "duplicate" };
    const data: unknown = Reflect.get(memo, "MemoData");
    const text = typeof data === "string" ? String.fromCharCode(...hexToBytes(data)) : undefined;
    const name = kSessionProfileNames.find((profileName) => profileName === text);
    found = name === undefined ? { kind: "unknown" } : { kind: "found", name };
  }
  return found;
}

export class SessionPolicyError extends Error {
  override readonly name = "SessionPolicyError";
}

function limitOf<T extends bigint | number>(value: T, noLimit: T): T | null {
  return value === noLimit ? null : value;
}

/** Reads one profile record at `offset`; returns it with the offset after it. */
function readProfile(
  view: DataView,
  offset: number,
  index: number,
): { profile: SessionProfilePolicy; next: number } {
  const truncated = () =>
    new SessionPolicyError(
      `session policy truncated in profile ${index} (${view.byteLength} bytes)`,
    );
  if (offset + kProfileRecordSize > view.byteLength) throw truncated();
  const id = view.getUint8(offset);
  if (id !== index) {
    throw new SessionPolicyError(`session policy profile ${index} has id ${id}`);
  }
  const permissionsCount = view.getUint8(offset + kProfileRecordSize - 1);
  const next = offset + kProfileRecordSize + 4 * permissionsCount;
  if (next > view.byteLength) throw truncated();
  const modeBits = view.getUint8(offset + 2);
  const modes = kSessionModes.filter((mode) => (modeBits & kModeBits[mode]) !== 0);
  const hasCap = modes.includes("cap");
  const permissions = Array.from({ length: permissionsCount }, (_, i) =>
    view.getUint32(offset + kProfileRecordSize + 4 * i),
  );
  return {
    profile: {
      name: kSessionProfileNames[index]!,
      enabled: (view.getUint8(offset + 1) & kProfileFlagEnabled) !== 0,
      modes,
      maxCapDrops: hasCap ? view.getBigUint64(offset + 3) : null,
      maxPerTxDrops: hasCap ? view.getBigUint64(offset + 11) : null,
      maxDurationSeconds: view.getUint32(offset + 19),
      maxTxCount: view.getUint32(offset + 23),
      permissions,
    },
    next,
  };
}

/** The `INS 0x08` answer → a policy. Throws `SessionPolicyError` on an unknown version or layout. */
export function parseSessionPolicy(bytes: Uint8Array): SessionPolicy {
  if (bytes.length === 0) {
    throw new SessionPolicyError("the device answered an empty session policy");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint8(kOffsetVersion);
  if (version !== kSessionPolicyVersion) {
    throw new SessionPolicyError(
      `session policy format ${version} is not supported (expected ${kSessionPolicyVersion})`,
    );
  }
  if (bytes.length < kHeaderSize + 1) {
    throw new SessionPolicyError(
      `expected at least ${kHeaderSize + 1} bytes of session policy, the device answered ${bytes.length}`,
    );
  }
  const count = view.getUint8(kHeaderSize);
  if (count !== kSessionProfileNames.length) {
    throw new SessionPolicyError(
      `expected ${kSessionProfileNames.length} session profiles, the device answered ${count}`,
    );
  }
  const profiles: SessionProfilePolicy[] = [];
  let offset = kHeaderSize + 1;
  for (let index = 0; index < count; index++) {
    const { profile, next } = readProfile(view, offset, index);
    profiles.push(profile);
    offset = next;
  }
  if (offset !== bytes.length) {
    throw new SessionPolicyError(
      `session policy has ${bytes.length - offset} bytes after its last profile`,
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
    profiles,
  };
}

function checkDropsLimit(name: string, drops: bigint | null): bigint {
  if (drops === null) return BigInt(kNoLimit);
  if (drops <= 0n || drops > kMaxUint64) {
    throw new RangeError(`${name} must be between 1 and 2^64 - 1 drops, or null for no limit`);
  }
  return drops;
}

function checkUint32(name: string, value: number | null): number {
  if (value === null) return kNoLimit;
  if (!Number.isInteger(value) || value <= 0 || value > kMaxUint32) {
    throw new RangeError(`${name} must be between 1 and 2^32 - 1, or null for no limit`);
  }
  return value;
}

function checkProfiles(profiles: SessionProfilePolicy[]): void {
  const names = profiles.map((profile) => profile.name);
  if (names.join() !== kSessionProfileNames.join()) {
    throw new RangeError(`profiles must be ${kSessionProfileNames.join(", ")}, in this order`);
  }
  for (const profile of profiles) {
    if (profile.permissions.length > kMaxUint8) {
      throw new RangeError(`profile ${profile.name} lists too many permissions`);
    }
  }
}

function profileRecord(profile: SessionProfilePolicy, id: number): Uint8Array {
  const out = new Uint8Array(kProfileRecordSize + 4 * profile.permissions.length);
  const view = new DataView(out.buffer);
  const name = `profile ${profile.name}`;
  view.setUint8(0, id);
  view.setUint8(1, profile.enabled ? kProfileFlagEnabled : 0);
  view.setUint8(
    2,
    profile.modes.reduce((bits, mode) => bits | kModeBits[mode], 0),
  );
  view.setBigUint64(3, checkDropsLimit(`${name} maxCapDrops`, profile.maxCapDrops));
  view.setBigUint64(11, checkDropsLimit(`${name} maxPerTxDrops`, profile.maxPerTxDrops));
  view.setUint32(19, checkUint32(`${name} maxDurationSeconds`, profile.maxDurationSeconds));
  view.setUint32(23, checkUint32(`${name} maxTxCount`, profile.maxTxCount));
  view.setUint8(27, profile.permissions.length);
  profile.permissions.forEach((permission, i) => {
    view.setUint32(kProfileRecordSize + 4 * i, checkUint32(`${name} permission`, permission));
  });
  return out;
}

/** A policy → the bytes the device answers to `INS 0x08` (`session_policy_serialize`). */
export function encodeSessionPolicy(policy: SessionPolicy): Uint8Array {
  checkProfiles(policy.profiles);
  const header = new Uint8Array(kHeaderSize + 1);
  const view = new DataView(header.buffer);
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
  view.setUint32(kOffsetMaxDuration, checkUint32("maxDurationSeconds", policy.maxDurationSeconds));
  view.setUint8(kHeaderSize, policy.profiles.length);
  const records = policy.profiles.map(profileRecord);
  const out = new Uint8Array(header.length + records.reduce((size, r) => size + r.length, 0));
  out.set(header);
  let offset = header.length;
  for (const record of records) {
    out.set(record, offset);
    offset += record.length;
  }
  return out;
}

/**
 * `INS 0x08`, `P1 = P2 = 0x00`, no data (the kit's `getSessionPolicy`): the session policy the
 * user set on the device. The kit parses the answer with the same refusals as
 * `parseSessionPolicy` (another version, a truncated record, trailing bytes); its model carries
 * each profile's id, which this one gives by position.
 */
export async function getSessionPolicy(transport: XrpTransport): Promise<SessionPolicy> {
  const policy = await runDeviceAction(
    kitFlows(transport).getSessionPolicy({ skipOpenApp: kSkipOpenApp }),
    kInsGetSessionPolicy,
  );
  return {
    version: policy.version,
    enabled: policy.enabled,
    allowAll: policy.allowAll,
    allowPermissions: policy.allowPermissions,
    requireWitness: policy.requireWitness,
    maxCapDrops: policy.maxCapDrops,
    maxPerTxDrops: policy.maxPerTxDrops,
    maxDurationSeconds: policy.maxDurationSeconds,
    profiles: policy.profiles.map((profile) => ({
      name: profile.name,
      enabled: profile.enabled,
      modes: [...profile.modes],
      maxCapDrops: profile.maxCapDrops,
      maxPerTxDrops: profile.maxPerTxDrops,
      maxDurationSeconds: profile.maxDurationSeconds,
      maxTxCount: profile.maxTxCount,
      permissions: [...profile.permissions],
    })),
  };
}
