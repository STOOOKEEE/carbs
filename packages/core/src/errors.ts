/**
 * Result codes as the node gives them (FIANSO-SPEC.md sections 6.13 and 8.2). The code string and
 * the node's own message are kept as they are; the client only adds which rule produced a
 * `tefSESSION_*` code and a one-sentence explanation for the UI.
 */

export type ResultCategory = "tes" | "tec" | "tef" | "tel" | "tem" | "ter";

export type SessionResultCode =
  "tefSESSION_EXPIRED" | "tefSESSION_LIMIT" | "tefSESSION_TX_NOT_ALLOWED";

export interface SessionRule {
  /** One sentence for the UI. */
  text: string;
  /** Where the rule is specified. */
  rule: string;
}

/** The rules behind the three session codes (section 6.5). */
export const kSessionRules: Readonly<Record<SessionResultCode, SessionRule>> = {
  tefSESSION_TX_NOT_ALLOWED: {
    text: "The session does not allow this transaction (type, shape, or a missing or far LastLedgerSequence).",
    rule: "FIANSO-SPEC.md 6.5 rules 1 and 2",
  },
  tefSESSION_EXPIRED: {
    text: "The session has expired; only its own close is still accepted.",
    rule: "FIANSO-SPEC.md 6.5 rule 3",
  },
  tefSESSION_LIMIT: {
    text: "The fee is above the session's ceiling, or fee and amount exceed what remains of the cap.",
    rule: "FIANSO-SPEC.md 6.5 rules 4 and 5",
  },
};

export function isSessionResultCode(code: string): code is SessionResultCode {
  return Object.hasOwn(kSessionRules, code);
}

export function resultCategory(code: string): ResultCategory | undefined {
  const prefix = code.slice(0, 3);
  switch (prefix) {
    case "tes":
    case "tec":
    case "tef":
    case "tel":
    case "tem":
    case "ter":
      return prefix;
    default:
      return undefined;
  }
}

/** Whether a transaction with this result is included in a ledger and charged its fee. */
export function isIncluded(code: string): boolean {
  const category = resultCategory(code);
  return category === "tes" || category === "tec";
}

/** A result the node gave for a transaction that did not succeed. */
export class NodeResultError extends Error {
  override readonly name: string = "NodeResultError";
  readonly category: ResultCategory | undefined;
  /** True for a `tec`: included, fee charged. */
  readonly included: boolean;
  constructor(
    readonly code: string,
    readonly nodeMessage: string,
    readonly hash?: string,
  ) {
    super(nodeMessage.length > 0 ? `${code}: ${nodeMessage}` : code);
    this.category = resultCategory(code);
    this.included = isIncluded(code);
  }
}

/** A `tefSESSION_*` refusal: never included, no fee. */
export class SessionRefusedError extends NodeResultError {
  override readonly name: string = "SessionRefusedError";
  readonly rule: SessionRule;
  constructor(
    override readonly code: SessionResultCode,
    nodeMessage: string,
    hash?: string,
  ) {
    super(code, nodeMessage, hash);
    this.rule = kSessionRules[code];
  }
}

export class SessionExpiredError extends SessionRefusedError {
  override readonly name = "SessionExpiredError";
}
export class SessionLimitError extends SessionRefusedError {
  override readonly name = "SessionLimitError";
}
export class SessionTxNotAllowedError extends SessionRefusedError {
  override readonly name = "SessionTxNotAllowedError";
}

/** The typed error for a result code (`tesSUCCESS` has none). */
export function resultError(code: string, nodeMessage: string, hash?: string): NodeResultError {
  switch (code) {
    case "tefSESSION_EXPIRED":
      return new SessionExpiredError(code, nodeMessage, hash);
    case "tefSESSION_LIMIT":
      return new SessionLimitError(code, nodeMessage, hash);
    case "tefSESSION_TX_NOT_ALLOWED":
      return new SessionTxNotAllowedError(code, nodeMessage, hash);
    default:
      return new NodeResultError(code, nodeMessage, hash);
  }
}

/** An RPC-level error (the method failed, no transaction result). */
export class RpcError extends Error {
  override readonly name = "RpcError";
  constructor(
    readonly method: string,
    readonly error: string,
    readonly errorMessage: string,
    /** `error_exception`, where the node explains a local-check refusal. */
    readonly exception: string = "",
  ) {
    const detail = [errorMessage, exception].filter((t) => t.length > 0).join("; ");
    super(`${method}: ${error}${detail ? ` (${detail})` : ""}`);
  }
}
