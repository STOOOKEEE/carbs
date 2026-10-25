/**
 * `SigningSessionSet` and `SigningSessionDelete` (FIANSO-SPEC.md sections 6.2, 6.3, 8.2 and 8.3).
 *
 * The builders check what the node checks statelessly (preflight) so the UI can say it before
 * signing; the node stays the authority and its code is what the user sees. Every session
 * transaction carries `LastLedgerSequence`: the builders take it as a required field.
 *
 * Two carbs protections sit on top of the spec: a per-transaction bound of a mode-C session
 * (`SessionMaxPerTx`) and a witness that co-signs every session transaction (`SessionWitness`,
 * `WitnessSignature` signed under `WTS\0`).
 */

import { decodeAccountID } from "ripple-address-codec";
import { accountIdBytes, isClassicAddress } from "./address.js";
import { bytesToHex, concatBytes, hexToBytes } from "./bytes.js";
import {
  kAllTransactionsFlagName,
  kMaxSessionDuration,
  kPermissionMaxSize,
  kSessionMaxLedgerWindow,
  kSessionMaxPerTxField,
  kSessionWitnessField,
  kTxSignPrefix,
  kWitnessSignatureField,
  kWitnessSignPrefix,
} from "./constants.js";
import { DefinitionsError, type Definitions } from "./definitions.js";
import { encodeForSigning, encodeTx, sha512Half, transactionHash, type TxJson } from "./encode.js";
import { signTransaction, type BytesSigner, type SignedTx } from "./sign.js";

/** Exactly one of the three modes (section 6.2); mode C may bound each transaction's amount. */
export type SessionMode =
  | { kind: "all" }
  | { kind: "permissions"; permissions: readonly string[] }
  | { kind: "cap"; capDrops: bigint; maxPerTxDrops?: bigint };

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
  /** An account that must co-sign every transaction of the session (`SessionWitness`). */
  witness?: string;
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

/** The protections are optional on the node: refuse to build one it does not serve. */
function requireField(defs: Definitions, name: string): void {
  if (!defs.hasField(name)) {
    throw new DefinitionsError(`server_definitions: the node does not serve the field ${name}`);
  }
}

export function buildSessionSet(params: SessionSetParams, defs: Definitions): TxJson {
  const { account, sessionKey, durationSec, mode, witness, common } = params;
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
      if (mode.maxPerTxDrops !== undefined) {
        if (mode.maxPerTxDrops <= 0n || mode.maxPerTxDrops > mode.capDrops) {
          throw new SessionParamsError(
            "temBAD_AMOUNT",
            "the per-transaction bound must be a positive XRP amount at most the cap",
          );
        }
        requireField(defs, kSessionMaxPerTxField);
        tx[kSessionMaxPerTxField] = mode.maxPerTxDrops.toString();
      }
      break;
  }
  if (witness !== undefined) {
    checkAddress(witness, kSessionWitnessField);
    if (witness === account || witness === sessionKey) {
      throw new SessionParamsError("temMALFORMED", "the witness is the account or the session key");
    }
    requireField(defs, kSessionWitnessField);
    tx[kSessionWitnessField] = witness;
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
 * Sign with a session key. Refuses a transaction without `LastLedgerSequence`, or with one more than
 * `kSessionMaxLedgerWindow` ledgers after `currentLedger` (the node answers
 * `tefSESSION_TX_NOT_ALLOWED` to both), so the current ledger is required; refuses `Signers`,
 * `Delegate` or `Sponsor` (never session-signed, section 6.4), and a session key used for its own
 * account.
 */
export async function signWithSessionKey(
  tx: TxJson,
  sessionKey: BytesSigner,
  defs: Definitions,
  currentLedger: number,
): Promise<SignedTx> {
  if (!Number.isSafeInteger(currentLedger) || currentLedger < 0) {
    throw new SessionSignError(
      "the current ledger is required to check the LastLedgerSequence window",
    );
  }
  const lls = tx["LastLedgerSequence"];
  if (typeof lls !== "number") {
    throw new SessionSignError("a session transaction carries LastLedgerSequence");
  }
  if (lls > currentLedger + kSessionMaxLedgerWindow) {
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

/**
 * What a session's witness signs: `WTS\0 ‖ signing fields`, the same fields as the session key's
 * signature (its `SigningPubKey` included; `TxnSignature` and `WitnessSignature` are not signing
 * fields) under the witness prefix.
 */
export function witnessSigningData(tx: TxJson, defs: Definitions): Uint8Array {
  return concatBytes(kWitnessSignPrefix, encodeForSigning(tx, defs).subarray(kTxSignPrefix.length));
}

/**
 * Add the witness's co-signature to a transaction the session key has signed. The witness signs
 * with a single key (the node refuses an empty `SigningPubKey`), the account's master or regular
 * key; the node checks which key it is (`tefSESSION_NO_WITNESS`).
 */
export async function signAsWitness(
  sessionSigned: TxJson,
  witness: BytesSigner,
  defs: Definitions,
): Promise<SignedTx> {
  const sessionPubKey = sessionSigned["SigningPubKey"];
  if (typeof sessionPubKey !== "string" || sessionPubKey.length === 0) {
    throw new SessionSignError("the witness co-signs a transaction the session key has signed");
  }
  if (typeof sessionSigned["TxnSignature"] !== "string") {
    throw new SessionSignError("the witness co-signs after the session key's signature");
  }
  if (bytesToHex(witness.publicKey) === bytesToHex(hexToBytes(sessionPubKey))) {
    throw new SessionSignError("the session key is not its own witness");
  }
  requireField(defs, kWitnessSignatureField);
  const signature = await witness.sign(witnessSigningData(sessionSigned, defs));
  const signed: TxJson = {
    ...sessionSigned,
    [kWitnessSignatureField]: {
      SigningPubKey: bytesToHex(witness.publicKey),
      TxnSignature: bytesToHex(signature),
    },
  };
  const blob = encodeTx(signed, defs);
  return { tx: signed, blob, hash: transactionHash(blob) };
}
