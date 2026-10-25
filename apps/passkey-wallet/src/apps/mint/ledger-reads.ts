// What the minting page reads on the ledger: the session entry (count, expiry), the owner
// account (balance, owner count), the reserve settings, and the minted tickets (account_nfts).

import type { Connection } from "../../account.ts";
import { read } from "../../ledger.ts";
import { RpcError } from "../../rpc.ts";
import { EVENT_TAXON, type Ticket, readTicket } from "./tickets.ts";

/** account_nfts answers at most this many per page. */
const NFTS_PAGE_LIMIT = 400;

export interface SessionEntry {
  /** Session-signed transactions applied so far (SessionTxCount, absent = 0). */
  txCount: number;
  maxTxCount: number | undefined;
  /** Seconds since the XRPL epoch. */
  expiration: number;
}

export interface OwnerState {
  balanceDrops: number;
  ownerCount: number;
}

export interface ReserveSettings {
  baseDrops: number;
  incrementDrops: number;
}

export interface MintedTicket {
  nftokenId: string;
  serial: number;
  ticket: Ticket;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function requiredNumber(value: unknown, what: string): number {
  const found = optionalNumber(value);
  if (found === undefined) throw new Error(`unexpected node answer: ${what} is missing`);
  return found;
}

/** The SigningSession entry; undefined once it is gone (closed, or never opened). */
export async function readSessionEntry(
  connection: Connection,
  owner: string,
  sessionKey: string,
): Promise<SessionEntry | undefined> {
  let answer: unknown;
  try {
    answer = await connection.node.request("ledger_entry", {
      signing_session: { account: owner, session_key: sessionKey },
      ledger_index: "validated",
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const node = read(answer, ["node"]);
  return {
    txCount: optionalNumber(read(node, ["SessionTxCount"])) ?? 0,
    maxTxCount: optionalNumber(read(node, ["SessionMaxTxCount"])),
    expiration: requiredNumber(read(node, ["Expiration"]), "Expiration"),
  };
}

export async function readOwner(connection: Connection, owner: string): Promise<OwnerState> {
  const answer = await connection.node.request("account_info", {
    account: owner,
    ledger_index: "validated",
  });
  return {
    balanceDrops: requiredNumber(read(answer, ["account_data", "Balance"]), "Balance"),
    ownerCount: requiredNumber(read(answer, ["account_data", "OwnerCount"]), "OwnerCount"),
  };
}

/** Base and owner reserve of the last validated ledger, in drops. */
export async function readReserve(connection: Connection): Promise<ReserveSettings> {
  const answer = await connection.node.request("server_state");
  // A node without a validated ledger yet answers with closed_ledger instead.
  const ledger =
    read(answer, ["state", "validated_ledger"]) ?? read(answer, ["state", "closed_ledger"]);
  return {
    baseDrops: requiredNumber(read(ledger, ["reserve_base"]), "reserve_base"),
    incrementDrops: requiredNumber(read(ledger, ["reserve_inc"]), "reserve_inc"),
  };
}

function mintedTicket(nft: unknown, owner: string): MintedTicket | undefined {
  const nftokenId = read(nft, ["NFTokenID"]);
  const uri = read(nft, ["URI"]);
  const serial = optionalNumber(read(nft, ["nft_serial"]));
  if (
    typeof nftokenId !== "string" ||
    typeof uri !== "string" ||
    serial === undefined ||
    read(nft, ["Issuer"]) !== owner ||
    read(nft, ["NFTokenTaxon"]) !== EVENT_TAXON
  )
    return undefined;
  const ticket = readTicket(uri);
  return ticket === undefined ? undefined : { nftokenId, serial, ticket };
}

/** The event's tickets the owner holds, page after page, newest first. */
export async function readTickets(connection: Connection, owner: string): Promise<MintedTicket[]> {
  const tickets: MintedTicket[] = [];
  let marker: unknown;
  do {
    const answer = await connection.node.request("account_nfts", {
      account: owner,
      ledger_index: "validated",
      limit: NFTS_PAGE_LIMIT,
      ...(marker === undefined ? {} : { marker }),
    });
    const nfts = read(answer, ["account_nfts"]);
    if (!Array.isArray(nfts)) throw new Error("unexpected node answer: account_nfts is missing");
    for (const nft of nfts) {
      const minted = mintedTicket(nft, owner);
      if (minted !== undefined) tickets.push(minted);
    }
    marker = read(answer, ["marker"]);
  } while (marker !== undefined);
  return tickets.sort((a, b) => b.serial - a.serial);
}
