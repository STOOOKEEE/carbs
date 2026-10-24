/**
 * The transactions the screens build, in the node's own shapes, through `@carbs/sessions`
 * and the definitions the node served (`server_definitions`): the flag values, the
 * permission objects and the passkey objects are not typed by hand here. The envelope
 * (Sequence, Fee, LastLedgerSequence) is added by the store from `NodePort.commonFields`.
 */
import {
  buildSessionDelete,
  buildSessionSet,
  type Definitions,
  type SessionMode as CoreSessionMode,
} from "@carbs/sessions";
import type { PasskeyRef, SessionParams, TxBuilders, UnsignedTx } from "../ports";

/** Core's builders take the envelope; the store adds it later, so these are removed. */
const PLACEHOLDER = { Sequence: 0, Fee: "0", LastLedgerSequence: 0 } as const;
const ENVELOPE_FIELDS = ["Sequence", "Fee", "LastLedgerSequence", "NetworkID"] as const;
const DISABLE_MASTER = "asfDisableMaster";
const TOKEN = "USD";

function unsigned(tx: Record<string, unknown>): UnsignedTx {
  const out = { ...tx };
  for (const field of ENVELOPE_FIELDS) delete out[field];
  return out as UnsignedTx;
}

function coreMode(params: SessionParams): CoreSessionMode {
  switch (params.mode) {
    case "A":
      return { kind: "all" };
    case "P":
      return { kind: "permissions", permissions: params.permissions };
    case "C":
      return { kind: "cap", capDrops: BigInt(params.capDrops) };
  }
}

export function createLiveBuilders(defs: Definitions): TxBuilders {
  return {
    sessionSet: (account, sessionKey, params) =>
      unsigned(
        buildSessionSet(
          {
            account,
            sessionKey,
            durationSec: params.durationSec,
            mode: coreMode(params),
            common: PLACEHOLDER,
          },
          defs,
        ),
      ),
    sessionDelete: (account, sessionKey) =>
      unsigned(buildSessionDelete({ account, sessionKey, common: PLACEHOLDER })),
    payment: (account, destination, drops) => ({
      TransactionType: "Payment",
      Account: account,
      Destination: destination,
      Amount: String(drops),
    }),
    offerCreate: (account, issuer) => ({
      TransactionType: "OfferCreate",
      Account: account,
      TakerGets: "1000000",
      TakerPays: { currency: TOKEN, issuer, value: "1" },
    }),
    trustSet: (account, issuer) => ({
      TransactionType: "TrustSet",
      Account: account,
      LimitAmount: { currency: TOKEN, issuer, value: "100" },
    }),
    ticketCreate: (account) => ({
      TransactionType: "TicketCreate",
      Account: account,
      TicketCount: 1,
    }),
    nftMint: (account) => ({ TransactionType: "NFTokenMint", Account: account, NFTokenTaxon: 0 }),
    checkCreate: (account, destination) => ({
      TransactionType: "CheckCreate",
      Account: account,
      Destination: destination,
      SendMax: "1000000",
    }),
    setRegularKey: (account, regularKey) => {
      const tx: UnsignedTx = { TransactionType: "SetRegularKey", Account: account };
      if (regularKey !== null) tx["RegularKey"] = regularKey;
      return tx;
    },
    passkeyListSet: (account, passkeys: readonly PasskeyRef[]) => ({
      TransactionType: "PasskeyListSet",
      Account: account,
      Passkeys: passkeys.map((p) => ({
        Passkey: { PasskeyID: p.credentialId, PublicKey: p.publicKey },
      })),
    }),
    accountSetDisableMaster: (account) => ({
      TransactionType: "AccountSet",
      Account: account,
      SetFlag: defs.accountSetFlag(DISABLE_MASTER),
    }),
    accountSetNoop: (account) => ({ TransactionType: "AccountSet", Account: account }),
  };
}
