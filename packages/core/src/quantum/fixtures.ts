/**
 * Builders of node answers for the exposure tests. They produce the shapes the node returns
 * (`account_info`, `account_tx` with API v2 `tx_json`, `account_objects`); the recorded answers of
 * real accounts are in `fixtures/*.json`.
 */

import { kExposurePageSize } from "../constants.js";
import type { RecordedCall } from "../testing/recorded-node.js";

export interface FixtureTx {
  hash: string;
  ledgerIndex: number;
  tx: Record<string, unknown>;
  /** Adds a `CreatedNode` of the account root of `createsAccount`. */
  createsAccount?: string;
}

export function accountInfo(
  address: string,
  data: Record<string, unknown> | "notFound",
): RecordedCall {
  const params = { account: address, ledger_index: "validated" };
  if (data === "notFound") {
    return {
      method: "account_info",
      params,
      error: { error: "actNotFound", error_message: "Account not found." },
    };
  }
  return {
    method: "account_info",
    params,
    result: {
      account_data: {
        Account: address,
        Flags: 0,
        Sequence: 1,
        Balance: "1000000",
        OwnerCount: 0,
        ...data,
      },
    },
  };
}

/** One or more pages of `account_tx`, oldest first, `ledger_index_min` / `_max` as given. */
export function accountTx(
  address: string,
  txs: readonly FixtureTx[],
  range: { min: number; max: number },
  pageSize: number = kExposurePageSize,
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const pages = Math.max(1, Math.ceil(txs.length / pageSize));
  for (let page = 0; page < pages; page += 1) {
    const params: Record<string, unknown> = {
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      forward: true,
      limit: pageSize,
    };
    if (page > 0) params["marker"] = { page };
    const slice = txs.slice(page * pageSize, (page + 1) * pageSize);
    const result: Record<string, unknown> = {
      account: address,
      ledger_index_min: range.min,
      ledger_index_max: range.max,
      validated: true,
      transactions: slice.map((t) => ({
        hash: t.hash,
        ledger_index: t.ledgerIndex,
        validated: true,
        tx_json: t.tx,
        meta: {
          TransactionResult: "tesSUCCESS",
          AffectedNodes: t.createsAccount
            ? [
                {
                  CreatedNode: {
                    LedgerEntryType: "AccountRoot",
                    NewFields: { Account: t.createsAccount },
                  },
                },
              ]
            : [],
        },
      })),
    };
    if (page + 1 < pages) result["marker"] = { page: page + 1 };
    calls.push({ method: "account_tx", params, result });
  }
  return calls;
}

export function accountObjects(
  address: string,
  type: string,
  objects: readonly Record<string, unknown>[],
): RecordedCall {
  return {
    method: "account_objects",
    params: { account: address, ledger_index: "validated", type },
    result: { account: address, account_objects: objects },
  };
}

/** No passkey list, beneficiary, delegate or signer list. */
export function noAuthorities(address: string): RecordedCall[] {
  return ["passkey_list", "beneficiary", "delegate", "signer_list"].map((type) =>
    accountObjects(address, type, []),
  );
}

/** The payment that created `address`, sent by `funder`. */
export function funding(
  address: string,
  funder: string,
  ledgerIndex: number,
  hash: string,
  funderKey: string,
): FixtureTx {
  return {
    hash,
    ledgerIndex,
    createsAccount: address,
    tx: {
      TransactionType: "Payment",
      Account: funder,
      Destination: address,
      Amount: "100000000",
      SigningPubKey: funderKey,
    },
  };
}
