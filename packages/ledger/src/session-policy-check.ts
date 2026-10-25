/**
 * The device's session policy check on a decoded transaction, rule for rule as
 * `session_policy_check_transaction` (`ledger-app/src/policy/session_policy.c`): every
 * `SigningSessionSet`, the transaction itself or an inner transaction of a `Batch`, must fit the
 * policy, or the profile it names with a `carbs-profile` memo. The refusal reason is the device's
 * text (`session_policy_format_refusal`).
 */

import { kAllTransactionsFlagName, type Definitions } from "@carbs/sessions";
import { formatXrp } from "./screen.js";
import {
  profileMemoOf,
  sessionProfileTitle,
  type ProfileMemo,
  type SessionPolicy,
  type SessionProfilePolicy,
} from "./session-policy.js";

/** The node's own bound on `SessionMaxTxCount` (rippled `Protocol.h`, `kMaxSessionTxCount`). */
const kMaxSessionTxCount = 100_000;

/** What a `SigningSessionSet` asks for (`session_request_t`). */
interface SessionRequest {
  allTransactions: boolean;
  /** The decoded `PermissionValue`s (a name, or a number the codec cannot name). */
  permissions: unknown[] | undefined;
  /** `undefined` when absent, `null` when present but not an XRP amount. */
  capDrops: bigint | null | undefined;
  maxPerTxDrops: bigint | null | undefined;
  durationSeconds: number | undefined;
  maxTxCount: number | undefined;
  hasWitness: boolean;
  profile: ProfileMemo;
}

/** A native XRP amount decodes to a string of drops; an issued currency or an MPT to an object. */
function xrpDrops(raw: unknown): bigint | null | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && /^\d+$/u.test(raw) ? BigInt(raw) : null;
}

function requestOf(
  tx: Record<string, unknown>,
  allTransactionsFlag: number,
  readMemos: boolean,
): SessionRequest {
  const duration = tx["SessionDuration"];
  const count = tx["SessionMaxTxCount"];
  const permissions = tx["Permissions"];
  return {
    allTransactions: (Number(tx["Flags"] ?? 0) & allTransactionsFlag) !== 0,
    permissions: Array.isArray(permissions)
      ? permissions.map((wrapped: unknown) => {
          const permission: unknown =
            typeof wrapped === "object" && wrapped !== null
              ? Reflect.get(wrapped, "Permission")
              : undefined;
          return typeof permission === "object" && permission !== null
            ? Reflect.get(permission, "PermissionValue")
            : undefined;
        })
      : undefined,
    capDrops: xrpDrops(tx["SessionCap"]),
    maxPerTxDrops: xrpDrops(tx["SessionMaxPerTx"]),
    durationSeconds: duration === undefined ? undefined : Number(duration),
    maxTxCount: count === undefined ? undefined : Number(count),
    hasWitness: tx["SessionWitness"] !== undefined,
    // Only the transaction itself can name a profile: memos inside a Batch never clear-sign.
    profile: readMemos ? profileMemoOf(tx["Memos"]) : { kind: "none" },
  };
}

const above = (name: string, value: bigint, limit: bigint) =>
  `${name} ${formatXrp(value.toString())} is above ${formatXrp(limit.toString())}`;

/** `PermissionValue` = transaction type + 1; a granular permission has no transaction type. */
function permissionValue(permission: unknown, defs: Definitions): number | undefined {
  if (typeof permission === "number") return permission;
  if (typeof permission !== "string") return undefined;
  const type = defs.raw.TRANSACTION_TYPES[permission];
  return type === undefined ? undefined : type + 1;
}

/** `check_default_limits`: the user's own limits, for a session that names no profile. */
function checkDefaultLimits(policy: SessionPolicy, request: SessionRequest): string | undefined {
  const hasCap = request.capDrops !== undefined;
  if (request.allTransactions) {
    if (!policy.allowAll) return "Sessions for all transactions are not allowed";
  } else if (!hasCap && !policy.allowPermissions) {
    return "Sessions with permissions are not allowed";
  }

  if (hasCap && policy.maxCapDrops !== null) {
    if (request.capDrops === null) return "Max spend is not an XRP amount";
    if (request.capDrops !== undefined && request.capDrops > policy.maxCapDrops)
      return above("Max spend", request.capDrops, policy.maxCapDrops);
  }

  if (policy.maxPerTxDrops !== null) {
    // A per-payment bound only exists under a cap (mode C): required there, checked wherever
    // it appears.
    if (hasCap && request.maxPerTxDrops === undefined)
      return `No max per payment (limit ${formatXrp(policy.maxPerTxDrops.toString())})`;
    if (request.maxPerTxDrops === null) return "Max per payment is not an XRP amount";
    if (request.maxPerTxDrops !== undefined && request.maxPerTxDrops > policy.maxPerTxDrops)
      return above("Max per payment", request.maxPerTxDrops, policy.maxPerTxDrops);
  }

  if (policy.maxDurationSeconds !== null) {
    if (request.durationSeconds === undefined) return "No session duration";
    if (request.durationSeconds > policy.maxDurationSeconds)
      return `Duration ${request.durationSeconds} s is above ${policy.maxDurationSeconds} s`;
  }
  return undefined;
}

/** `check_profile_limits`: the limits of the profile the session names. */
function checkProfileLimits(
  profile: SessionProfilePolicy,
  request: SessionRequest,
  defs: Definitions,
): string | undefined {
  if (!profile.enabled) return "This profile is off in your settings";
  const mode = request.allTransactions
    ? "all"
    : request.permissions !== undefined
      ? "permissions"
      : "cap";
  if (!profile.modes.includes(mode)) return "Session mode not allowed by this profile";
  for (const permission of request.permissions ?? []) {
    const value = permissionValue(permission, defs);
    if (value === undefined || !profile.permissions.includes(value))
      return `${String(permission)} is not allowed`;
  }

  if (request.capDrops != null && profile.maxCapDrops !== null) {
    if (request.capDrops > profile.maxCapDrops)
      return above("Max spend", request.capDrops, profile.maxCapDrops);
    if (profile.maxPerTxDrops !== null) {
      if (request.maxPerTxDrops === undefined)
        return `No max per payment (limit ${formatXrp(profile.maxPerTxDrops.toString())})`;
      if (request.maxPerTxDrops !== null && request.maxPerTxDrops > profile.maxPerTxDrops)
        return above("Max per payment", request.maxPerTxDrops, profile.maxPerTxDrops);
    }
  }
  if (request.durationSeconds !== undefined && request.durationSeconds > profile.maxDurationSeconds)
    return `Duration ${request.durationSeconds} s is above ${profile.maxDurationSeconds} s`;

  if (request.maxTxCount === undefined)
    return `Set a transaction limit (at most ${profile.maxTxCount})`;
  if (request.maxTxCount > profile.maxTxCount)
    return `Max transactions ${request.maxTxCount} is above ${profile.maxTxCount}`;
  return undefined;
}

/** `session_policy_check` then `format_reason` for one `SigningSessionSet`. */
function checkRequest(
  policy: SessionPolicy,
  request: SessionRequest,
  defs: Definitions,
): string | undefined {
  const { maxTxCount } = request;
  if (maxTxCount !== undefined && (maxTxCount === 0 || maxTxCount > kMaxSessionTxCount)) {
    return `Max transactions ${maxTxCount} is not 1 to ${kMaxSessionTxCount}`;
  }
  const withWitness = (refusal: string | undefined) =>
    refusal ??
    (policy.requireWitness && !request.hasWitness
      ? "No witness, your policy requires one"
      : undefined);

  switch (request.profile.kind) {
    case "none":
      return withWitness(checkDefaultLimits(policy, request));
    case "unknown":
      return "Unknown session profile";
    case "duplicate":
      return "More than one session profile";
    case "found": {
      const { name } = request.profile;
      const profile = policy.profiles.find((candidate) => candidate.name === name);
      if (profile === undefined) return "Unknown session profile";
      const refusal = withWitness(checkProfileLimits(profile, request, defs));
      return refusal === undefined ? undefined : `Profile ${sessionProfileTitle(name)}: ${refusal}`;
    }
  }
}

/** The inner transactions of a decoded `Batch` (`RawTransactions[].RawTransaction`). */
export function batchInnerTransactions(tx: Record<string, unknown>): Record<string, unknown>[] {
  const raw = tx["RawTransactions"];
  if (tx["TransactionType"] !== "Batch" || !Array.isArray(raw)) return [];
  return raw.flatMap((wrapped: unknown) => {
    const inner: unknown =
      typeof wrapped === "object" && wrapped !== null
        ? Reflect.get(wrapped, "RawTransaction")
        : undefined;
    return typeof inner === "object" && inner !== null ? [inner as Record<string, unknown>] : [];
  });
}

/**
 * Why the device's session policy refuses this decoded transaction (its refusal screen text), or
 * `undefined` when every `SigningSessionSet` in it fits, or when the policy is off.
 */
export function sessionPolicyRefusal(
  policy: SessionPolicy,
  tx: Record<string, unknown>,
  defs: Definitions,
): string | undefined {
  if (!policy.enabled) return undefined;
  const allTransactionsFlag =
    defs.raw.TRANSACTION_FLAGS?.["SigningSessionSet"]?.[kAllTransactionsFlagName] ?? 0;

  if (tx["TransactionType"] === "SigningSessionSet")
    return checkRequest(policy, requestOf(tx, allTransactionsFlag, true), defs);
  for (const [index, inner] of batchInnerTransactions(tx).entries()) {
    if (inner["TransactionType"] !== "SigningSessionSet") continue;
    const reason = checkRequest(policy, requestOf(inner, allTransactionsFlag, false), defs);
    if (reason !== undefined) return `Transaction ${index + 1}: ${reason}`;
  }
  return undefined;
}
