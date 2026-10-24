/**
 * `SigningSessionSet` and `SigningSessionDelete` (FIANSO-SPEC.md sections 6.2, 6.3, 8.2 and 8.3).
 *
 * The builders check what the node checks statelessly (preflight) so the UI can say it before
 * signing; the node stays the authority and its code is what the user sees. Every session
 * transaction carries `LastLedgerSequence`: the builders take it as a required field.
 */

import { decodeAccountID } from "ripple-address-codec";
import { accountIdBytes, isClassicAddress } from "./address.js";
import { bytesToHex, concatBytes } from "./bytes.js";
import {
  kAllTransactionsFlagName,
  kMaxSessionDuration,
  kPermissionMaxSize,
  kSessionMaxLedgerWindow,
} from "./constants.js";
import type { Definitions } from "./definitions.js";
import { sha512Half, type TxJson } from "./encode.js";
import { signTransaction, type BytesSigner, type SignedTx } from "./sign.js";

/** Exactly one of the three modes (section 6.2). */
export type SessionMode =
  | { kind: "all" }
  | { kind: "permissions"; permissions: readonly string[] }
  | { kind: "cap"; capDrops: bigint };

/** Fields every transaction the client builds carries (filled from the node, see `node.ts`). */
export interface TxCommonFields {
  Sequence: number;
  Fee: string;
  LastLedgerSequence: number;
  NetworkID?: number;
}

export interface SessionSetParams {
  account: string;
  /** The session key's address (`SessionKey`). */
  sessionKey: string;
  durationSec: number;
  mode: SessionMode;
  common: TxCommonFields;
}

export interface SessionDeleteParams {
  account: string;
  sessionKey: string;
  /** The owner, when the submitter is not the owner (only once the session has expired). */
  owner?: string;
  common: TxCommonFields;
}

/** A refusal the node would also give, with the code it would give. */
export class SessionParamsError extends Error {
  override readonly name = "SessionParamsError";
  constructor(
    readonly expectedCode: string,
    message: string,
  ) {
    super(`${message} (the node answers ${expectedCode})`);
  }
}

function commonFields(common: TxCommonFields): Record<string, unknown> {
  const out: Record<string, unknown> = {
    Sequence: common.Sequence,
    Fee: common.Fee,
    LastLedgerSequence: common.LastLedgerSequence,
  };
  if (common.NetworkID !== undefined) out["NetworkID"] = common.NetworkID;
  return out;
}

function checkAddress(address: string, what: string): void {
  if (!isClassicAddress(address))
    throw new SessionParamsError("temMALFORMED", `${what} is not an address`);
}

export function buildSessionSet(params: SessionSetParams, defs: Definitions): TxJson {
  const { account, sessionKey, durationSec, mode, common } = params;
  checkAddress(account, "Account");
  checkAddress(sessionKey, "SessionKey");
  if (sessionKey === account) {
    throw new SessionParamsError("temMALFORMED", "the session key is the account itself");
  }
  if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > kMaxSessionDuration) {
    throw new SessionParamsError(
      "temBAD_EXPIRATION",
      `the duration must be 1 to ${kMaxSessionDuration} seconds`,
    );
  }
  const tx: TxJson = {
    TransactionType: "SigningSessionSet",
    Account: account,
    SessionKey: sessionKey,
    SessionDuration: durationSec,
    ...commonFields(common),
  };
  switch (mode.kind) {
    case "all":
      tx["Flags"] = defs.transactionFlag("SigningSessionSet", kAllTransactionsFlagName);
      break;
    case "permissions": {
      if (mode.permissions.length === 0) {
        throw new SessionParamsError("temARRAY_EMPTY", "a mode-P session lists permissions");
      }
      if (mode.permissions.length > kPermissionMaxSize) {
        throw new SessionParamsError(
          "temARRAY_TOO_LARGE",
          `a session lists at most ${kPermissionMaxSize} permissions`,
        );
      }
      if (new Set(mode.permissions).size !== mode.permissions.length) {
        throw new SessionParamsError("temMALFORMED", "a permission is listed twice");
      }
      tx["Permissions"] = mode.permissions.map((value) => ({
        Permission: { PermissionValue: value },
      }));
      break;
    }
    case "cap":
      if (mode.capDrops <= 0n) {
        throw new SessionParamsError("temBAD_AMOUNT", "the cap must be a positive XRP amount");
      }
      tx["SessionCap"] = mode.capDrops.toString();
      break;
  }
  return tx;
}

export function buildSessionDelete(params: SessionDeleteParams): TxJson {
  const { account, sessionKey, owner, common } = params;
  checkAddress(account, "Account");
  checkAddress(sessionKey, "SessionKey");
  const tx: TxJson = {
    TransactionType: "SigningSessionDelete",
    Account: account,
    SessionKey: sessionKey,
    ...commonFields(common),
  };
  if (owner !== undefined) {
    checkAddress(owner, "Owner");
    if (owner === account) throw new SessionParamsError("temMALFORMED", "Owner equals Account");
    tx["Owner"] = owner;
  }
  return tx;
}

/** Keylet space of a signing session: `'z'` (section 6.1). */
const kSigningSessionSpace = Uint8Array.of(0x00, 0x7a);

/** The ledger index of the session of (`account`, `sessionKey`): `SHA512Half(0x007A ‖ Account ‖ SessionKey)`. */
export function signingSessionIndex(account: string, sessionKey: string): string {
  return bytesToHex(
    sha512Half(
      concatBytes(kSigningSessionSpace, decodeAccountID(account), decodeAccountID(sessionKey)),
    ),
  );
}

export class SessionSignError extends Error {
  override readonly name = "SessionSignError";
}

/**
 * Sign with a session key. Refuses a transaction without `LastLedgerSequence` (the node would answer
 * `tefSESSION_TX_NOT_ALLOWED`) or with `Signers`, `Delegate` or `Sponsor` (never session-signed,
 * section 6.4), and a session key used for its own account.
 */
export async function signWithSessionKey(
  tx: TxJson,
  sessionKey: BytesSigner,
  defs: Definitions,
  currentLedger?: number,
): Promise<SignedTx> {
  const lls = tx["LastLedgerSequence"];
  if (typeof lls !== "number") {
    throw new SessionSignError("a session transaction carries LastLedgerSequence");
  }
  if (currentLedger !== undefined && lls > currentLedger + kSessionMaxLedgerWindow) {
    throw new SessionSignError(
      `LastLedgerSequence is more than ${kSessionMaxLedgerWindow} ledgers ahead`,
    );
  }
  for (const field of ["Signers", "Delegate", "Sponsor", "SponsorSignature"]) {
    if (tx[field] !== undefined) {
      throw new SessionSignError(`a session-signed transaction has no ${field}`);
    }
  }
  if (
    bytesToHex(accountIdBytes(sessionKey.publicKey)) === bytesToHex(decodeAccountID(tx.Account))
  ) {
    throw new SessionSignError("a session key never signs as its own account");
  }
  return signTransaction(tx, sessionKey, defs);
}
