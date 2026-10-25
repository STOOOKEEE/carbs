// The owner of the account, who opens the streaming session once: the Ledger Stax (classical
// key or ML-DSA-44 root, reviewed in clear on the device), or Touch ID on the Mac account
// created on the wallet page (index.html, same browser).

import { type Connection, requestFunding, signAndSubmitWithPasskey } from "../../account.ts";
import type { SubmittedTx, TxJson } from "../../ledger.ts";
import { accountState, connectStax, isPostQuantumRoot, submitSignedByStax } from "../../stax.ts";
import { loadWallet } from "../../storage.ts";

export interface Owner {
  kind: "stax" | "passkey";
  address: string;
  /** Who signs, for the page. */
  label: string;
  /** What the human does to approve the opening. */
  prompt: string;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

/** Connects the Stax (the browser asks which device) and funds its account when it is new. */
export async function staxOwner(connection: Connection): Promise<Owner> {
  const stax = await connectStax();
  let state = await accountState(connection, stax.account.address);
  if (state === undefined) {
    await requestFunding(stax.account.address);
    state = await accountState(connection, stax.account.address);
  }
  const postQuantum = isPostQuantumRoot(stax, state);
  return {
    kind: "stax",
    address: stax.account.address,
    label: postQuantum ? "Ledger Stax (ML-DSA-44 root)" : "Ledger Stax (classical key)",
    prompt: "Review « Profile: Streaming » on the Stax and sign…",
    signAndSubmit: (tx) => submitSignedByStax(connection, stax, tx, postQuantum),
  };
}

/** The Mac account of the wallet page, signing with its passkey. */
export function passkeyOwner(connection: Connection): Owner {
  const wallet = loadWallet();
  if (wallet?.passkey === undefined)
    throw new Error("create the Mac account and its passkey on the wallet page first");
  return {
    kind: "passkey",
    address: wallet.address,
    label: "Touch ID (Mac account)",
    prompt: "Confirm with Touch ID…",
    signAndSubmit: (tx) => signAndSubmitWithPasskey(connection, wallet, tx),
  };
}
