// What the desk's key does, signed alone (no prompt): mint tickets one by one or in a burst,
// close its own session, and the abuse attempts the ledger must refuse with an exact code.

import type { Connection } from "../../account.ts";
import { secondsUntil } from "../../agent-approvals.ts";
import { paymentTx } from "../../session.ts";
import { MINT_SETUP_PATH, type MintSetup } from "../../../server/mint.ts";
import { logInfo, logResult } from "./activity.ts";
import { readSessionEntry, readTickets } from "./ledger-reads.ts";
import {
  type MintSession,
  SESSION_MAX_TX_COUNT,
  closeSession,
  submitBurstWithSessionKey,
  submitWithSessionKey,
} from "./mint-session.ts";
import { burnTicketTx, mintTicketTx, ticketFor } from "./tickets.ts";

const NOT_ALLOWED = "tefSESSION_TX_NOT_ALLOWED";
const LIMIT = "tefSESSION_LIMIT";
const SUCCESS = "tesSUCCESS";
/** What the hijacked desk tries to send out. */
const STOLEN_XRP = 10;
const MS_PER_SECOND = 1_000;

let setup: Promise<MintSetup> | undefined;

function isMintSetup(value: unknown): value is MintSetup {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "outsider") === "string"
  );
}

async function fetchSetup(): Promise<MintSetup> {
  const answer = await fetch(MINT_SETUP_PATH, { method: "POST" });
  if (!answer.ok) throw new Error(`mint setup refused: HTTP ${answer.status}`);
  const body: unknown = await answer.json();
  if (!isMintSetup(body)) throw new Error("mint setup: unexpected answer");
  return body;
}

/** The outside account, created once by the server; a failed request is retried next time. */
function mintSetup(): Promise<MintSetup> {
  setup ??= fetchSetup().catch((error: unknown) => {
    setup = undefined;
    throw error;
  });
  return setup;
}

/** How many more transactions the ledger accepts now: 0 once closed or expired. */
async function remainingTransactions(
  connection: Connection,
  session: MintSession,
): Promise<number> {
  const entry = await readSessionEntry(connection, session.owner, session.keyAddress);
  if (entry === undefined || secondsUntil(entry.expiration) <= 0) return 0;
  return Math.max(0, (entry.maxTxCount ?? SESSION_MAX_TX_COUNT) - entry.txCount);
}

/**
 * Mints `count` tickets: those the session still allows in one burst, then (if more were asked)
 * one more, so the ledger answers for the rest. Returns a line for the desk.
 */
export async function mintTickets(
  connection: Connection,
  session: MintSession,
  count: number,
  expectedPastLimit?: string,
): Promise<string> {
  const held = await readTickets(connection, session.owner);
  const firstNumber = Math.max(0, ...held.map((minted) => minted.ticket.number)) + 1;
  const allowed = Math.min(count, await remainingTransactions(connection, session));
  const started = Date.now();
  let minted = 0;
  if (allowed > 0) {
    const txs = Array.from({ length: allowed }, (_, index) =>
      mintTicketTx(session.owner, ticketFor(firstNumber + index)),
    );
    const results = await submitBurstWithSessionKey(connection, session, txs);
    const successes = results.filter((result) => result.result === SUCCESS);
    minted = successes.length;
    const last = successes.at(-1);
    if (last !== undefined)
      logResult(
        minted === 1
          ? `Desk's key minted ticket #${firstNumber}`
          : `Desk's key minted tickets #${firstNumber}–#${firstNumber + minted - 1} in one burst`,
        last,
      );
    for (const result of results)
      if (result.result !== SUCCESS) logResult("A mint of the burst was refused", result);
  }
  const seconds = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
  if (count <= allowed) return `${minted} ticket(s) minted in ${seconds} s, no prompt.`;
  const beyond = ticketFor(firstNumber + allowed);
  const refused = await submitWithSessionKey(
    connection,
    session,
    mintTicketTx(session.owner, beyond),
  );
  logResult(
    `Desk's key mints ticket #${beyond.number}, past the session`,
    refused,
    expectedPastLimit,
  );
  return `${minted} ticket(s) minted, then the ledger answered ${refused.result} for one more.`;
}

/** Uses up what is left of the count, then one more: the ledger must answer tefSESSION_LIMIT. */
export async function abuseCount(connection: Connection, session: MintSession): Promise<string> {
  const remaining = await remainingTransactions(connection, session);
  logInfo(`Abuse: ${remaining} transaction(s) left, the desk tries ${remaining + 1}.`);
  return mintTickets(connection, session, remaining + 1, LIMIT);
}

/** A Payment signed by the desk's key: mode P without the Payment permission. */
export async function abusePayment(connection: Connection, session: MintSession): Promise<string> {
  const { outsider } = await mintSetup();
  const submitted = await submitWithSessionKey(
    connection,
    session,
    paymentTx(session.owner, outsider, STOLEN_XRP),
  );
  logResult(`Abuse: desk's key sends ${STOLEN_XRP} XRP to ${outsider}`, submitted, NOT_ALLOWED);
  return `The ledger answered ${submitted.result}: the desk cannot move funds.`;
}

/** An NFTokenBurn of the newest ticket: allowed to the owner, not to this session. */
export async function abuseBurn(connection: Connection, session: MintSession): Promise<string> {
  const [newest] = await readTickets(connection, session.owner);
  if (newest === undefined) throw new Error("mint a ticket first: there is nothing to burn");
  const submitted = await submitWithSessionKey(
    connection,
    session,
    burnTicketTx(session.owner, newest.nftokenId),
  );
  logResult(`Abuse: desk's key burns ticket #${newest.ticket.number}`, submitted, NOT_ALLOWED);
  return `The ledger answered ${submitted.result}: the desk cannot destroy tickets.`;
}

export async function closeOwnSession(
  connection: Connection,
  session: MintSession,
): Promise<string> {
  const submitted = await closeSession(connection, session);
  logResult("Desk's key closes its own session", submitted);
  return submitted.result === SUCCESS
    ? "Session closed: the desk's key no longer signs anything."
    : `The close answered ${submitted.result}.`;
}
