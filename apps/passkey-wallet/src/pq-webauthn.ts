// Post-quantum WebAuthn passkeys (amendment PasskeyMLDSA, PR #113): the flow shared by the
// "Passkey post-quantique (Ledger Stax)" section and scripts/pq-passkey-demo.ts. Register an
// ML-DSA-44 passkey (PasskeyListSet signed by the master key), pay with it, open and close a
// signing session with it, and lock the account to it. Every step returns the node's own answer.
// Library only (@carbs/sessions): the codes and fields come from the node's server_definitions.

import {
  type BytesSigner,
  type Definitions,
  type FinalResult,
  type NodeClient,
  type PasskeySigner,
  type SessionKey,
  type TxJson,
  buildPasskeyListSet,
  buildSessionDelete,
  buildSessionSet,
  fetchCommonFields,
  getNetworkState,
  kBlackholeAddress,
  kDisableMasterFlagName,
  signTransaction,
  signWithSessionKey,
  submitSignedAndWait,
  submitWithPasskey,
} from "@carbs/sessions";

/** One transaction of the flow and what the node answered. */
export interface PqStep {
  /** The transaction type (and its variant). */
  label: string;
  /** Who signed: the classical master key, the ML-DSA-44 passkey, or the session key. */
  signer: "master" | "passkey" | "session";
  result: FinalResult;
}

/** The mode C session the passkey opens: a cap, no device for the session's own payments. */
export interface PqSessionRules {
  capDrops: bigint;
  maxPerTxDrops?: bigint;
  durationSec: number;
}

/** Validated with tesSUCCESS. */
export function accepted(result: FinalResult): boolean {
  return result.validated && result.result === "tesSUCCESS";
}

async function submitWithKey(
  node: NodeClient,
  defs: Definitions,
  signer: BytesSigner,
  tx: TxJson,
): Promise<FinalResult> {
  const common = await fetchCommonFields(node, tx.Account);
  const signed = await signTransaction({ ...tx, ...common }, signer, defs);
  return submitSignedAndWait(node, signed, common.LastLedgerSequence);
}

/** PasskeyListSet with the ML-DSA-44 passkey, signed by the account's master key. */
export async function registerPqPasskey(
  node: NodeClient,
  defs: Definitions,
  account: string,
  master: BytesSigner,
  passkey: PasskeySigner,
): Promise<PqStep> {
  const tx = buildPasskeyListSet(account, [passkey.credential]);
  return {
    label: "PasskeyListSet",
    signer: "master",
    result: await submitWithKey(node, defs, master, tx),
  };
}

function paymentTx(account: string, destination: string, amountDrops: bigint): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: amountDrops.toString(),
  };
}

/** A payment signed by the ML-DSA-44 passkey through WebAuthn. */
export async function payWithPqPasskey(
  node: NodeClient,
  defs: Definitions,
  account: string,
  passkey: PasskeySigner,
  destination: string,
  amountDrops: bigint,
): Promise<PqStep> {
  const tx = paymentTx(account, destination, amountDrops);
  const { result } = await submitWithPasskey(tx, passkey, node, defs);
  return { label: "Payment", signer: "passkey", result };
}

/** SigningSessionSet (mode C) for `sessionKey`, signed by the ML-DSA-44 passkey. */
export async function openSessionWithPqPasskey(
  node: NodeClient,
  defs: Definitions,
  account: string,
  passkey: PasskeySigner,
  sessionKey: SessionKey,
  rules: PqSessionRules,
): Promise<PqStep> {
  const common = await fetchCommonFields(node, account);
  const mode =
    rules.maxPerTxDrops === undefined
      ? { kind: "cap" as const, capDrops: rules.capDrops }
      : { kind: "cap" as const, capDrops: rules.capDrops, maxPerTxDrops: rules.maxPerTxDrops };
  const tx = buildSessionSet(
    { account, sessionKey: sessionKey.address, durationSec: rules.durationSec, mode, common },
    defs,
  );
  const { result } = await submitWithPasskey(tx, passkey, node, defs);
  return { label: "SigningSessionSet (mode C)", signer: "passkey", result };
}

/** A payment of the account signed by the session key alone (no device). */
export async function payWithSession(
  node: NodeClient,
  defs: Definitions,
  account: string,
  sessionKey: SessionKey,
  destination: string,
  amountDrops: bigint,
): Promise<PqStep> {
  const common = await fetchCommonFields(node, account);
  const { currentLedger } = await getNetworkState(node);
  const tx = { ...paymentTx(account, destination, amountDrops), ...common };
  const signed = await signWithSessionKey(tx, sessionKey, defs, currentLedger);
  return {
    label: "Payment",
    signer: "session",
    result: await submitSignedAndWait(node, signed, common.LastLedgerSequence),
  };
}

/** SigningSessionDelete signed by the ML-DSA-44 passkey: the owner closes its session. */
export async function closeSessionWithPqPasskey(
  node: NodeClient,
  defs: Definitions,
  account: string,
  passkey: PasskeySigner,
  sessionKey: SessionKey,
): Promise<PqStep> {
  const common = await fetchCommonFields(node, account);
  const tx = buildSessionDelete({ account, sessionKey: sessionKey.address, common });
  const { result } = await submitWithPasskey(tx, passkey, node, defs);
  return { label: "SigningSessionDelete", signer: "passkey", result };
}

/**
 * RegularKey to the black hole, then asfDisableMaster, both signed by the master key: afterwards
 * the ML-DSA-44 passkey is the account's only authority. Stops after a step that is not accepted.
 */
export async function lockToPqPasskey(
  node: NodeClient,
  defs: Definitions,
  account: string,
  master: BytesSigner,
): Promise<PqStep[]> {
  const steps: PqStep[] = [];
  const regularKey = await submitWithKey(node, defs, master, {
    TransactionType: "SetRegularKey",
    Account: account,
    RegularKey: kBlackholeAddress,
  });
  steps.push({ label: "SetRegularKey (black hole)", signer: "master", result: regularKey });
  if (!accepted(regularKey)) return steps;
  const disable = await submitWithKey(node, defs, master, {
    TransactionType: "AccountSet",
    Account: account,
    SetFlag: defs.accountSetFlag(kDisableMasterFlagName),
  });
  steps.push({ label: "AccountSet asfDisableMaster", signer: "master", result: disable });
  return steps;
}
