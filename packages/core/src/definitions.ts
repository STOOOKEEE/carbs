/**
 * Protocol definitions read from the node's `server_definitions` (FIANSO-SPEC.md sections 3.8 and
 * 8.1). Codes are never copied by hand: the encoder, the flags and the result codes all come from
 * this answer.
 */

import { XrplDefinitions } from "ripple-binary-codec";
import {
  kAllTransactionsFlagName,
  kSessionFields,
  kSessionLedgerEntryType,
  kSessionResultCodes,
  kSessionTransactionTypes,
} from "./constants.js";

/** Field description as `server_definitions` writes it. */
export interface FieldInfo {
  nth: number;
  isVLEncoded: boolean;
  isSerialized: boolean;
  isSigningField: boolean;
  type: string;
}

/** The answer of `server_definitions` (the `result` object). */
export interface ServerDefinitions {
  TYPES: Record<string, number>;
  LEDGER_ENTRY_TYPES: Record<string, number>;
  FIELDS: [string, FieldInfo][];
  TRANSACTION_RESULTS: Record<string, number>;
  TRANSACTION_TYPES: Record<string, number>;
  TRANSACTION_FLAGS?: Record<string, Record<string, number>>;
  LEDGER_ENTRY_FLAGS?: Record<string, Record<string, number>>;
  ACCOUNT_SET_FLAGS?: Record<string, number>;
  hash?: string;
}

export class DefinitionsError extends Error {
  override readonly name = "DefinitionsError";
}

/** Definitions in use: the raw answer, the codec built from it, and typed lookups. */
export interface Definitions {
  readonly raw: ServerDefinitions;
  readonly codec: XrplDefinitions;
  readonly hash: string | undefined;
  /** True when the node serves the `SigningSessions` types, fields and codes. */
  readonly hasSessions: boolean;
  transactionType(name: string): number;
  resultCode(name: string): number;
  resultName(code: number): string | undefined;
  transactionFlag(transactionType: string, flagName: string): number;
  accountSetFlag(flagName: string): number;
  hasField(name: string): boolean;
}

export interface ParseOptions {
  /** Refuse definitions that lack the `SigningSessions` names (default true). */
  requireSessions?: boolean;
}

function isRecordOfNumbers(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "number")
  );
}

function isFieldInfo(value: unknown): value is FieldInfo {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["nth"] === "number" &&
    typeof v["isVLEncoded"] === "boolean" &&
    typeof v["isSerialized"] === "boolean" &&
    typeof v["isSigningField"] === "boolean" &&
    typeof v["type"] === "string"
  );
}

function isFields(value: unknown): value is [string, FieldInfo][] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        isFieldInfo(entry[1]),
    )
  );
}

function isFlagTable(value: unknown): value is Record<string, Record<string, number>> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((inner) => isRecordOfNumbers(inner))
  );
}

/** Validate the shape of a `server_definitions` result. Refuses an answer carrying only `hash`. */
export function asServerDefinitions(answer: unknown): ServerDefinitions {
  if (typeof answer !== "object" || answer === null) {
    throw new DefinitionsError("server_definitions: the answer is not an object");
  }
  const a = answer as Record<string, unknown>;
  if (a["FIELDS"] === undefined && typeof a["hash"] === "string") {
    throw new DefinitionsError(
      "server_definitions: the answer carries only `hash`; ask again without the `hash` parameter",
    );
  }
  for (const key of ["TYPES", "LEDGER_ENTRY_TYPES", "TRANSACTION_RESULTS", "TRANSACTION_TYPES"]) {
    if (!isRecordOfNumbers(a[key])) {
      throw new DefinitionsError(`server_definitions: ${key} is missing or malformed`);
    }
  }
  if (!isFields(a["FIELDS"])) {
    throw new DefinitionsError("server_definitions: FIELDS is missing or malformed");
  }
  for (const key of ["TRANSACTION_FLAGS", "LEDGER_ENTRY_FLAGS"]) {
    if (a[key] !== undefined && !isFlagTable(a[key])) {
      throw new DefinitionsError(`server_definitions: ${key} is malformed`);
    }
  }
  if (a["ACCOUNT_SET_FLAGS"] !== undefined && !isRecordOfNumbers(a["ACCOUNT_SET_FLAGS"])) {
    throw new DefinitionsError("server_definitions: ACCOUNT_SET_FLAGS is malformed");
  }
  if (a["hash"] !== undefined && typeof a["hash"] !== "string") {
    throw new DefinitionsError("server_definitions: hash is malformed");
  }
  // Every member was checked above.
  return a as unknown as ServerDefinitions;
}

/** The `SigningSessions` names missing from these definitions (empty when the node has them). */
export function missingSessionNames(raw: ServerDefinitions): string[] {
  const missing: string[] = [];
  for (const name of kSessionTransactionTypes) {
    if (raw.TRANSACTION_TYPES[name] === undefined) missing.push(`transaction type ${name}`);
  }
  const fieldNames = new Set(raw.FIELDS.map(([name]) => name));
  for (const name of kSessionFields) {
    if (!fieldNames.has(name)) missing.push(`field ${name}`);
  }
  if (raw.LEDGER_ENTRY_TYPES[kSessionLedgerEntryType] === undefined) {
    missing.push(`ledger entry type ${kSessionLedgerEntryType}`);
  }
  for (const code of kSessionResultCodes) {
    if (raw.TRANSACTION_RESULTS[code] === undefined) missing.push(`result code ${code}`);
  }
  if (raw.TRANSACTION_FLAGS?.["SigningSessionSet"]?.[kAllTransactionsFlagName] === undefined) {
    missing.push(`flag SigningSessionSet.${kAllTransactionsFlagName}`);
  }
  return missing;
}

/** Build the definitions in use from a `server_definitions` result. */
export function parseDefinitions(answer: unknown, options: ParseOptions = {}): Definitions {
  const raw = asServerDefinitions(answer);
  const missing = missingSessionNames(raw);
  const requireSessions = options.requireSessions ?? true;
  if (requireSessions && missing.length > 0) {
    throw new DefinitionsError(
      `server_definitions: the node does not serve SigningSessions (missing ${missing.join(", ")})`,
    );
  }
  const codec = new XrplDefinitions(raw);
  // ripple-binary-codec 2.11.0 binds `PermissionValue` to its name table in `associateTypes`, which
  // the constructor calls (src/enums/xrpl-definitions-base.ts:94) before it builds that table
  // (:121), so with custom definitions `PermissionValue` has no type (:145 assigns `undefined`) and
  // every `Permissions` array fails to encode. Binding again once the table exists fixes it.
  codec.associateTypes(codec.getAssociatedTypes());
  const fieldNames = new Set(raw.FIELDS.map(([name]) => name));
  const resultNames = new Map<number, string>(
    Object.entries(raw.TRANSACTION_RESULTS).map(([name, code]) => [code, name]),
  );

  const lookup = (table: Record<string, number> | undefined, name: string, what: string) => {
    const value = table?.[name];
    if (value === undefined) {
      throw new DefinitionsError(`server_definitions: unknown ${what} ${name}`);
    }
    return value;
  };

  return {
    raw,
    codec,
    hash: raw.hash,
    hasSessions: missing.length === 0,
    transactionType: (name) => lookup(raw.TRANSACTION_TYPES, name, "transaction type"),
    resultCode: (name) => lookup(raw.TRANSACTION_RESULTS, name, "result code"),
    resultName: (code) => resultNames.get(code),
    transactionFlag: (type, flag) =>
      lookup(raw.TRANSACTION_FLAGS?.[type], flag, `flag of ${type}:`),
    accountSetFlag: (flag) => lookup(raw.ACCOUNT_SET_FLAGS, flag, "AccountSet flag"),
    hasField: (name) => fieldNames.has(name),
  };
}

/** Anything that can answer a JSON-RPC method (see `node.ts`). */
export interface DefinitionsSource {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Ask the node for its definitions and build them. */
export async function loadDefinitions(
  node: DefinitionsSource,
  options: ParseOptions = {},
): Promise<Definitions> {
  const answer = await node.request("server_definitions", {});
  return parseDefinitions(answer, options);
}
