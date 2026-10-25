// Signing sessions (amendment SigningSessions, modes C, A and P): the transactions that
// open and close one, and the witness co-signature. Shared by the app and the demo script.

import type { XrplDefinitions } from "ripple-binary-codec";
import { encodeForSigning } from "ripple-binary-codec";
import { deriveKeypair, sign } from "ripple-keypairs";

import { textMemos } from "./hex.ts";
import type { TxJson } from "./ledger.ts";

const DROPS_PER_XRP = 1_000_000;
/** XRPL single-signing prefix STX\0, as hex. */
const TX_SIGN_PREFIX = "53545800";
/** The witness signs the same fields under its own prefix WTS\0 (HashPrefix::WitnessTxSign). */
const WITNESS_SIGN_PREFIX = "57545300";

/** Flag tfAllTransactions of SigningSessionSet (mode A), mirrored as lsfAllTransactions on the entry. */
export const TF_ALL_TRANSACTIONS = 0x00010000;

/** Mode C: a spending cap. */
export interface CapRules {
  mode: "cap";
  /** Total the session may spend, fees included, in XRP. */
  capXrp: number;
  /** Largest single payment, in XRP. */
  maxPerTxXrp?: number;
}

/** Mode A: every delegable transaction type, no cap. */
export interface AllTransactionsRules {
  mode: "all";
}

/** Mode P: an explicit list of permissions (PermissionValue = transaction type + 1, or granular). */
export interface PermissionRules {
  mode: "permissions";
  permissions: number[];
}

export type SessionMode = (CapRules | AllTransactionsRules | PermissionRules)["mode"];

export type SessionRules = (CapRules | AllTransactionsRules | PermissionRules) & {
  /** Seconds, 1 to 600. */
  durationSeconds: number;
  /** Account that must co-sign every session transaction. */
  witness?: string;
  /** Most session-signed transactions the ledger accepts (SessionMaxTxCount); the own close is free. */
  maxTxCount?: number;
  /** Device profile the Stax applies to this opening (Memo carbs-profile, shown on the device). */
  profile?: SessionProfile;
};

/** The Stax session profiles (ledger-app/src/policy, docs/device-contract.md). */
export const SESSION_PROFILES = ["agent", "game", "trading", "streaming", "minting"] as const;
export type SessionProfile = (typeof SESSION_PROFILES)[number];
const PROFILE_MEMO_TYPE = "carbs-profile";

function drops(xrp: number): string {
  return String(Math.round(xrp * DROPS_PER_XRP));
}

/** The fields that select the session's mode: exactly one of SessionCap, tfAllTransactions, Permissions. */
function modeFields(rules: SessionRules): TxJson {
  switch (rules.mode) {
    case "cap":
      return {
        SessionCap: drops(rules.capXrp),
        ...(rules.maxPerTxXrp === undefined ? {} : { SessionMaxPerTx: drops(rules.maxPerTxXrp) }),
      };
    case "all":
      return { Flags: TF_ALL_TRANSACTIONS };
    case "permissions":
      return {
        Permissions: rules.permissions.map((value) => ({
          Permission: { PermissionValue: value },
        })),
      };
  }
}

export function openSessionTx(owner: string, sessionKey: string, rules: SessionRules): TxJson {
  return {
    TransactionType: "SigningSessionSet",
    Account: owner,
    SessionKey: sessionKey,
    SessionDuration: rules.durationSeconds,
    ...modeFields(rules),
    ...(rules.witness === undefined ? {} : { SessionWitness: rules.witness }),
    ...(rules.maxTxCount === undefined ? {} : { SessionMaxTxCount: rules.maxTxCount }),
    ...(rules.profile === undefined ? {} : { Memos: textMemos(PROFILE_MEMO_TYPE, rules.profile) }),
  };
}

/** Closed by the session key itself (no Owner), or by a third party once expired (Owner set). */
export function closeSessionTx(account: string, sessionKey: string, owner?: string): TxJson {
  return {
    TransactionType: "SigningSessionDelete",
    Account: account,
    SessionKey: sessionKey,
    ...(owner === undefined ? {} : { Owner: owner }),
  };
}

export function paymentTx(account: string, destination: string, amountXrp: number): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: drops(amountXrp),
  };
}

/**
 * Adds the witness co-signature to a transaction already signed by the session key:
 * the same signing fields (SigningPubKey of the session key included) under WTS\0.
 */
export function witnessSign(defs: XrplDefinitions, signedTx: TxJson, witnessSeed: string): TxJson {
  const keys = deriveKeypair(witnessSeed);
  const { TxnSignature: _txnSignature, ...signingFields } = signedTx;
  const signingData = encodeForSigning(signingFields, defs);
  if (!signingData.startsWith(TX_SIGN_PREFIX)) throw new Error("unexpected signing prefix");
  const witnessData = WITNESS_SIGN_PREFIX + signingData.slice(TX_SIGN_PREFIX.length);
  return {
    ...signedTx,
    WitnessSignature: {
      SigningPubKey: keys.publicKey,
      TxnSignature: sign(witnessData, keys.privateKey),
    },
  };
}
