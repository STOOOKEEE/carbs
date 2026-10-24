// What the agent can do, and the transactions it needs. The agent only holds the session
// key seed: every payment is signed by that key and the ledger alone enforces the limits.

import type { XrplDefinitions } from "ripple-binary-codec";

import {
  type JsonValue,
  type SubmittedTx,
  type TxJson,
  autofill,
  read,
  signWithSeed,
  submitAndWait,
} from "../../src/ledger.ts";
import { type NodeClient, RpcError, type RpcResult } from "../../src/rpc.ts";

const DROPS_PER_XRP = 1_000_000;
/** Seconds between the Unix epoch and the XRPL epoch (2000-01-01). */
const RIPPLE_EPOCH_OFFSET_S = 946_684_800;
const MS_PER_SECOND = 1_000;
const HASH_PREFIX_LENGTH = 12;
/** The owner's errands; 12 and 15 XRP are above the default per-payment cap of 10 XRP. */
const INVOICE_LINES = [
  { label: "coffee beans", amountXrp: 4 },
  { label: "printer ink", amountXrp: 7 },
  { label: "train ticket", amountXrp: 12 },
  { label: "office plants", amountXrp: 9 },
  { label: "headphones", amountXrp: 15 },
];

export type ToolName = "get_invoices" | "get_session" | "pay" | "finish";

export function isToolName(value: unknown): value is ToolName {
  return (
    value === "get_invoices" || value === "get_session" || value === "pay" || value === "finish"
  );
}

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_invoices: "args {} — lists the invoices with id, merchant, amount in XRP and status.",
  get_session:
    "args {} — reads your signing session on the ledger: spent, cap, max per payment, seconds left.",
  pay: 'args {"invoiceId": <number>} — pays one invoice from the owner account, signed by your session key. Returns the ledger result code.',
  finish: 'args {"summary": "<text>"} — ends your work with a short summary for the owner.',
};

export type InvoiceStatus =
  { kind: "unpaid" } | { kind: "paid"; hash: string } | { kind: "refused"; result: string };

export interface Invoice {
  id: number;
  label: string;
  merchant: string;
  amountXrp: number;
  status: InvoiceStatus;
}

/** Everything the agent holds: no owner seed, only the session key seed. */
export interface AgentContext {
  node: NodeClient;
  defs: XrplDefinitions;
  owner: string;
  sessionKey: string;
  sessionSeed: string;
  invoices: Invoice[];
}

export interface ToolOutcome {
  /** Sent back to the model as the tool result. */
  forModel: JsonValue;
  /** One short line for the console. */
  line: string;
  done: boolean;
}

export interface SessionState {
  spentXrp: number;
  capXrp: number;
  maxPerTxXrp: number | undefined;
  secondsLeft: number;
}

export function xrpToDrops(xrp: number): string {
  return String(Math.round(xrp * DROPS_PER_XRP));
}

function dropsToXrp(drops: unknown): number | undefined {
  return typeof drops === "string" && /^\d+$/.test(drops)
    ? Number(drops) / DROPS_PER_XRP
    : undefined;
}

export function hashPrefix(hash: string): string {
  return `${hash.slice(0, HASH_PREFIX_LENGTH)}…`;
}

export function openSessionTx(
  owner: string,
  sessionKey: string,
  durationSeconds: number,
  capXrp: number,
  maxPerTxXrp: number,
): TxJson {
  return {
    TransactionType: "SigningSessionSet",
    Account: owner,
    SessionKey: sessionKey,
    SessionDuration: durationSeconds,
    SessionCap: xrpToDrops(capXrp),
    SessionMaxPerTx: xrpToDrops(maxPerTxXrp),
  };
}

/** Closed by the session key itself: Account is the owner, no Owner field. */
export function closeSessionTx(owner: string, sessionKey: string): TxJson {
  return { TransactionType: "SigningSessionDelete", Account: owner, SessionKey: sessionKey };
}

export function paymentTx(account: string, destination: string, amountXrp: number): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: xrpToDrops(amountXrp),
  };
}

export function makeInvoices(merchants: string[]): Invoice[] {
  return INVOICE_LINES.map(({ label, amountXrp }, index): Invoice => {
    const merchant = merchants[index % merchants.length];
    if (merchant === undefined) throw new Error("invoices need at least one merchant");
    return { id: index + 1, label, merchant, amountXrp, status: { kind: "unpaid" } };
  });
}

function describeStatus(status: InvoiceStatus): string {
  switch (status.kind) {
    case "unpaid":
      return "unpaid";
    case "paid":
      return `paid (${hashPrefix(status.hash)})`;
    case "refused":
      return `refused by the ledger (${status.result})`;
  }
}

function invoiceForModel(invoice: Invoice): JsonValue {
  return {
    id: invoice.id,
    label: invoice.label,
    merchant: invoice.merchant,
    amountXrp: invoice.amountXrp,
    status: describeStatus(invoice.status),
  };
}

/** Session key signature only, no human prompt. */
export async function submitAsSession(context: AgentContext, tx: TxJson): Promise<SubmittedTx> {
  const filled = await autofill(context.node, context.defs, tx);
  const signed = signWithSeed(context.defs, filled, context.sessionSeed);
  return submitAndWait(context.node, context.defs, signed);
}

/** The SigningSession entry in the validated ledger; undefined once it is gone. */
export async function readSession(context: AgentContext): Promise<SessionState | undefined> {
  let answer: RpcResult;
  try {
    answer = await context.node.request("ledger_entry", {
      signing_session: { account: context.owner, session_key: context.sessionKey },
      ledger_index: "validated",
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
  const capXrp = dropsToXrp(read(answer, ["node", "SessionCap"]));
  const expiration = read(answer, ["node", "Expiration"]);
  if (capXrp === undefined || typeof expiration !== "number")
    throw new Error("the signing session entry has no SessionCap or Expiration");
  const nowRippleSeconds = Math.floor(Date.now() / MS_PER_SECOND) - RIPPLE_EPOCH_OFFSET_S;
  return {
    spentXrp: dropsToXrp(read(answer, ["node", "SessionSpent"])) ?? 0,
    capXrp,
    maxPerTxXrp: dropsToXrp(read(answer, ["node", "SessionMaxPerTx"])),
    secondsLeft: Math.max(0, expiration - nowRippleSeconds),
  };
}

export function describeSession(state: SessionState | undefined): string {
  if (state === undefined) return "no open session";
  const perTx = state.maxPerTxXrp === undefined ? "none" : `${state.maxPerTxXrp} XRP`;
  return `spent ${state.spentXrp} / ${state.capXrp} XRP, max per payment ${perTx}, ${state.secondsLeft} s left`;
}

function getInvoices(context: AgentContext): ToolOutcome {
  const unpaid = context.invoices.filter((invoice) => invoice.status.kind !== "paid").length;
  return {
    forModel: context.invoices.map(invoiceForModel),
    line: `${context.invoices.length} invoices, ${unpaid} not paid`,
    done: false,
  };
}

async function getSession(context: AgentContext): Promise<ToolOutcome> {
  const state = await readSession(context);
  const forModel: JsonValue =
    state === undefined
      ? { open: false }
      : {
          open: true,
          spentXrp: state.spentXrp,
          capXrp: state.capXrp,
          remainingXrp: state.capXrp - state.spentXrp,
          maxPerPaymentXrp: state.maxPerTxXrp ?? null,
          secondsLeft: state.secondsLeft,
        };
  return { forModel, line: describeSession(state), done: false };
}

function parseInvoiceId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
}

async function pay(context: AgentContext, args: unknown): Promise<ToolOutcome> {
  const requested = read(args, ["invoiceId"]);
  const invoiceId = parseInvoiceId(requested);
  const invoice = context.invoices.find((candidate) => candidate.id === invoiceId);
  if (invoice === undefined) {
    const message = `unknown invoiceId ${JSON.stringify(requested)}`;
    return { forModel: { error: message }, line: `error: ${message}`, done: false };
  }
  if (invoice.status.kind === "paid") {
    const message = `invoice ${invoice.id} is already paid`;
    return { forModel: { error: message }, line: `error: ${message}`, done: false };
  }
  const { hash, result } = await submitAsSession(
    context,
    paymentTx(context.owner, invoice.merchant, invoice.amountXrp),
  );
  invoice.status = result === "tesSUCCESS" ? { kind: "paid", hash } : { kind: "refused", result };
  return {
    forModel: { invoiceId: invoice.id, amountXrp: invoice.amountXrp, result, hash },
    line: `${hashPrefix(hash)} ${result}`,
    done: false,
  };
}

function finish(args: unknown): ToolOutcome {
  const summary = read(args, ["summary"]);
  return {
    forModel: { finished: true },
    line: typeof summary === "string" ? summary : "",
    done: true,
  };
}

export async function runTool(
  context: AgentContext,
  tool: ToolName,
  args: unknown,
): Promise<ToolOutcome> {
  switch (tool) {
    case "get_invoices":
      return getInvoices(context);
    case "get_session":
      return getSession(context);
    case "pay":
      return pay(context, args);
    case "finish":
      return finish(args);
  }
}

export function describeInvoice(invoice: Invoice): string {
  return `#${invoice.id} ${invoice.label.padEnd(14)} ${String(invoice.amountXrp).padStart(3)} XRP  ${describeStatus(invoice.status)}`;
}
