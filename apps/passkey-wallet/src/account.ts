// What the wallet does on the ledger: open an account, register its passkey,
// lock it to the passkey, and pay with the passkey.

import type { XrplDefinitions } from "ripple-binary-codec";
import { encodeForSigning } from "ripple-binary-codec";
import { generateSeed } from "ripple-keypairs";

import { FAUCET_PATH } from "./config.ts";
import {
  type SubmittedTx,
  type TxJson,
  addressOfSeed,
  autofill,
  signWithSeed,
  submitAndWait,
} from "./ledger.ts";
import { type Passkey, createPasskey, signWithPasskey } from "./passkey.ts";
import type { NodeClient } from "./rpc.ts";
import type { StoredWallet } from "./storage.ts";

/** ACCOUNT_ONE: an address no key controls. Set as regular key so that the passkey list is the only signer. */
const BLACK_HOLE_ADDRESS = "rrrrrrrrrrrrrrrrrrrrBZbvji";
export const ASF_DISABLE_MASTER = 4;
const DROPS_PER_XRP = 1_000_000;

export interface Connection {
  node: NodeClient;
  defs: XrplDefinitions;
}

function requireMaster(wallet: StoredWallet): string {
  if (wallet.masterSeed === undefined)
    throw new Error("the master key of this account is gone (passkey-only)");
  return wallet.masterSeed;
}

async function signAndSubmitWithMaster(
  { node, defs }: Connection,
  wallet: StoredWallet,
  tx: TxJson,
): Promise<SubmittedTx> {
  const filled = await autofill(node, defs, { ...tx, Account: wallet.address });
  return submitAndWait(node, defs, signWithSeed(defs, filled, requireMaster(wallet)));
}

/** Asks the node's faucet to fund an address from the genesis account. */
export async function requestFunding(address: string): Promise<void> {
  const answer = await fetch(FAUCET_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: address }),
  });
  if (!answer.ok) throw new Error(`faucet refused: ${answer.status} ${await answer.text()}`);
}

/** A new classical account, funded by the node's faucet. */
export async function openAccount(): Promise<StoredWallet> {
  const masterSeed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const address = addressOfSeed(masterSeed);
  await requestFunding(address);
  return { address, masterSeed, passkeyOnly: false };
}

/** Creates a passkey on this device and adds it to the account (PasskeyListSet, signed by the master key). */
export async function registerPasskey(
  connection: Connection,
  wallet: StoredWallet,
): Promise<{ passkey: Passkey; tx: SubmittedTx }> {
  const passkey = await createPasskey(`carbs ${wallet.address.slice(0, 8)}`);
  const tx = await signAndSubmitWithMaster(connection, wallet, {
    TransactionType: "PasskeyListSet",
    Passkeys: [{ Passkey: { PasskeyID: passkey.id, PublicKey: passkey.publicKey } }],
  });
  return { passkey, tx };
}

/** Regular key to the black hole, then the master key disabled: from here only the passkey signs. */
export async function lockToPasskey(
  connection: Connection,
  wallet: StoredWallet,
): Promise<SubmittedTx[]> {
  const regularKey = await signAndSubmitWithMaster(connection, wallet, {
    TransactionType: "SetRegularKey",
    RegularKey: BLACK_HOLE_ADDRESS,
  });
  if (regularKey.result !== "tesSUCCESS") return [regularKey];
  const disableMaster = await signAndSubmitWithMaster(connection, wallet, {
    TransactionType: "AccountSet",
    SetFlag: ASF_DISABLE_MASTER,
  });
  return [regularKey, disableMaster];
}

/** Any transaction of the account, signed by its passkey (Touch ID): the challenge is its signing data. */
export async function signAndSubmitWithPasskey(
  { node, defs }: Connection,
  wallet: StoredWallet,
  tx: TxJson,
): Promise<SubmittedTx> {
  if (wallet.passkey === undefined) throw new Error("register a passkey first");
  const unsigned = await autofill(node, defs, {
    ...tx,
    Account: wallet.address,
    SigningPubKey: wallet.passkey.publicKey,
  });
  const signed = await signWithPasskey(wallet.passkey, unsigned, encodeForSigning(unsigned, defs));
  return submitAndWait(node, defs, signed);
}

/** A payment signed by the passkey. */
export async function payWithPasskey(
  connection: Connection,
  wallet: StoredWallet,
  destination: string,
  amountXrp: number,
): Promise<SubmittedTx> {
  if (!Number.isFinite(amountXrp) || amountXrp <= 0)
    throw new Error("the amount must be a positive number of XRP");
  return signAndSubmitWithPasskey(connection, wallet, {
    TransactionType: "Payment",
    Destination: destination,
    Amount: String(Math.round(amountXrp * DROPS_PER_XRP)),
  });
}
