// The trader, owner of the account: the Ledger Stax (clear-signed, classical key or ML-DSA-44
// root) or the Mac account of the wallet page (Touch ID). It signs twice at most, at setup: the
// USD trust line (a TrustSet, which the session may not send) and the session's opening.

import { DeviceError } from "@carbs/ledger";

import { type Connection, requestFunding, signAndSubmitWithPasskey } from "../../account.ts";
import type { SubmittedTx, TxJson } from "../../ledger.ts";
import { type SessionRules, openSessionTx } from "../../session.ts";
import { type Stax, accountState, isPostQuantumRoot, submitSignedByStax } from "../../stax.ts";
import type { StoredWallet } from "../../storage.ts";
import type { Market } from "./api.ts";
import { trustsIssuer } from "./book.ts";
import { usdAmount } from "./offers.ts";
import { tradingRules } from "./rules.ts";

const TRUST_LIMIT_USD = 10_000;

export type OwnerKind = "stax" | "passkey";

export interface Owner {
  kind: OwnerKind;
  address: string;
  /** How the owner signs, for the page. */
  label: string;
  /** Signed by the Stax's ML-DSA-44 root (the account was migrated). */
  postQuantum: boolean;
  /** What the human does to validate. */
  prompt: string;
  signAndSubmit: (tx: TxJson) => Promise<SubmittedTx>;
}

/** The Stax account, funded by the faucet when it does not exist yet. */
export async function staxOwner(connection: Connection, stax: Stax): Promise<Owner> {
  let state = await accountState(connection, stax.account.address);
  if (state === undefined) {
    await requestFunding(stax.account.address);
    state = await accountState(connection, stax.account.address);
  }
  const postQuantum = isPostQuantumRoot(stax, state);
  return {
    kind: "stax",
    address: stax.account.address,
    label: postQuantum ? "Ledger Stax · ML-DSA-44 root" : "Ledger Stax · classical key",
    postQuantum,
    prompt: "review it on the Stax",
    signAndSubmit: (tx) => submitSignedByStax(connection, stax, tx, postQuantum),
  };
}

/** The Mac account created on the wallet page (same browser), signed with its passkey. */
export function passkeyOwner(connection: Connection, wallet: StoredWallet): Owner {
  if (wallet.passkey === undefined)
    throw new Error("the Mac account has no passkey yet: register it on the wallet page");
  return {
    kind: "passkey",
    address: wallet.address,
    label: "Mac account · Touch ID",
    postQuantum: false,
    prompt: "confirm with Touch ID",
    signAndSubmit: (tx) => signAndSubmitWithPasskey(connection, wallet, tx),
  };
}

/** The trust line to the USD issuer, signed by the owner once; undefined when it already exists. */
export async function ensureTrustLine(
  connection: Connection,
  owner: Owner,
  market: Market,
): Promise<SubmittedTx | undefined> {
  if (await trustsIssuer(connection, market, owner.address)) return undefined;
  return owner.signAndSubmit({
    TransactionType: "TrustSet",
    LimitAmount: usdAmount(market, TRUST_LIMIT_USD),
  });
}

/** Opens the session for `sessionKey`: the one signature of the owner for the whole run. */
export function openTradingSession(
  owner: Owner,
  sessionKey: string,
  rules: SessionRules = tradingRules(),
): Promise<SubmittedTx> {
  return owner.signAndSubmit(openSessionTx(owner.address, sessionKey, rules));
}

/** The Stax refused the opening: beyond the profile's limits (SW 0x6986). */
export function isDevicePolicyRefusal(error: unknown): boolean {
  return error instanceof DeviceError && error.kind === "sessionPolicyRefused";
}
