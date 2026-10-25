/**
 * The device's session policy check on a decoded transaction, rule for rule as
 * `session_policy_check_transaction` (`ledger-app/src/policy/session_policy.c`): every
 * `SigningSessionSet`, the transaction itself or an inner transaction of a `Batch`, must fit the
 * policy. The refusal reason is the device's text (`session_policy_format_refusal`).
 */

import { kAllTransactionsFlagName, type Definitions } from "@carbs/sessions";
import { formatXrp } from "./screen.js";
import type { SessionPolicy } from "./session-policy.js";

/** What a `SigningSessionSet` asks for (`session_request_t`). */
interface SessionRequest {
  allTransactions: boolean;
  /** `undefined` when absent, `null` when present but not an XRP amount. */
  capDrops: bigint | null | undefined;
  maxPerTxDrops: bigint | null | undefined;
  durationSeconds: number | undefined;
  hasWitness: boolean;
}

/** A native XRP amount decodes to a string of drops; an issued currency or an MPT to an object. */
function xrpDrops(raw: unknown): bigint | null | undefined {
  if (raw === undefined) return undefined;
  return typeof raw === "string" && /^\d+$/u.test(raw) ? BigInt(raw) : null;
}

function requestOf(tx: Record<string, unknown>, allTransactionsFlag: number): SessionRequest {
  const duration = tx["SessionDuration"];
  return {
    allTransactions: (Number(tx["Flags"] ?? 0) & allTransactionsFlag) !== 0,
    capDrops: xrpDrops(tx["SessionCap"]),
    maxPerTxDrops: xrpDrops(tx["SessionMaxPerTx"]),
    durationSeconds: duration === undefined ? undefined : Number(duration),
    hasWitness: tx["SessionWitness"] !== undefined,
  };
}

const above = (name: string, value: bigint, limit: bigint) =>
  `${name} ${formatXrp(value.toString())} is above ${formatXrp(limit.toString())}`;

/** `session_policy_check` then `format_reason`: the refusal reason, or `undefined` when it fits. */
function checkRequest(policy: SessionPolicy, request: SessionRequest): string | undefined {
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

  if (policy.requireWitness && !request.hasWitness) return "No witness, your policy requires one";
  return undefined;
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
  const check = (session: Record<string, unknown>) =>
    checkRequest(policy, requestOf(session, allTransactionsFlag));

  if (tx["TransactionType"] === "SigningSessionSet") return check(tx);
  for (const [index, inner] of batchInnerTransactions(tx).entries()) {
    if (inner["TransactionType"] !== "SigningSessionSet") continue;
    const reason = check(inner);
    if (reason !== undefined) return `Transaction ${index + 1}: ${reason}`;
  }
  return undefined;
}
