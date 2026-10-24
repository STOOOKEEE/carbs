/**
 * SIMULATED transaction-type tables. They stand in for `server_definitions` and the
 * `delegable` attribute of `transactions.macro` (spec 6.8), which the live backend reads
 * from the node. Adding a delegable type here without a decision is exactly what case 9b
 * of the test plan is there to catch; `sim/node.test.ts` enumerates this table.
 */

/** Transaction types the XLS-75 permission engine can delegate (spec 6.8). */
export const DELEGABLE_TYPES: readonly string[] = [
  "Payment",
  "OfferCreate",
  "OfferCancel",
  "TrustSet",
  "TicketCreate",
  "NFTokenMint",
  "NFTokenBurn",
  "CheckCreate",
  "CheckCash",
  "CheckCancel",
  "EscrowCreate",
  "EscrowFinish",
  "EscrowCancel",
  "PaymentChannelCreate",
  "DepositPreauth",
  "Clawback",
  "CredentialAccept",
  "PasskeyListSet",
  "SubscriptionSet",
  "SponsorshipSet",
];

/** Delegable types a session must never sign (they grant or change authority). */
export const SESSION_EXCLUDED_TYPES: readonly string[] = [
  "PasskeyListSet",
  "SubscriptionSet",
  "SponsorshipSet",
];

/** Types that exist but are not delegable. */
export const NON_DELEGABLE_TYPES: readonly string[] = [
  "AccountSet",
  "SetRegularKey",
  "SignerListSet",
  "AccountDelete",
  "DelegateSet",
  "Batch",
  "FirewallSet",
  "BeneficiarySet",
  "WithdrawPreauth",
  "SigningSessionSet",
  "SigningSessionDelete",
];

export const ALL_TYPES: readonly string[] = [...DELEGABLE_TYPES, ...NON_DELEGABLE_TYPES];

/** Types a session can be given in mode P (delegable and not excluded). */
export function sessionPermissionChoices(): string[] {
  return DELEGABLE_TYPES.filter((type) => !SESSION_EXCLUDED_TYPES.includes(type));
}

export function isDelegable(type: string): boolean {
  return DELEGABLE_TYPES.includes(type);
}

export function isSessionExcluded(type: string): boolean {
  return SESSION_EXCLUDED_TYPES.includes(type);
}

/** How many owner objects a successful transaction adds (reserve model). */
export function ownerObjectsAdded(tx: { TransactionType: string; TicketCount?: unknown }): number {
  switch (tx.TransactionType) {
    case "OfferCreate":
    case "TrustSet":
    case "CheckCreate":
    case "EscrowCreate":
    case "PaymentChannelCreate":
    case "SignerListSet":
    case "PasskeyListSet":
      return 1;
    case "TicketCreate":
      return typeof tx.TicketCount === "number" ? tx.TicketCount : 1;
    default:
      return 0;
  }
}
