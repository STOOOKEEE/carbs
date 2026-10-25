// The studio's account, the owner that opens the minting session once: the Ledger Stax
// (clear-signed, classical key or ML-DSA-44 root once migrated) or the Mac account of the
// wallet page (Touch ID passkey). Nothing else ever asks the owner.

import { type Connection, requestFunding, signAndSubmitWithPasskey } from "../../account.ts";
import type { SubmittedTx, TxJson } from "../../ledger.ts";
import {
  type Stax,
  accountState,
  connectStax,
  isPostQuantumRoot,
  submitSignedByStax,
} from "../../stax.ts";
import { loadWallet } from "../../storage.ts";

export interface Owner {
  address: string;
  /** "Ledger Stax (ML-DSA-44 root)", "Mac account (Touch ID)", ... */
  label: string;
  /** Only the Stax applies a device profile (the Mac account has no device policy). */
  isStax: boolean;
  /** What the user does to approve, shown while waiting. */
  prompt: string;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

function staxOwner(connection: Connection, stax: Stax, postQuantum: boolean): Owner {
  return {
    address: stax.account.address,
    label: postQuantum ? "Ledger Stax (ML-DSA-44 root)" : "Ledger Stax",
    isStax: true,
    prompt: "Review the session on the Stax and approve it.",
    signAndSubmit: (tx) => submitSignedByStax(connection, stax, tx, postQuantum),
  };
}

/** Opens the Stax (the browser asks which device); an account not funded yet gets the faucet. */
export async function connectStaxOwner(connection: Connection): Promise<Owner> {
  const stax = await connectStax();
  let state = await accountState(connection, stax.account.address);
  if (state === undefined) {
    await requestFunding(stax.account.address);
    state = await accountState(connection, stax.account.address);
  }
  return staxOwner(connection, stax, isPostQuantumRoot(stax, state));
}

/** The passkey account created on the wallet page of this browser. */
export function macOwner(connection: Connection): Owner {
  const wallet = loadWallet();
  if (wallet?.passkey === undefined)
    throw new Error("no Mac account with a passkey here: create it on the wallet page first");
  return {
    address: wallet.address,
    label: "Mac account (Touch ID)",
    isStax: false,
    prompt: "Approve the session with Touch ID.",
    signAndSubmit: (tx) => signAndSubmitWithPasskey(connection, wallet, tx),
  };
}
