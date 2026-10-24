/**
 * The catalogues behind the Actions and Attack screens. Each entry builds one
 * transaction; the demo store signs it with the session key and submits it. What the
 * screens print is the node's result code, never a message of ours (spec 8.5).
 */
import { DEMO_PAYMENT_XRP } from "./constants";
import { xrpToDrops } from "./format";
import type { SessionMode, TxBuilders, UnsignedTx } from "./ports";

export interface ScenarioContext {
  builders: TxBuilders;
  account: string;
  sink: string;
  victim: string;
  /** Drops left under the cap (mode C), when known. */
  remainingCapDrops: number | null;
}

export interface Action {
  id: string;
  title: string;
  type: string;
  blurb: string;
  build(ctx: ScenarioContext): UnsignedTx;
}

export const ACTIONS: readonly Action[] = [
  {
    id: "payment",
    title: `Send ${DEMO_PAYMENT_XRP} XRP`,
    type: "Payment",
    blurb: "A plain XRP payment to a second account. The only action a mode C session allows.",
    build: (ctx) => ctx.builders.payment(ctx.account, ctx.sink, xrpToDrops(DEMO_PAYMENT_XRP)),
  },
  {
    id: "offer",
    title: "Place an offer",
    type: "OfferCreate",
    blurb: "Sell 1 XRP for 1 USD on the order book. The offer outlives the session.",
    build: (ctx) => ctx.builders.offerCreate(ctx.account, ctx.sink),
  },
  {
    id: "trust",
    title: "Open a trust line",
    type: "TrustSet",
    blurb: "Trust the sink account for up to 100 USD. Costs one owner reserve.",
    build: (ctx) => ctx.builders.trustSet(ctx.account, ctx.sink),
  },
  {
    id: "ticket",
    title: "Create a ticket",
    type: "TicketCreate",
    blurb: "Set aside one sequence number for later.",
    build: (ctx) => ctx.builders.ticketCreate(ctx.account),
  },
  {
    id: "mint",
    title: "Mint an NFT",
    type: "NFTokenMint",
    blurb: "Mint a token with taxon 0.",
    build: (ctx) => ctx.builders.nftMint(ctx.account),
  },
  {
    id: "check",
    title: "Write a check",
    type: "CheckCreate",
    blurb: "A check for 1 XRP to the sink account.",
    build: (ctx) => ctx.builders.checkCreate(ctx.account, ctx.sink),
  },
];

export interface Attack {
  id: string;
  title: string;
  /** What a stolen session key tries. */
  story: string;
  type: string;
  /** Only meaningful in this mode; others show a hint. */
  needsMode: SessionMode | null;
  /** Needs the session to be past its Expiration (the simulated clock can be advanced). */
  needsExpiry: boolean;
  /** Build the transaction. `fee` and `omitLastLedger` tune the envelope. */
  build(ctx: ScenarioContext): UnsignedTx;
  fee?: string;
  omitLastLedger?: boolean;
  /** The attack signs for the victim account, which must exist on the node. */
  needsVictimAccount?: boolean;
}

/** A well-formed passkey the attacker would register: `0xF6 ‖ X ‖ Y` and a 16-byte credential id. */
const ATTACKER_PASSKEY = {
  publicKey: `F6${"11".repeat(64)}`,
  credentialId: "AB".repeat(16),
};

/** Fee far above the ceiling of spec 6.5 rule 4. */
const BURN_FEE_DROPS = "500000";

export const ATTACKS: readonly Attack[] = [
  {
    id: "regular-key",
    title: "Take over the account",
    story: "Set the regular key to the attacker's key.",
    type: "SetRegularKey",
    needsMode: null,
    needsExpiry: false,
    build: (ctx) => ctx.builders.setRegularKey(ctx.account, ctx.victim),
  },
  {
    id: "passkey",
    title: "Add an attacker passkey",
    story: "Register a new passkey, which would have full authority.",
    type: "PasskeyListSet",
    needsMode: null,
    needsExpiry: false,
    build: (ctx) => ctx.builders.passkeyListSet(ctx.account, [ATTACKER_PASSKEY]),
  },
  {
    id: "disable-master",
    title: "Disable the master key",
    story: "Lock the owner out of the account.",
    type: "AccountSet",
    needsMode: null,
    needsExpiry: false,
    build: (ctx) => ctx.builders.accountSetDisableMaster(ctx.account),
  },
  {
    id: "open-session",
    title: "Open another session",
    story: "Mint a second, longer session for a key the attacker controls.",
    type: "SigningSessionSet",
    needsMode: null,
    needsExpiry: false,
    build: (ctx) =>
      ctx.builders.sessionSet(ctx.account, ctx.victim, {
        mode: "A",
        durationSec: 600,
        permissions: [],
        capDrops: 0,
      }),
  },
  {
    id: "cap-overflow",
    title: "Overspend the cap",
    story: "Pay more than what is left of the cap.",
    type: "Payment",
    needsMode: "C",
    needsExpiry: false,
    build: (ctx) => ctx.builders.payment(ctx.account, ctx.sink, (ctx.remainingCapDrops ?? 0) + 1),
  },
  {
    id: "fee-burn",
    title: "Burn the balance in fees",
    story: "Submit a transaction with a huge fee.",
    type: "Payment",
    needsMode: null,
    needsExpiry: false,
    fee: BURN_FEE_DROPS,
    build: (ctx) => ctx.builders.payment(ctx.account, ctx.sink, xrpToDrops(1)),
  },
  {
    id: "no-last-ledger",
    title: "Sign without a last ledger",
    story: "Omit LastLedgerSequence so the transaction could be held and replayed later.",
    type: "Payment",
    needsMode: null,
    needsExpiry: false,
    omitLastLedger: true,
    build: (ctx) => ctx.builders.payment(ctx.account, ctx.sink, xrpToDrops(1)),
  },
  {
    id: "other-account",
    title: "Sign for another account",
    story: "Use this session key on an account that never opened a session.",
    type: "Payment",
    needsMode: null,
    needsExpiry: false,
    needsVictimAccount: true,
    build: (ctx) => ctx.builders.payment(ctx.victim, ctx.sink, xrpToDrops(1)),
  },
  {
    id: "after-expiry",
    title: "Wait out the session, then pay",
    story: "Try again after the Expiration has passed.",
    type: "Payment",
    needsMode: null,
    needsExpiry: true,
    build: (ctx) => ctx.builders.payment(ctx.account, ctx.sink, xrpToDrops(1)),
  },
];
