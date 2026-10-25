/**
 * The passkey wallet: an account that signs with its passkey only (not in FIANSO-SPEC.md section
 * 8.5; recorded as a deviation in `docs/DEVLOG.md`). Order, every step outside any session:
 * 1. `PasskeyListSet`, signed by the master key (the list cannot be replaced later: P6, so it holds
 *    every passkey of the account);
 * 2. a proof `AccountSet` (no change) signed by a passkey through WebAuthn; if it is not accepted,
 *    stop (on a node without `fixPasskeyChallenge` it may not be: P5);
 * 3. `SetRegularKey` to the blackhole address, signed by the master key: `asfDisableMaster` needs
 *    an alternative key, and the passkey list does not count as one
 *    (`rippled/src/libxrpl/tx/transactors/account/AccountSet.cpp:315-318`, `tecNO_ALTERNATIVE_KEY`);
 *    the blackhole is accepted, since only the account itself is refused
 *    (`rippled/src/libxrpl/tx/transactors/account/SetRegularKey.cpp:43-48`);
 * 4. `AccountSet asfDisableMaster`, signed by the master key.
 * Afterwards a passkey keeps full authority (`rippled/src/libxrpl/tx/Transactor.cpp:1141-1158`) and
 * signs everything, session openings included. Step 4 is refused unless step 2 was validated.
 *
 * Not post-quantum with a P-256 passkey, whose key is on the ledger (FIANSO-SPEC.md section 12).
 * With an ML-DSA-44 passkey (amendment `PasskeyMLDSA`, `keys/pq-passkey.ts`) the same four steps
 * leave an account whose only authority is post-quantum.
 */

import { kBlackholeAddress, kDisableMasterFlagName } from "./constants.js";
import type { Definitions } from "./definitions.js";
import type { TxJson } from "./encode.js";
import {
  buildPasskeyListSet,
  signWithPasskey,
  type Authenticator,
  type PasskeyCredential,
} from "./keys/passkey.js";
import {
  fetchCommonFields,
  submitSignedAndWait,
  type FinalResult,
  type NodeClient,
} from "./node.js";
import { signTransaction, type BytesSigner, type SignedTx } from "./sign.js";

export type PasskeyWalletStepKind =
  "passkey-list" | "passkey-proof" | "blackhole-regular-key" | "disable-master";

export interface PasskeyWalletStep {
  index: 1 | 2 | 3 | 4;
  kind: PasskeyWalletStepKind;
  signer: "master" | "passkey";
  tx: TxJson;
  description: string;
}

export interface PasskeyWalletPlan {
  account: string;
  passkeys: readonly PasskeyCredential[];
  steps: readonly [PasskeyWalletStep, PasskeyWalletStep, PasskeyWalletStep, PasskeyWalletStep];
}

export class PasskeyWalletError extends Error {
  override readonly name = "PasskeyWalletError";
}

export function buildPasskeyWallet(
  account: string,
  passkeys: readonly PasskeyCredential[],
  defs: Definitions,
): PasskeyWalletPlan {
  return {
    account,
    passkeys,
    steps: [
      {
        index: 1,
        kind: "passkey-list",
        signer: "master",
        tx: buildPasskeyListSet(account, passkeys),
        description: "Register every passkey of the account (the list cannot be replaced later)",
      },
      {
        index: 2,
        kind: "passkey-proof",
        signer: "passkey",
        tx: { TransactionType: "AccountSet", Account: account },
        description: "Prove a passkey signs for the account (an AccountSet that changes nothing)",
      },
      {
        index: 3,
        kind: "blackhole-regular-key",
        signer: "master",
        tx: { TransactionType: "SetRegularKey", Account: account, RegularKey: kBlackholeAddress },
        description:
          "Set the blackhole address as the regular key, so the master key can be disabled",
      },
      {
        index: 4,
        kind: "disable-master",
        signer: "master",
        tx: {
          TransactionType: "AccountSet",
          Account: account,
          SetFlag: defs.accountSetFlag(kDisableMasterFlagName),
        },
        description: "Disable the master key: from now on only the passkeys sign",
      },
    ],
  };
}

/** A passkey that signs: its credential, the authenticator holding it, the relying party id. */
export interface PasskeySigner {
  credential: PasskeyCredential;
  authenticator: Authenticator;
  rpId: string;
}

export interface PasskeyWalletRunOptions {
  node: NodeClient;
  defs: Definitions;
  master: BytesSigner;
  passkey: PasskeySigner;
  onStep?: (step: PasskeyWalletStep, result: FinalResult) => void;
}

export interface PasskeyWalletRun {
  results: FinalResult[];
  completed: boolean;
}

/** Sign `tx` (with its common fields) with a passkey and submit it. */
export async function submitWithPasskey(
  tx: TxJson,
  passkey: PasskeySigner,
  node: NodeClient,
  defs: Definitions,
): Promise<{ signed: SignedTx; result: FinalResult }> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signWithPasskey(
    { ...tx, ...common },
    passkey.credential,
    passkey.authenticator,
    passkey.rpId,
    defs,
  );
  return {
    signed,
    result: await submitSignedAndWait(node, signed, common.LastLedgerSequence),
  };
}

async function submitWithKey(
  tx: TxJson,
  signer: BytesSigner,
  node: NodeClient,
  defs: Definitions,
): Promise<FinalResult> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signTransaction({ ...tx, ...common }, signer, defs);
  return submitSignedAndWait(node, signed, common.LastLedgerSequence);
}

const accepted = (r: FinalResult) => r.validated && r.result === "tesSUCCESS";

/** Run the four steps in order; stop at the first that is not validated `tesSUCCESS`. */
export async function runPasskeyWallet(
  plan: PasskeyWalletPlan,
  options: PasskeyWalletRunOptions,
): Promise<PasskeyWalletRun> {
  if (
    !plan.passkeys.some((p) =>
      p.publicKey.every((b, i) => b === options.passkey.credential.publicKey[i]),
    )
  ) {
    throw new PasskeyWalletError("the signing passkey is not in the plan's passkey list");
  }
  const results: FinalResult[] = [];
  for (const step of plan.steps) {
    if (
      step.kind === "disable-master" &&
      !results.some((r, i) => plan.steps[i]?.kind === "passkey-proof" && accepted(r))
    ) {
      throw new PasskeyWalletError(
        "asfDisableMaster refused: no passkey-signed transaction was validated",
      );
    }
    const result =
      step.signer === "passkey"
        ? (await submitWithPasskey(step.tx, options.passkey, options.node, options.defs)).result
        : await submitWithKey(step.tx, options.master, options.node, options.defs);
    results.push(result);
    options.onStep?.(step, result);
    if (!accepted(result)) return { results, completed: false };
  }
  return { results, completed: true };
}
