// The post-quantum migration of the Stax account, step by step (same order and guard as
// buildPqMigration / disableMasterRefusals of packages/core/src/quantum/migration.ts, whose
// types are tied to that package's own node client and definitions):
// 1. SetRegularKey to the ML-DSA-44 key's address, signed by the classical master key;
// 2. a proof (an AccountSet that changes nothing) signed by the ML-DSA-44 key: stop unless
//    tesSUCCESS;
// 3. AccountSet asfDisableMaster, signed by the master key, only once the proof is in the
//    account's validated history and the ML-DSA-44 key read again from the device (after
//    reinstalling the app) has the ledger's RegularKey as address. Everything is read from the
//    ledger, so a page reload between the steps loses nothing.
// Pure module: the migration panel reads the ledger, signs and submits.

import { ASF_DISABLE_MASTER } from "./account.ts";
import { textMemos } from "./hex.ts";
import type { SubmittedTx, TxJson } from "./ledger.ts";

/** MemoType of every migration transaction: the Stax shows which step it signs. */
const MIGRATION_MEMO_TYPE = "carbs-migration";

/**
 * The Memo Data of each step, short ASCII. Step 2 is signed in ML-DSA-44, whose signing data
 * must stay under 2048 bytes (kPqMaxMessage): STX\0 4 + TransactionType 3 + Sequence 5 +
 * LastLedgerSequence 6 + Fee 9 + SigningPubKey 1315 (1312-byte key) + Account 22 + this Memos
 * array 81 (type 15 + data 58 + 8 bytes of headers) = 1445 bytes (measured with encodeForSigning).
 */
export const MIGRATION_MEMOS = {
  regularKey: "carbs PQ migration 1/3: ML-DSA-44 key becomes RegularKey",
  proof: "carbs PQ migration 2/3: proof signed by the ML-DSA-44 root",
  disableMaster: "carbs PQ migration 3/3: disable the classical master key",
} as const;

/** One line logged before each step: what the Stax will show, and why. */
export const MIGRATION_PREVIEWS = {
  regularKey:
    "Step 1: the Stax shows SetRegularKey to the address of its ML-DSA-44 key and the memo '1/3', signed with the classical key (only the master key can designate the new key).",
  proof:
    "Step 2: the Stax shows an AccountSet that changes nothing, memo '2/3', signed by the ML-DSA-44 root: the ledger proves it does sign for the account.",
  disableMaster:
    "Step 3: the Stax shows AccountSet Set Flag 4 (asfDisableMaster), memo '3/3', signed with the classical key: after it, only the ML-DSA-44 key signs.",
} as const;

export function regularKeyTx(account: string, mlDsaAddress: string): TxJson {
  return {
    TransactionType: "SetRegularKey",
    Account: account,
    RegularKey: mlDsaAddress,
    Memos: textMemos(MIGRATION_MEMO_TYPE, MIGRATION_MEMOS.regularKey),
  };
}

export function proofTx(account: string): TxJson {
  return {
    TransactionType: "AccountSet",
    Account: account,
    Memos: textMemos(MIGRATION_MEMO_TYPE, MIGRATION_MEMOS.proof),
  };
}

export function disableMasterTx(account: string): TxJson {
  return {
    TransactionType: "AccountSet",
    Account: account,
    SetFlag: ASF_DISABLE_MASTER,
    Memos: textMemos(MIGRATION_MEMO_TYPE, MIGRATION_MEMOS.disableMaster),
  };
}

/** What the page knows before step 3: the ledger's state, and the key read again on the Stax. */
export interface DisableMasterGuard {
  /** The account's RegularKey on the ledger, and the Stax's ML-DSA-44 address. */
  regularKey: string | undefined;
  mlDsaAddress: string;
  /** Hash of the proof found in the account's validated history (findProof). */
  proofHash: string | undefined;
  /** The ML-DSA-44 key read when this page signed step 1 or 2, if it did. */
  firstRead: string | undefined;
  /** The ML-DSA-44 key read again on the Stax (public key hex, and its address). */
  secondRead: { publicKey: string; address: string } | undefined;
  /** "I checked the ML-DSA key after reinstalling the app" is ticked. */
  keyChecked: boolean;
}

/** Why step 3 may not be signed yet (empty when it may). */
export function disableMasterRefusals(guard: DisableMasterGuard): string[] {
  const reasons: string[] = [];
  if (guard.regularKey !== guard.mlDsaAddress)
    reasons.push("the regular key is not the ML-DSA-44 key (step 1)");
  if (guard.proofHash === undefined)
    reasons.push("no tesSUCCESS ML-DSA-44 proof found on the ledger (step 2)");
  if (guard.secondRead === undefined) reasons.push("ML-DSA-44 key not read again on the Stax yet");
  else if (guard.secondRead.address !== guard.regularKey)
    reasons.push(
      "the key read again does not match the ledger's regular key: do not disable the master key",
    );
  else if (
    guard.firstRead !== undefined &&
    guard.firstRead.toUpperCase() !== guard.secondRead.publicKey.toUpperCase()
  )
    reasons.push("the key read again differs from the first read: do not disable the master key");
  if (!guard.keyChecked) reasons.push("check box not ticked");
  return reasons;
}

/** What findProof reads of one account_tx entry. */
export interface HistoryEntry {
  hash: string | undefined;
  transactionType: unknown;
  account: unknown;
  signingPubKey: unknown;
  regularKey: unknown;
  result: unknown;
}

/**
 * The proof in the account's history (newest first): a tesSUCCESS AccountSet of the account
 * signed by the ML-DSA-44 key, newer than the latest tesSUCCESS SetRegularKey to that key.
 * Returns its hash; `done` is true once that SetRegularKey was met (no need to read further).
 */
export function findProof(
  entries: readonly HistoryEntry[],
  account: string,
  mlDsaPublicKey: string,
  mlDsaAddress: string,
): { hash: string | undefined; done: boolean } {
  for (const entry of entries) {
    if (entry.account !== account || entry.result !== "tesSUCCESS") continue;
    if (entry.transactionType === "SetRegularKey" && entry.regularKey === mlDsaAddress)
      return { hash: undefined, done: true };
    if (
      entry.transactionType === "AccountSet" &&
      typeof entry.signingPubKey === "string" &&
      entry.signingPubKey.toUpperCase() === mlDsaPublicKey.toUpperCase()
    )
      return { hash: entry.hash, done: true };
  }
  return { hash: undefined, done: false };
}
