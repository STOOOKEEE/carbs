import { kLastLedgerSequenceOffset } from "@carbs/sessions";
import { TF_FULLY_CANONICAL_SIG } from "../constants";
import type { KeyHandle, NodeResult, TxJson } from "../ports";
import { SimulatedNode, type SimulatedNodeOptions } from "./node";
import { SimulatedWallet } from "./wallet";

export interface Rig {
  node: SimulatedNode;
  wallet: SimulatedWallet;
  master: KeyHandle;
  account: string;
}

/** A node with one funded account whose master key the test holds. */
export async function rig(options: SimulatedNodeOptions = {}): Promise<Rig> {
  const node = new SimulatedNode(options);
  const wallet = new SimulatedWallet();
  const master = await wallet.createMasterKey();
  await node.fundAccount(master.address);
  return { node, wallet, master, account: master.address };
}

export async function fundedAccount(r: Rig): Promise<KeyHandle> {
  const key = await r.wallet.createMasterKey();
  await r.node.fundAccount(key.address);
  return key;
}

/** Fill the envelope, sign with `key`, submit. `extra` can override or remove fields. */
export async function send(
  node: SimulatedNode,
  key: KeyHandle,
  tx: { TransactionType: string; Account: string } & Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<NodeResult> {
  const info = await node.accountInfo(tx.Account);
  const server = await node.serverInfo();
  const full: TxJson = {
    Fee: "12",
    Flags: TF_FULLY_CANONICAL_SIG,
    Sequence: info?.sequence ?? 0,
    LastLedgerSequence: server.ledgerIndex + 1 + kLastLedgerSequenceOffset,
    ...tx,
    ...extra,
  };
  return node.submit(await key.sign(full));
}

/** Open a session and return the session key. */
export async function openSession(
  r: Rig,
  fields: Record<string, unknown>,
  algorithm: "p256" | "mldsa44" = "p256",
): Promise<{ key: KeyHandle; result: NodeResult }> {
  const key = await r.wallet.createSessionKey(algorithm);
  const result = await send(r.node, r.master, {
    TransactionType: "SigningSessionSet",
    Account: r.account,
    SessionKey: key.address,
    SessionDuration: 600,
    ...fields,
  });
  return { key, result };
}

export function pay(account: string, destination: string, drops: number): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: String(drops),
    Fee: "12",
  };
}

export async function secondsUntilExpiry(node: SimulatedNode, account: string): Promise<number> {
  const objects = await node.accountObjects(account);
  const server = await node.serverInfo();
  const session = objects.sessions[0];
  if (session === undefined) throw new Error("no session");
  return session.expiration - server.closeTime;
}
