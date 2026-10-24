/**
 * The review lines of the XRP app, as the client expects the device to show them
 * (`docs/device-contract.md`, FIANSO-SPEC.md section 7.3). They follow the device track's frozen
 * vectors (`ledger-app/tests/standalone/testcases/*.txt`, one `Label; value` line each).
 *
 * Order: `Transaction Type`, `Account`, `Session key` (when present), then every shown field in
 * serialization order, then the synthetic `Note` of `SigningSessionSet`.
 */

import type { Definitions } from "@carbs/sessions";

export interface ScreenLine {
  label: string;
  value: string;
}

/** `ledger-app/src/xrp/general.c:110-112` and upstream names. */
const kTransactionNames: Record<string, string> = {
  SigningSessionSet: "Open session",
  SigningSessionDelete: "Close session",
  SetRegularKey: "Set Regular Key",
  AccountSet: "Account Setting",
  Payment: "Payment",
};

/** `ledger-app/src/xrp/signing_session.h:33` */
export const kSessionNoteText = "Cannot change keys, signers or the account";

/** Fields the app never shows (`SigningPubKey` is hidden upstream; sequencing fields are not reviewed). */
const kHidden = new Set([
  "SigningPubKey",
  "TxnSignature",
  "Sequence",
  "LastLedgerSequence",
  "TransactionType",
]);

const kLabels: Record<string, string> = {
  Account: "Account",
  SessionKey: "Session key",
  NetworkID: "Network ID",
  SessionDuration: "Valid for",
  Fee: "Fee",
  SessionCap: "Max spend",
  Owner: "Owner",
  RegularKey: "Regular Key",
  SetFlag: "Set Flag",
  ClearFlag: "Clear Flag",
  Amount: "Amount",
  Destination: "Destination",
  DestinationTag: "Destination Tag",
};

/** `ledger-app/src/xrp/flags.c:141` and the upstream AccountSet flag names the contract uses. */
const kAccountSetFlagNames: Record<string, string> = {
  asfDisableMaster: "Disable Master",
  asfDefaultRipple: "Default Ripple",
  asfRequireDest: "Require Dest",
  asfDepositAuth: "Deposit Auth",
};

/** Drops → `XRP 0.000012` (no trailing zeros). */
export function formatXrp(drops: string): string {
  const value = BigInt(drops);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `XRP ${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Seconds → `10 minutes`, `1 minute`, `1 min 30 s`, `45 s` (the device's duration formatter). */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} s`;
  if (rest === 0) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return `${minutes} min ${rest} s`;
}

function value(
  field: string,
  raw: unknown,
  tx: Record<string, unknown>,
  defs: Definitions,
): string | undefined {
  switch (field) {
    case "Fee":
    case "SessionCap":
      return formatXrp(String(raw));
    case "Amount":
      return typeof raw === "string" ? formatXrp(raw) : undefined;
    case "SessionDuration":
      return formatDuration(Number(raw));
    case "SetFlag":
    case "ClearFlag": {
      const entry = Object.entries(defs.raw.ACCOUNT_SET_FLAGS ?? {}).find(
        ([, v]) => v === Number(raw),
      );
      return entry ? (kAccountSetFlagNames[entry[0]] ?? entry[0]) : String(raw);
    }
    case "Flags":
      return tx["TransactionType"] === "SigningSessionSet" ? undefined : String(raw);
    default:
      return typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
  }
}

export interface Review {
  /** `clear` when every field has a line; `blind` when the client cannot predict the review. */
  kind: "clear" | "blind";
  lines: ScreenLine[];
}

/** The lines the device shows for a decoded transaction. */
export function reviewLines(tx: Record<string, unknown>, defs: Definitions): Review {
  const type = String(tx["TransactionType"]);
  const name = kTransactionNames[type];
  if (!name) return { kind: "blind", lines: [{ label: "Transaction Type", value: type }] };
  const lines: ScreenLine[] = [{ label: "Transaction Type", value: name }];
  lines.push({ label: "Account", value: String(tx["Account"]) });
  if (typeof tx["SessionKey"] === "string")
    lines.push({ label: "Session key", value: tx["SessionKey"] });
  const ordinal = (field: string) =>
    defs.codec.field.fromString(field)?.ordinal ?? Number.MAX_SAFE_INTEGER;
  const fields = Object.keys(tx)
    .filter((f) => !kHidden.has(f) && f !== "Account" && f !== "SessionKey")
    .sort((a, b) => ordinal(a) - ordinal(b));
  let kind: Review["kind"] = "clear";
  for (const field of fields) {
    const raw = tx[field];
    if (field === "Flags") {
      const all = defs.raw.TRANSACTION_FLAGS?.["SigningSessionSet"]?.["tfAllTransactions"];
      if (type === "SigningSessionSet" && all !== undefined && Number(raw) === all) {
        lines.push({ label: "Allows", value: "All transactions" });
      } else if (Number(raw) !== 0) {
        lines.push({ label: "Flags", value: String(raw) });
      }
      continue;
    }
    if (field === "Permissions" && Array.isArray(raw)) {
      raw.forEach((wrapped: unknown, i) => {
        const permission = (wrapped as { Permission?: { PermissionValue?: unknown } }).Permission;
        lines.push({ label: `Allows [${i + 1}]`, value: String(permission?.PermissionValue) });
      });
      continue;
    }
    const label = kLabels[field];
    const shown = value(field, raw, tx, defs);
    if (!label || shown === undefined) {
      kind = "blind";
      lines.push({ label: field, value: JSON.stringify(raw) });
      continue;
    }
    lines.push({ label, value: shown });
  }
  if (type === "SigningSessionSet") lines.push({ label: "Note", value: kSessionNoteText });
  return { kind, lines };
}

/** Parse a device vector `.txt` (`Label; value`, addresses split over the screen width). */
export function parseScreenVector(text: string): ScreenLine[] {
  return text
    .split("\n")
    .filter((line) => line.includes(";"))
    .map((line) => {
      const at = line.indexOf(";");
      const label = line.slice(0, at).trim();
      const raw = line.slice(at + 1).trim();
      const compact = raw.replace(/\s+/gu, "");
      const isAddress = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/u.test(compact);
      return { label, value: isAddress ? compact : raw };
    });
}
