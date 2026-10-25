/**
 * XRPL `Batch` (amendment `BatchV1_1`): one outer transaction, signed once, carrying 2 to 8 inner
 * transactions (`rippled/src/libxrpl/tx/transactors/system/Batch.cpp`). This builder covers the
 * owner's own Batch: every inner transaction is of the outer account, so no `BatchSigners`.
 *
 * Read the inner results, not the outer code. The outer answers `tesSUCCESS` as soon as it is
 * valid; the inner transactions are applied after it (`applyBatchTransactions`,
 * `rippled/src/libxrpl/tx/apply.cpp`), and in all-or-nothing one inner result other than
 * `tesSUCCESS` discards them all while the outer keeps its fee and its sequence. An inner
 * transaction carries no signature, so what needs the master key's own signature
 * (`AccountSet asfDisableMaster`) fails inside a Batch with `tecNEED_MASTER_KEY`.
 */

import { isClassicAddress } from "./address.js";
import type { Definitions } from "./definitions.js";
import type { TxJson } from "./encode.js";
import type { TxCommonFields } from "./session.js";

/** How the node applies the inner transactions (one flag of the outer `Batch`). */
export type BatchMode = "all-or-nothing" | "only-one" | "until-failure" | "independent";

/** Fewest inner transactions the node accepts (`Batch::preflight`). */
export const kMinBatchTxCount = 2;
/** Most inner transactions the node accepts (`kMaxBatchTxCount`, `Protocol.h`). */
export const kMaxBatchTxCount = 8;

const kBatchTransactionType = "Batch";
/** Flag table of the flags every transaction may carry, as `server_definitions` names it. */
const kUniversalFlags = "universal";
const kInnerBatchFlagName = "tfInnerBatchTxn";
/** Largest value of the `Flags` field (UInt32). */
const kMaxFlags = 0xffff_ffff;

const kBatchModeFlagNames: Readonly<Record<BatchMode, string>> = {
  "all-or-nothing": "tfAllOrNothing",
  "only-one": "tfOnlyOne",
  "until-failure": "tfUntilFailure",
  independent: "tfIndependent",
};

export interface BatchParams {
  account: string;
  /** The inner transactions, in order, without sequence, fee or signature. */
  inner: readonly TxJson[];
  mode: BatchMode;
  /**
   * The outer's fields. Inner transaction `i` gets `Sequence + 1 + i`, and `NetworkID` when set
   * (the node checks it on each inner transaction too).
   */
  common: TxCommonFields;
}

/** A refusal the node would also give, with the code it would give. */
export class BatchParamsError extends Error {
  override readonly name = "BatchParamsError";
  constructor(
    readonly expectedCode: string,
    message: string,
  ) {
    super(`${message} (the node answers ${expectedCode})`);
  }
}

function innerFlags(tx: TxJson, innerFlag: number, index: number): number {
  const flags = tx["Flags"] ?? 0;
  if (typeof flags !== "number" || !Number.isInteger(flags) || flags < 0 || flags > kMaxFlags) {
    throw new BatchParamsError("temINVALID_FLAG", `inner transaction ${index} has invalid Flags`);
  }
  // `>>> 0`: a bitwise OR with tfFullyCanonicalSig is negative in JavaScript.
  return (flags | innerFlag) >>> 0;
}

function checkInner(tx: TxJson, account: string, index: number): void {
  if (tx.TransactionType === kBatchTransactionType) {
    throw new BatchParamsError("temMALFORMED", `inner transaction ${index} is a Batch`);
  }
  if (tx.Account !== account) {
    throw new BatchParamsError(
      "temBAD_SIGNER",
      `inner transaction ${index} is of another account, which must sign as a BatchSigner`,
    );
  }
  if (tx["TxnSignature"] !== undefined) {
    throw new BatchParamsError("temBAD_SIGNATURE", `inner transaction ${index} is signed`);
  }
  if (tx["Signers"] !== undefined) {
    throw new BatchParamsError("temBAD_SIGNER", `inner transaction ${index} is multi-signed`);
  }
  if (tx["TicketSequence"] !== undefined) {
    throw new BatchParamsError(
      "temSEQ_AND_TICKET",
      `inner transaction ${index} uses a ticket; this builder assigns sequences`,
    );
  }
}

/**
 * The outer `Batch` of `account`. Each inner transaction gets `tfInnerBatchTxn`, `Fee` `"0"`, an
 * empty `SigningPubKey` and the next sequence after the outer one. The outer `Fee` is the caller's
 * (see `batchBaseFee`).
 */
export function buildBatch(params: BatchParams, defs: Definitions): TxJson {
  const { account, inner, mode, common } = params;
  if (!isClassicAddress(account)) {
    throw new BatchParamsError("temMALFORMED", "Account is not an address");
  }
  if (inner.length < kMinBatchTxCount) {
    throw new BatchParamsError(
      "temARRAY_EMPTY",
      `a Batch carries at least ${kMinBatchTxCount} inner transactions`,
    );
  }
  if (inner.length > kMaxBatchTxCount) {
    throw new BatchParamsError(
      "temMALFORMED",
      `a Batch carries at most ${kMaxBatchTxCount} inner transactions`,
    );
  }

  const innerFlag = defs.transactionFlag(kUniversalFlags, kInnerBatchFlagName);
  const rawTransactions = inner.map((tx, index) => {
    checkInner(tx, account, index);
    const raw: TxJson = {
      ...tx,
      Flags: innerFlags(tx, innerFlag, index),
      Sequence: common.Sequence + 1 + index,
      Fee: "0",
      SigningPubKey: "",
    };
    if (common.NetworkID !== undefined) raw["NetworkID"] = common.NetworkID;
    return { RawTransaction: raw };
  });

  return {
    TransactionType: kBatchTransactionType,
    Account: account,
    Flags: defs.transactionFlag(kBatchTransactionType, kBatchModeFlagNames[mode]),
    RawTransactions: rawTransactions,
    ...common,
  };
}

export interface BatchFeeParams {
  /** The node's base fee, in drops (`fees().base`). */
  baseFeeDrops: bigint;
  /**
   * The base fee of each inner transaction, in drops: the base fee for most types, one owner
   * reserve for `AccountDelete` and `AMMCreate`.
   */
  innerBaseFeesDrops: readonly bigint[];
  /**
   * Signatures in `BatchSigners`: one per single-signed BatchSigner, one per signer of a
   * multi-signed one (default 0).
   */
  batchSignerSignatures?: number;
  /** Signers of the outer transaction when it is multi-signed (default 0). */
  outerSigners?: number;
}

function nonNegativeCount(value: number, what: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer`);
  }
  return BigInt(value);
}

/**
 * The base fee of a Batch, in drops, as `Batch::calculateBaseFee` computes it: one base fee for
 * the batch, the outer's own base fee (base, plus base per outer multi-signer), the sum of the
 * inner base fees, and one base fee per BatchSigner signature. Not scaled for load.
 */
export function batchBaseFee(params: BatchFeeParams): bigint {
  const { baseFeeDrops, innerBaseFeesDrops } = params;
  if (baseFeeDrops < 0n) throw new RangeError("the base fee must not be negative");
  const signatures = nonNegativeCount(params.batchSignerSignatures ?? 0, "batchSignerSignatures");
  const outerSigners = nonNegativeCount(params.outerSigners ?? 0, "outerSigners");

  let innerFees = 0n;
  for (const fee of innerBaseFeesDrops) {
    if (fee < 0n) throw new RangeError("an inner base fee must not be negative");
    innerFees += fee;
  }
  const outerOwnFee = baseFeeDrops + outerSigners * baseFeeDrops;
  return baseFeeDrops + outerOwnFee + innerFees + signatures * baseFeeDrops;
}
