// The tickets of the event: their metadata (a short JSON in a data URL, stored as the NFT's
// URI), the NFTokenMint that creates one, and the reading of a minted one. Pure module.

import { bytesToHex, hexToBytes } from "../../hex.ts";
import type { TxJson } from "../../ledger.ts";

export const EVENT_NAME = "XRPL Live Paris 2026";
/** NFTokenTaxon of every ticket of this event: the gallery keeps only this taxon. */
export const EVENT_TAXON = 2026;
/** tfTransferable: a ticket can be resold or given away. */
const TF_TRANSFERABLE = 0x00000008;
/** Royalty to the studio on every resale, in 1/100 000 (5 000 = 5 %). */
const TRANSFER_FEE = 5_000;
const SEATS_PER_ROW = 20;
const FIRST_ROW_CODE = "A".charCodeAt(0);
const ROWS = 26;
/** Longest URI an NFToken may carry, in bytes. */
const MAX_URI_BYTES = 256;
const URI_PREFIX = "data:application/json,";

export interface Ticket {
  event: string;
  seat: string;
  number: number;
}

/** Ticket n (from 1): rows A to Z of 20 seats, then the numbering wraps around the rows. */
export function ticketFor(number: number): Ticket {
  if (!Number.isInteger(number) || number < 1) throw new Error("a ticket number starts at 1");
  const index = number - 1;
  const row = String.fromCharCode(FIRST_ROW_CODE + (Math.floor(index / SEATS_PER_ROW) % ROWS));
  return { event: EVENT_NAME, seat: `${row}-${(index % SEATS_PER_ROW) + 1}`, number };
}

function ticketUri(ticket: Ticket): string {
  const bytes = new TextEncoder().encode(`${URI_PREFIX}${JSON.stringify(ticket)}`);
  if (bytes.length > MAX_URI_BYTES)
    throw new Error(`the ticket URI exceeds ${MAX_URI_BYTES} bytes`);
  return bytesToHex(bytes);
}

/** The owner mints the ticket (issuer = owner); the session key will sign it. */
export function mintTicketTx(owner: string, ticket: Ticket): TxJson {
  return {
    TransactionType: "NFTokenMint",
    Account: owner,
    NFTokenTaxon: EVENT_TAXON,
    Flags: TF_TRANSFERABLE,
    TransferFee: TRANSFER_FEE,
    URI: ticketUri(ticket),
  };
}

export function burnTicketTx(owner: string, nftokenId: string): TxJson {
  return { TransactionType: "NFTokenBurn", Account: owner, NFTokenID: nftokenId };
}

function isTicket(value: unknown): value is Ticket {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "event") === "string" &&
    typeof Reflect.get(value, "seat") === "string" &&
    typeof Reflect.get(value, "number") === "number"
  );
}

/** The ticket stored in an NFT's URI; undefined when the URI is not one of this page's tickets. */
export function readTicket(uriHex: string): Ticket | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(uriHex));
  } catch (error) {
    // Not UTF-8: some other NFT of the account.
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  if (!text.startsWith(URI_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(URI_PREFIX.length));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  return isTicket(parsed) ? parsed : undefined;
}
