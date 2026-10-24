/**
 * Post-quantum migration (FIANSO-SPEC.md section 8.7). The order is not negotiable:
 * 1. `SetRegularKey` to the ML-DSA key's AccountID, **signed by the master key** (the ML-DSA key
 *    cannot sign before it is the regular key: `tefBAD_AUTH`);
 * 2. a proof transaction (an `AccountSet` that changes nothing) **signed by the ML-DSA key**; if it
 *    is not accepted, stop;
 * 3. `AccountSet` with `asfDisableMaster`, **signed by the master key** (only the master key can set
 *    it: `tecNEED_MASTER_KEY` otherwise).
 *
 * Step 3 is refused unless (a) step 2 was validated with `tesSUCCESS`, (b) the ML-DSA key is proven
 * recoverable or a post-quantum backup exists, and (c) the other authorities were reviewed. The
 * migration only runs on a network that accepted ML-DSA on a throwaway account (spike K3).
 */

import { addressFromPublicKey, keyTypeOf } from "../address.js";
import { bytesToHex, equalBytes } from "../bytes.js";
import { kDisableMasterFlagName } from "../constants.js";
import type { Definitions } from "../definitions.js";
import type { TxJson } from "../encode.js";
import { fetchCommonFields, submitAndWait, type FinalResult, type NodeClient } from "../node.js";
import { signTransaction, type BytesSigner } from "../sign.js";
import type { ExposureReport } from "./exposure.js";

export type MigrationStepKind = "set-regular-key" | "proof" | "disable-master";
export type MigrationSigner = "master" | "ml-dsa";

export interface MigrationStep {
  index: 1 | 2 | 3;
  kind: MigrationStepKind;
  signer: MigrationSigner;
  /** The transaction without `Sequence`, `Fee`, `LastLedgerSequence` (filled when it is signed). */
  tx: TxJson;
  description: string;
}

export interface MigrationPlan {
  account: string;
  mlDsaPublicKey: Uint8Array;
  /** The AccountID of the ML-DSA key: the new `RegularKey`. */
  mlDsaAddress: string;
  steps: readonly [MigrationStep, MigrationStep, MigrationStep];
}

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

/** Step 3 was refused before signing; `reasons` says which safety rule failed. */
export class MigrationRefusedError extends MigrationError {
  constructor(readonly reasons: readonly string[]) {
    super(`asfDisableMaster refused: ${reasons.join("; ")}`);
  }
}

/** The three unsigned steps, in the only accepted order. */
export function buildPqMigration(
  account: string,
  mlDsaPublicKey: Uint8Array,
  defs: Definitions,
): MigrationPlan {
  if (keyTypeOf(mlDsaPublicKey) !== "ml-dsa-44") {
    throw new MigrationError(
      "the new regular key must be an ML-DSA-44 public key (1 312 bytes, no prefix)",
    );
  }
  const mlDsaAddress = addressFromPublicKey(mlDsaPublicKey);
  if (mlDsaAddress === account)
    throw new MigrationError("the ML-DSA key is the account's own master key");
  return {
    account,
    mlDsaPublicKey,
    mlDsaAddress,
    steps: [
      {
        index: 1,
        kind: "set-regular-key",
        signer: "master",
        tx: { TransactionType: "SetRegularKey", Account: account, RegularKey: mlDsaAddress },
        description: "Set the ML-DSA key as the regular key (signed by the master key)",
      },
      {
        index: 2,
        kind: "proof",
        signer: "ml-dsa",
        tx: { TransactionType: "AccountSet", Account: account },
        description:
          "Prove the ML-DSA key signs for the account (an AccountSet that changes nothing)",
      },
      {
        index: 3,
        kind: "disable-master",
        signer: "master",
        tx: {
          TransactionType: "AccountSet",
          Account: account,
          SetFlag: defs.accountSetFlag(kDisableMasterFlagName),
        },
        description: "Disable the master key (signed by the master key)",
      },
    ],
  };
}

/** Evidence that the ML-DSA key can be recovered, or that a post-quantum backup exists. */
export type RecoverabilityEvidence =
  | {
      kind: "derived-twice";
      /** The public key derived at the first and the second time (after reinstalling the app). */
      first: Uint8Array;
      second: Uint8Array;
      afterReinstall: boolean;
      /** Where the derivation ran ("device", or "software" for a SIMULATED run). */
      source: "device" | "software";
    }
  | { kind: "pq-backup"; description: string };

/** A network accepted an ML-DSA regular key and a transaction it signed (spike K3). */
export interface MlDsaReadiness {
  networkId: number | undefined;
  /** The validated `tesSUCCESS` of an ML-DSA-signed transaction on a throwaway account. */
  probeHash: string;
}

export interface DisableMasterGuard {
  proofResult: FinalResult | undefined;
  recoverability: RecoverabilityEvidence | undefined;
  /** The exposure report of the account, reviewed by the user (rule 3 authorities). */
  reviewedReport: ExposureReport | undefined;
  /** The user confirmed the surviving authorities listed in `reviewedReport`. */
  authoritiesAcknowledged: boolean;
}

/** Why step 3 may not be signed yet (empty when it may). */
export function disableMasterRefusals(plan: MigrationPlan, guard: DisableMasterGuard): string[] {
  const reasons: string[] = [];
  const proof = guard.proofResult;
  if (!proof || !proof.validated || proof.result !== "tesSUCCESS") {
    reasons.push(
      "the proof transaction signed by the ML-DSA key was not validated with tesSUCCESS",
    );
  }
  const evidence = guard.recoverability;
  if (!evidence) {
    reasons.push("the ML-DSA key is not proven recoverable and no post-quantum backup is given");
  } else if (evidence.kind === "derived-twice") {
    if (
      !equalBytes(evidence.first, plan.mlDsaPublicKey) ||
      !equalBytes(evidence.second, plan.mlDsaPublicKey)
    ) {
      reasons.push("the key derived twice differs from the key of the plan");
    }
    if (!evidence.afterReinstall) {
      reasons.push("the second derivation was not made after reinstalling the app");
    }
  } else if (evidence.description.trim().length === 0) {
    reasons.push("the post-quantum backup is not described");
  }
  if (!guard.reviewedReport || guard.reviewedReport.address !== plan.account) {
    reasons.push("the account's exposure report (other authorities) was not reviewed");
  } else if (!guard.authoritiesAcknowledged) {
    reasons.push("the authorities that survive asfDisableMaster were not acknowledged");
  }
  return reasons;
}

export interface MigrationRunOptions {
  node: NodeClient;
  defs: Definitions;
  master: BytesSigner;
  mlDsa: BytesSigner;
  readiness: MlDsaReadiness;
  /** Given after step 2, so the caller can derive the key again or show the report first. */
  guard: (proof: FinalResult) => Promise<Omit<DisableMasterGuard, "proofResult">>;
  onStep?: (step: MigrationStep, result: FinalResult) => void;
}

export interface MigrationRun {
  results: FinalResult[];
  completed: boolean;
}

async function runStep(
  step: MigrationStep,
  signer: BytesSigner,
  options: MigrationRunOptions,
  account: string,
): Promise<FinalResult> {
  const common = await fetchCommonFields(options.node, account);
  const signed = await signTransaction({ ...step.tx, ...common }, signer, options.defs);
  const result = await submitAndWait(
    options.node,
    signed.blob,
    signed.hash,
    common.LastLedgerSequence,
  );
  options.onStep?.(step, result);
  return result;
}

/** Run the three steps in order, stopping at the first one that is not validated `tesSUCCESS`. */
export async function runPqMigration(
  plan: MigrationPlan,
  options: MigrationRunOptions,
): Promise<MigrationRun> {
  if (!options.readiness.probeHash) {
    throw new MigrationError(
      "no ML-DSA probe on this network: run the throwaway-account check first",
    );
  }
  if (addressFromPublicKey(options.master.publicKey) !== plan.account) {
    throw new MigrationError("the master signer is not the account's master key");
  }
  if (!equalBytes(options.mlDsa.publicKey, plan.mlDsaPublicKey)) {
    throw new MigrationError(
      `the ML-DSA signer is not the key of the plan (${bytesToHex(plan.mlDsaPublicKey).slice(0, 16)}…)`,
    );
  }
  const [setRegularKey, proof, disableMaster] = plan.steps;
  const results: FinalResult[] = [];

  const first = await runStep(setRegularKey, options.master, options, plan.account);
  results.push(first);
  if (!first.validated || first.result !== "tesSUCCESS") return { results, completed: false };

  const second = await runStep(proof, options.mlDsa, options, plan.account);
  results.push(second);
  if (!second.validated || second.result !== "tesSUCCESS") return { results, completed: false };

  const guard = { ...(await options.guard(second)), proofResult: second };
  const refusals = disableMasterRefusals(plan, guard);
  if (refusals.length > 0) throw new MigrationRefusedError(refusals);

  const third = await runStep(disableMaster, options.master, options, plan.account);
  results.push(third);
  return { results, completed: third.validated && third.result === "tesSUCCESS" };
}
