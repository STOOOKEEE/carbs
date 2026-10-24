/**
 * The only place that builds transaction JSON for the screens. Sequence, Fee,
 * LastLedgerSequence and the signature are added by the demo store. In M2 these builders
 * are replaced by those of packages/core (`buildSessionSet`, `buildSessionDelete`, ...),
 * which fill the same fields from `server_definitions`.
 */
import { ASF_DISABLE_MASTER, TF_ALL_TRANSACTIONS } from "./constants";
import type { SessionMode } from "./ports";

/** A transaction before the envelope (Sequence, Fee, LastLedgerSequence) and the signature. */
export interface UnsignedTx {
  TransactionType: string;
  Account: string;
  Fee?: string;
  Flags?: number;
  [field: string]: unknown;
}

export interface SessionParams {
  mode: SessionMode;
  durationSec: number;
  permissions: readonly string[];
  capDrops: number;
}

export function sessionSet(account: string, sessionKey: string, params: SessionParams): UnsignedTx {
  const tx: UnsignedTx = {
    TransactionType: "SigningSessionSet",
    Account: account,
    SessionKey: sessionKey,
    SessionDuration: params.durationSec,
  };
  if (params.mode === "A") tx.Flags = TF_ALL_TRANSACTIONS;
  if (params.mode === "P") tx.Permissions = [...params.permissions];
  if (params.mode === "C") tx.SessionCap = String(params.capDrops);
  return tx;
}

export function sessionDelete(account: string, sessionKey: string): UnsignedTx {
  return { TransactionType: "SigningSessionDelete", Account: account, SessionKey: sessionKey };
}

export function payment(account: string, destination: string, drops: number): UnsignedTx {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: String(drops),
  };
}

export function offerCreate(account: string, issuer: string): UnsignedTx {
  return {
    TransactionType: "OfferCreate",
    Account: account,
    TakerGets: "1000000",
    TakerPays: { currency: "USD", issuer, value: "1" },
  };
}

export function trustSet(account: string, issuer: string): UnsignedTx {
  return {
    TransactionType: "TrustSet",
    Account: account,
    LimitAmount: { currency: "USD", issuer, value: "100" },
  };
}

export function ticketCreate(account: string): UnsignedTx {
  return { TransactionType: "TicketCreate", Account: account, TicketCount: 1 };
}

export function nftMint(account: string): UnsignedTx {
  return { TransactionType: "NFTokenMint", Account: account, NFTokenTaxon: 0 };
}

export function checkCreate(account: string, destination: string): UnsignedTx {
  return {
    TransactionType: "CheckCreate",
    Account: account,
    Destination: destination,
    SendMax: "1000000",
  };
}

export function setRegularKey(account: string, regularKey: string | null): UnsignedTx {
  const tx: UnsignedTx = { TransactionType: "SetRegularKey", Account: account };
  if (regularKey !== null) tx.RegularKey = regularKey;
  return tx;
}

export function passkeyListSet(account: string, passkeys: readonly string[]): UnsignedTx {
  return { TransactionType: "PasskeyListSet", Account: account, Passkeys: [...passkeys] };
}

export function accountSetDisableMaster(account: string): UnsignedTx {
  return { TransactionType: "AccountSet", Account: account, SetFlag: ASF_DISABLE_MASTER };
}

/** A harmless `AccountSet` with no change: the proof transaction of the migration (spec 8.7). */
export function accountSetNoop(account: string): UnsignedTx {
  return { TransactionType: "AccountSet", Account: account };
}
