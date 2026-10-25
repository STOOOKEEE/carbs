/**
 * One sentence per node result code, for the UI. The code itself always comes from
 * the node; this table only adds the rule that produced it (spec 6.5 and 6.13).
 * It never replaces or renames a code.
 */
export interface ResultDescription {
  code: string;
  /** What happened, in one sentence. */
  sentence: string;
  /** The rule of the spec that produced it, when there is one. */
  rule: string | null;
}

const DESCRIPTIONS: Record<string, { sentence: string; rule: string | null }> = {
  tesSUCCESS: { sentence: "The transaction was applied.", rule: null },
  tefSESSION_TX_NOT_ALLOWED: {
    sentence:
      "The session does not allow this transaction type or shape, or LastLedgerSequence is missing or too far away.",
    rule: "Rules 1 and 2 of the session check (spec 6.5)",
  },
  tefSESSION_EXPIRED: {
    sentence: "The session ended: the ledger's close time reached its Expiration.",
    rule: "Rule 3 of the session check (spec 6.5)",
  },
  tefSESSION_LIMIT: {
    sentence: "The fee is above the ceiling, or the cost is above what is left of the cap.",
    rule: "Rules 4 and 5 of the session check (spec 6.5)",
  },
  tefBAD_AUTH: {
    sentence: "This key is not authorized to sign for this account.",
    rule: "Ordinary signature check",
  },
  tefMASTER_DISABLED: {
    sentence: "The master key is disabled for this account.",
    rule: "Ordinary signature check",
  },
  tefEXCEPTION: {
    sentence: "The transaction raised an exception while applying.",
    rule: "A passkey list cannot be replaced (spec 6.14, P6)",
  },
  tefPAST_SEQ: { sentence: "The sequence number was already used.", rule: null },
  tefMAX_LEDGER: { sentence: "LastLedgerSequence has passed.", rule: null },
  tecNO_PERMISSION: {
    sentence: "That key or account may not do this.",
    rule: "Spec 6.3 and 6.13",
  },
  tecDUPLICATE: { sentence: "A session for this key already exists.", rule: "Spec 6.3" },
  tecNO_ENTRY: { sentence: "There is no such session.", rule: "Spec 6.3" },
  tecINSUFFICIENT_RESERVE: {
    sentence: "The account cannot cover the reserve of one more object.",
    rule: "Spec 6.3",
  },
  tecNEED_MASTER_KEY: {
    sentence: "Only the master key can set this flag.",
    rule: "AccountSet asfDisableMaster",
  },
  tecNO_ALTERNATIVE_KEY: {
    sentence: "Disabling the master key needs another key (a regular key or a signer list).",
    rule: "AccountSet asfDisableMaster; a passkey list does not count",
  },
  tecNO_DST_INSUF_XRP: {
    sentence: "The destination does not exist and the payment is below the reserve.",
    rule: null,
  },
  tecUNFUNDED_PAYMENT: { sentence: "The account cannot afford this payment.", rule: null },
  tecPATH_DRY: { sentence: "No path for this payment.", rule: null },
  temMALFORMED: { sentence: "The transaction is malformed.", rule: "Spec 6.3 preflight" },
  temBAD_EXPIRATION: {
    sentence: "The duration is zero or above the maximum.",
    rule: "Spec 6.3 preflight",
  },
  temINVALID_FLAG: { sentence: "An unknown flag is set.", rule: "Spec 6.3 preflight" },
  temBAD_AMOUNT: { sentence: "The amount is not valid.", rule: "Spec 6.3 preflight" },
  temARRAY_EMPTY: { sentence: "The permissions list is empty.", rule: "Spec 6.3 preflight" },
  temARRAY_TOO_LARGE: {
    sentence: "The permissions list has more than ten values.",
    rule: "Spec 6.3 preflight",
  },
  temBAD_SIGNATURE: { sentence: "The signature does not verify.", rule: null },
  temBAD_REGKEY: { sentence: "The regular key cannot be the account itself.", rule: null },
  temDISABLED: { sentence: "The amendment is not enabled on this node.", rule: "Spec 6.13" },
  temUNKNOWN: { sentence: "The node does not know this transaction type.", rule: null },
  terNO_ACCOUNT: { sentence: "The account does not exist.", rule: null },
  terPRE_SEQ: { sentence: "The sequence number is ahead of the account.", rule: null },
  terINSUF_FEE_B: { sentence: "The account cannot pay the fee.", rule: null },
  telINSUF_FEE_P: { sentence: "The fee is below the node's minimum.", rule: null },
};

export function describeResult(code: string): ResultDescription {
  const known = DESCRIPTIONS[code];
  if (known === undefined) {
    return {
      code,
      sentence: "The node answered with a code this app has no sentence for.",
      rule: null,
    };
  }
  return { code, ...known };
}
