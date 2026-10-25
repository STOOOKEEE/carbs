// The session key as a rapid-fire signer for the owner's account: no prompt, no wait for
// validation. Transactions go out one after the other (one Sequence each, counted here so that
// a shot does not wait for the previous one to be validated); Fee and LastLedgerSequence are
// read again every few seconds. A refused transaction takes no Sequence: the next one re-reads it.

import type { Connection } from "../../account.ts";
import { type SubmittedTx, type TxJson, read, signWithSeed } from "../../ledger.ts";
import { isAccepted, submitOnly } from "./xrpl.ts";

/** How many ledgers a shot may wait before it expires (about a minute at one ledger per 3 s). */
const LEDGER_WINDOW = 20;
/** Fee and current ledger are read again after this long. */
const TERMS_MAX_AGE_MS = 3_000;

export interface Fired extends SubmittedTx {
  /** The shot can no longer validate once this ledger is validated without it. */
  lastLedger: number;
}

export type Gun = (tx: TxJson) => Promise<Fired>;

interface Terms {
  fee: string;
  lastLedger: number;
  readAtMs: number;
}

function numberOf(value: unknown, what: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new Error(`unexpected node answer: ${what} is missing`);
}

export function sessionGun(connection: Connection, owner: string, keySeed: string): Gun {
  const { node, defs } = connection;
  let sequence: number | undefined;
  let terms: Terms | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function readTerms(): Promise<Terms> {
    const [fee, current] = await Promise.all([node.request("fee"), node.request("ledger_current")]);
    return {
      fee: String(numberOf(read(fee, ["drops", "open_ledger_fee"]), "open_ledger_fee")),
      lastLedger:
        numberOf(read(current, ["ledger_current_index"]), "ledger_current_index") + LEDGER_WINDOW,
      readAtMs: Date.now(),
    };
  }

  async function readSequence(): Promise<number> {
    const info = await node.request("account_info", { account: owner, ledger_index: "current" });
    return numberOf(read(info, ["account_data", "Sequence"]), "Sequence");
  }

  async function fireNow(tx: TxJson): Promise<Fired> {
    try {
      const txSequence = sequence ?? (await readSequence());
      const txTerms =
        terms === undefined || Date.now() - terms.readAtMs > TERMS_MAX_AGE_MS
          ? await readTerms()
          : terms;
      terms = txTerms;
      const filled: TxJson = {
        ...tx,
        Account: owner,
        Sequence: txSequence,
        Fee: txTerms.fee,
        LastLedgerSequence: txTerms.lastLedger,
      };
      const submitted = await submitOnly(node, defs, signWithSeed(defs, filled, keySeed));
      sequence = isAccepted(submitted.result) ? txSequence + 1 : undefined;
      return { ...submitted, lastLedger: txTerms.lastLedger };
    } catch (error) {
      sequence = undefined;
      throw error;
    }
  }

  return (tx) => {
    const fired = queue.then(() => fireNow(tx));
    // The queue goes on after a failure; the error still reaches this shot's caller.
    queue = fired.catch(() => undefined);
    return fired;
  };
}
