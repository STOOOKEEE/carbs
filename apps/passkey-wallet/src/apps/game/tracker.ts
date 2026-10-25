// Follows submitted transactions to validation without one request per transaction: each new
// validated ledger is read once, with its transactions, and settles the ones it holds. A
// transaction still missing once its LastLedgerSequence is validated has expired.

import type { Connection } from "../../account.ts";
import { read } from "../../ledger.ts";
import { validatedLedger } from "./xrpl.ts";

export type Outcome =
  { kind: "validated"; result: string; ledgerHash: string } | { kind: "expired" };

interface Watched {
  lastLedger: number;
  settle: (outcome: Outcome) => void;
}

export interface Tracker {
  /** Settles when a validated ledger holds the transaction, or once it can no longer get in. */
  watch: (hash: string, lastLedger: number) => Promise<Outcome>;
  /** Reads the ledgers validated since the last poll. */
  poll: () => Promise<void>;
}

export function ledgerTracker(connection: Connection): Tracker {
  const watched = new Map<string, Watched>();
  let lastSeen: number | undefined;
  let polling: Promise<void> | undefined;

  async function readNewLedgers(): Promise<void> {
    const answer = await connection.node.request("ledger", { ledger_index: "validated" });
    const validated = Number(
      read(answer, ["ledger_index"]) ?? read(answer, ["ledger", "ledger_index"]),
    );
    if (!Number.isInteger(validated)) throw new Error("the node gave no validated ledger index");
    // Transactions are only watched after the first poll: nothing older can hold them.
    const from = lastSeen === undefined ? validated + 1 : lastSeen + 1;
    for (let index = from; index <= validated; index++) {
      if (watched.size > 0) {
        const ledger = await validatedLedger(connection.node, index);
        for (const [hash, result] of ledger.results) {
          const entry = watched.get(hash);
          if (entry === undefined) continue;
          watched.delete(hash);
          entry.settle({ kind: "validated", result, ledgerHash: ledger.hash });
        }
      }
      for (const [hash, entry] of watched) {
        if (entry.lastLedger > index) continue;
        watched.delete(hash);
        entry.settle({ kind: "expired" });
      }
      lastSeen = index;
    }
    lastSeen ??= validated;
  }

  return {
    watch(hash, lastLedger) {
      const { promise, resolve } = Promise.withResolvers<Outcome>();
      watched.set(hash, { lastLedger, settle: resolve });
      return promise;
    },
    poll() {
      polling ??= readNewLedgers().finally(() => {
        polling = undefined;
      });
      return polling;
    },
  };
}
