// Signing sessions (amendment SigningSessions, mode C): the transactions that open
// and close one, and the witness co-signature. Shared by the app and the demo script.

import type { XrplDefinitions } from "ripple-binary-codec";
import { encodeForSigning } from "ripple-binary-codec";
import { deriveKeypair, sign } from "ripple-keypairs";

import type { TxJson } from "./ledger.ts";

const DROPS_PER_XRP = 1_000_000;
/** XRPL single-signing prefix STX\0, as hex. */
const TX_SIGN_PREFIX = "53545800";
/** The witness signs the same fields under its own prefix WTS\0 (HashPrefix::WitnessTxSign). */
const WITNESS_SIGN_PREFIX = "57545300";

export interface SessionRules {
  /** Seconds, 1 to 600. */
  durationSeconds: number;
  /** Total the session may spend, fees included, in XRP. */
  capXrp: number;
  /** Largest single payment, in XRP. */
  maxPerTxXrp?: number;
  /** Account that must co-sign every session transaction. */
  witness?: string;
}

function drops(xrp: number): string {
  return String(Math.round(xrp * DROPS_PER_XRP));
}

export function openSessionTx(owner: string, sessionKey: string, rules: SessionRules): TxJson {
  return {
    TransactionType: "SigningSessionSet",
    Account: owner,
    SessionKey: sessionKey,
    SessionDuration: rules.durationSeconds,
    SessionCap: drops(rules.capXrp),
    ...(rules.maxPerTxXrp === undefined ? {} : { SessionMaxPerTx: drops(rules.maxPerTxXrp) }),
    ...(rules.witness === undefined ? {} : { SessionWitness: rules.witness }),
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
