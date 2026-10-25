/**
 * The review lines of the XRP app, as the client expects the device to show them
 * (`docs/device-contract.md`, FIANSO-SPEC.md section 7.3). They follow the device track's frozen
 * vectors (`ledger-app/tests/standalone/testcases/*.txt`, one `Label; value` line each).
 *
 * Order: `Transaction Type`, `Account`, `Session key` (when present), then every shown field in
 * serialization order, then the synthetic rows of `SigningSessionSet`: `Allows` in mode C (a
 * `SessionCap` is set), then `Note`.
 */

import { kPermissionMaxSize, type Definitions } from "@carbs/sessions";

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

/** `ledger-app/src/xrp/signing_session.h:39` */
export const kSessionNoteText = "Cannot change keys or signers";
/** The mode C `Allows` row (`ledger-app/src/xrp/signing_session.h:45-46`). */
export const kSessionCapScopeText = "XRP payments only, fees included";

/**
 * The permission names the app can show (`ledger-app/src/xrp/session_permissions.c`; a test reads
 * that file and checks this list against it). Any other value makes the app ask for blind signing.
 */
export const kDevicePermissionNames: ReadonlySet<string> = new Set([
  "Payment",
  "EscrowCreate",
  "EscrowFinish",
  "EscrowCancel",
  "OfferCreate",
  "OfferCancel",
  "TicketCreate",
  "PaymentChannelCreate",
  "PaymentChannelFund",
  "PaymentChannelClaim",
  "CheckCreate",
  "CheckCash",
  "CheckCancel",
  "DepositPreauth",
  "TrustSet",
  "NFTokenMint",
  "NFTokenBurn",
  "NFTokenCreateOffer",
  "NFTokenCancelOffer",
  "NFTokenAcceptOffer",
  "Clawback",
  "AMMClawback",
  "AMMCreate",
  "AMMDeposit",
  "AMMWithdraw",
  "AMMVote",
  "AMMBid",
  "AMMDelete",
  "XChainCreateClaimID",
  "XChainCommit",
  "XChainClaim",
  "XChainAccountCreateCommit",
  "XChainAddClaimAttestation",
  "XChainAddAccountCreateAttestation",
  "XChainModifyBridge",
  "XChainCreateBridge",
  "DIDSet",
  "DIDDelete",
  "OracleSet",
  "OracleDelete",
  "LedgerStateFix",
  "MPTokenIssuanceCreate",
  "MPTokenIssuanceDestroy",
  "MPTokenIssuanceSet",
  "MPTokenAuthorize",
  "CredentialCreate",
  "CredentialAccept",
  "CredentialDelete",
  "NFTokenModify",
  "PermissionedDomainSet",
  "PermissionedDomainDelete",
  "ConfidentialMPTMergeInbox",
  "ConfidentialMPTConvertBack",
  "ConfidentialMPTSend",
  "ConfidentialMPTClawback",
  "SponsorshipSet",
  "PaymentChannelClawback",
  "CouponClaim",
  "AMMBinCreate",
  "AMMBinDestroy",
  "AMMCollectFees",
  "AMMPositionTransfer",
  "PasskeyListSet",
  "RepoCreate",
  "RepoAccept",
  "RepoCancel",
  "RepoClose",
  "RepoDefault",
  "SubscriptionSet",
  "SubscriptionCancel",
  "SubscriptionClaim",
  "TrustlineAuthorize",
  "TrustlineFreeze",
  "TrustlineUnfreeze",
  "AccountDomainSet",
  "AccountEmailHashSet",
  "AccountMessageKeySet",
  "AccountTransferRateSet",
  "AccountTickSizeSet",
  "PaymentMint",
  "PaymentBurn",
  "MPTokenIssuanceLock",
  "MPTokenIssuanceUnlock",
]);

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
      // The app hides tfFullyCanonicalSig and names only tfAllTransactions of a
      // SigningSessionSet; any other bit makes it ask for blind signing (`ledger-app/src/xrp/flags.c`,
      // `is_flag_hidden`, `has_unknown_flags`). This client names no other flag, so it predicts
      // blind for any other bit of any type.
      const flags = Number(raw) >>> 0;
      const canonical = defs.raw.TRANSACTION_FLAGS?.["universal"]?.["tfFullyCanonicalSig"] ?? 0;
      const all =
        type === "SigningSessionSet"
          ? (defs.raw.TRANSACTION_FLAGS?.["SigningSessionSet"]?.["tfAllTransactions"] ?? 0)
          : 0;
      if ((flags & ~canonical & ~all) !== 0) {
        kind = "blind";
        lines.push({ label: "Flags", value: String(raw) });
      } else if (all !== 0 && (flags & all) !== 0) {
        lines.push({ label: "Allows", value: "All transactions" });
      }
      continue;
    }
    if (field === "Permissions" && Array.isArray(raw)) {
      // More than a session holds is refused by the app; a value it cannot name goes blind.
      if (raw.length > kPermissionMaxSize) kind = "blind";
      raw.forEach((wrapped: unknown, i) => {
        const permission = (wrapped as { Permission?: { PermissionValue?: unknown } }).Permission;
        const name = permission?.PermissionValue;
        if (typeof name !== "string" || !kDevicePermissionNames.has(name)) kind = "blind";
        lines.push({ label: `Allows [${i + 1}]`, value: String(name) });
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
  if (type === "SigningSessionSet") {
    if (tx["SessionCap"] !== undefined)
      lines.push({ label: "Allows", value: kSessionCapScopeText });
    lines.push({ label: "Note", value: kSessionNoteText });
  }
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
