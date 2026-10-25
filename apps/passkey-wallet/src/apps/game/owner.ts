// Who opens the game's session, once: the Ledger Stax (clear-signed, classical key or ML-DSA-44
// root once migrated) or Touch ID on the Mac account created in the wallet page (index.html).

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
  /** How the owner signs, for the page: "Ledger Stax", "Touch ID". */
  label: string;
  isStax: boolean;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

/** Kept between openings: WebHID asks for the device only once. */
let stax: Stax | undefined;

/**
 * The Stax account, funded by the faucet when new. Call it straight from the click: the
 * browser's device chooser needs the click's user activation.
 */
export async function staxOwner(connection: Connection): Promise<Owner> {
  stax ??= await connectStax();
  const device = stax;
  let state = await accountState(connection, device.account.address);
  if (state === undefined) {
    await requestFunding(device.account.address);
    state = await accountState(connection, device.account.address);
  }
  const withPq = isPostQuantumRoot(device, state);
  return {
    address: device.account.address,
    label: withPq ? "Ledger Stax (ML-DSA-44 root)" : "Ledger Stax",
    isStax: true,
    signAndSubmit: (tx) => submitSignedByStax(connection, device, tx, withPq),
  };
}

/** The passkey account of this browser (wallet page): Touch ID signs the opening. */
export function touchIdOwner(connection: Connection): Owner {
  const wallet = loadWallet();
  if (wallet?.passkey === undefined)
    throw new Error("no passkey account in this browser: create one on the wallet page first");
  return {
    address: wallet.address,
    label: "Touch ID",
    isStax: false,
    signAndSubmit: (tx) => signAndSubmitWithPasskey(connection, wallet, tx),
  };
}
