// The AI agent's requests, decided by the human on the Stax: a mode C session budget for the
// agent's key (cap, max per payment, short expiry), or a payment above that budget. The wallet
// server only relays them; every approval is a transaction of the Stax account, read in clear
// and signed on the device (classical key, or the ML-DSA-44 root once migrated).

import type {
  AgentDecision,
  AgentRequestRecord,
  AgentRequestStatus,
  PaymentIntent,
  SessionRequest,
} from "../server/agent-requests.ts";
import type { Connection } from "./account.ts";
import {
  agentErrorText,
  approveAgentRequest,
  fetchAgentRecords,
  lastApprovedSession,
  readAgentSession,
  rejectAgentRequest,
  secondsUntil,
} from "./agent-approvals.ts";
import { agentIdOf } from "./agent-id.ts";
import { element, guarded } from "./dom.ts";
import { signAndSubmitWithStax, staxAccount } from "./ledger-panel.ts";
import { explorerLink, log, logError } from "./log.ts";
import { closeSessionTx } from "./session.ts";

const POLL_INTERVAL_MS = 2_000;
const SECONDS_PER_MINUTE = 60;
const HASH_PREFIX_LENGTH = 12;

const STATUS_LABELS: Record<AgentRequestStatus, string> = {
  pending: "pending",
  approved: "approved",
  rejected: "refused",
  failed: "failed",
};

const ui = {
  status: element("agent-status", HTMLElement),
  session: element("agent-session", HTMLElement),
  revoke: element("agent-revoke", HTMLButtonElement),
  staxHint: element("agent-stax-hint", HTMLElement),
  pending: element("agent-pending", HTMLElement),
  history: element("agent-history", HTMLOListElement),
};

/** What the page gives the panel at setup. */
interface Wiring {
  getConnection: () => Connection | undefined;
  refreshAll: () => Promise<void>;
}

let wiring: Wiring | undefined;
let records: AgentRequestRecord[] = [];
/** Requests whose decision is in progress (device prompt, submission): their buttons stay off. */
const busy = new Set<string>();
let inFlight: Promise<void> | undefined;

function logDecision(decision: AgentDecision): void {
  log(`Decision sent to the agent: request ${STATUS_LABELS[decision.status]}.`);
}

function describeDuration(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  if (minutes === 0) return `${seconds} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function describeSessionRequest(request: SessionRequest): string {
  return (
    `Budget requested by agent ${agentIdOf(request.sessionKey)}: cap ${request.capXrp} XRP, ` +
    `max ${request.maxPerTxXrp} XRP per payment, duration ${describeDuration(request.durationSeconds)}, ` +
    `purpose: "${request.purpose}", agent key ${request.sessionKey}.`
  );
}

function describePaymentIntent(request: PaymentIntent): string {
  const tag = request.destinationTag === undefined ? "" : ` (tag ${request.destinationTag})`;
  return (
    `The agent requests ${request.amountXrp} XRP for "${request.reason}" to ` +
    `${request.destination}${tag} (above its limit).`
  );
}

function describeRequest(record: AgentRequestRecord): string {
  return record.request.kind === "session"
    ? describeSessionRequest(record.request)
    : describePaymentIntent(record.request);
}

/** Signs the approval on the Stax, then reports approved or failed to the agent. */
async function approve(connection: Connection, record: AgentRequestRecord): Promise<void> {
  const stax = staxAccount();
  if (stax === undefined) throw new Error("connect the Stax in the Ledger section first");
  const { request } = record;
  log(
    request.kind === "session"
      ? `Agent session: opening the budget on the Stax${stax.postQuantum ? " (ML-DSA-44 root)" : ""}…`
      : `Payment escalated by the agent: ${request.amountXrp} XRP to ${request.destination}, sign on the Stax…`,
  );
  logDecision(
    await approveAgentRequest(record, {
      address: stax.address,
      signAndSubmit: (tx) => signAndSubmitWithStax(connection, tx, stax.postQuantum),
    }),
  );
}

async function reject(record: AgentRequestRecord): Promise<void> {
  log(`Agent request refused: ${describeRequest(record)}`);
  logDecision(await rejectAgentRequest(record));
}

/** Runs a decision with its buttons off, logs its error, then refreshes the page. */
function decide(record: AgentRequestRecord, action: () => Promise<void>): () => void {
  return guarded(
    async () => {
      if (busy.has(record.id)) return;
      busy.add(record.id);
      try {
        await action();
      } finally {
        busy.delete(record.id);
      }
    },
    logError,
    () => wiring?.refreshAll() ?? Promise.resolve(),
  );
}

function renderPending(pending: readonly AgentRequestRecord[], canSign: boolean): void {
  ui.pending.innerHTML = "";
  if (pending.length === 0) {
    ui.pending.textContent = "No pending requests.";
    return;
  }
  for (const record of pending) {
    const card = document.createElement("div");
    const text = document.createElement("p");
    text.textContent = describeRequest(record);
    const actions = document.createElement("div");
    actions.className = "actions";
    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.textContent =
      record.request.kind === "session" ? "Approve on the Stax" : "Sign on the Stax";
    approveButton.disabled = !canSign || busy.has(record.id);
    approveButton.addEventListener(
      "click",
      decide(record, async () => {
        const connection = wiring?.getConnection();
        if (connection === undefined) throw new Error("the node is not connected");
        await approve(connection, record);
      }),
    );
    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.className = "secondary";
    rejectButton.textContent = "Refuse";
    rejectButton.disabled = busy.has(record.id);
    rejectButton.addEventListener(
      "click",
      decide(record, () => reject(record)),
    );
    actions.append(approveButton, rejectButton);
    card.append(text, actions);
    ui.pending.append(card);
  }
}

function renderHistory(decided: readonly AgentRequestRecord[]): void {
  ui.history.innerHTML = "";
  for (const record of decided) {
    const item = document.createElement("li");
    item.className = record.status === "approved" ? "ok" : "error";
    const time = new Date(record.createdAt).toLocaleTimeString("en-US");
    item.append(`${time} · ${STATUS_LABELS[record.status]} · ${describeRequest(record)}`);
    if (record.txHash !== undefined) {
      item.append(
        " · ",
        explorerLink(
          `transactions/${record.txHash}`,
          `${record.txHash.slice(0, HASH_PREFIX_LENGTH)}…`,
        ),
      );
    }
    if (record.result !== undefined) item.append(` · ${record.result}`);
    if (record.note !== undefined) item.append(` · ${record.note}`);
    ui.history.append(item);
  }
}

/** The live line: spent / cap and seconds left, as the ledger stores them. */
async function renderSession(connection: Connection | undefined): Promise<void> {
  const session = lastApprovedSession(records);
  const stax = staxAccount();
  if (session === undefined) {
    ui.session.textContent = "No approved agent session.";
    ui.revoke.disabled = true;
    return;
  }
  if (connection === undefined) {
    ui.session.textContent = "Node not connected.";
    ui.revoke.disabled = true;
    return;
  }
  const state = await readAgentSession(connection, session);
  ui.revoke.disabled = state === undefined || stax?.address !== session.owner;
  if (state === undefined) {
    ui.session.textContent = `Agent session ${session.sessionKey}: closed (no entry left on the ledger).`;
    return;
  }
  const remaining = state.expiration === undefined ? undefined : secondsUntil(state.expiration);
  const time =
    remaining === undefined ? "" : remaining > 0 ? ` · expires in ${remaining} s` : " · expired";
  ui.session.textContent =
    `Agent session ${agentIdOf(session.sessionKey)} (${session.sessionKey}, account ${session.owner}): ` +
    `spent ${state.spentXrp} / ${state.capXrp ?? "?"} XRP` +
    ` · max ${state.maxPerTxXrp ?? "?"} XRP per payment${time}`;
}

async function render(connection: Connection | undefined): Promise<void> {
  try {
    records = await fetchAgentRecords();
    ui.status.textContent = `Wallet server reached · ${records.length} agent request(s).`;
  } catch (error) {
    ui.status.textContent = `Wallet server unreachable: ${agentErrorText(error)}`;
    return;
  }
  const staxConnected = staxAccount() !== undefined;
  ui.staxHint.hidden = staxConnected;
  renderPending(
    records.filter((record) => record.status === "pending"),
    staxConnected && connection !== undefined,
  );
  renderHistory(records.filter((record) => record.status !== "pending"));
  await renderSession(connection);
}

/** Reads the requests from the wallet server and the agent session from the ledger. */
export function refreshAgentPanel(connection: Connection | undefined): Promise<void> {
  inFlight ??= render(connection).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

export function setupAgentPanel(
  getConnection: () => Connection | undefined,
  refreshAll: () => Promise<void>,
): void {
  wiring = { getConnection, refreshAll };

  ui.revoke.addEventListener(
    "click",
    guarded(
      async () => {
        const connection = getConnection();
        const session = lastApprovedSession(records);
        const stax = staxAccount();
        if (connection === undefined || session === undefined) return;
        if (stax?.address !== session.owner)
          throw new Error("connect the Stax of the account that opened the agent session");
        log(
          `Cutting off the agent: SigningSessionDelete of ${session.sessionKey}, approve on the Stax…`,
        );
        const closed = await signAndSubmitWithStax(
          connection,
          closeSessionTx(session.owner, session.sessionKey),
          stax.postQuantum,
        );
        log("Agent session revoked by the Stax:", closed);
      },
      logError,
      refreshAll,
    ),
  );

  const poll = () => {
    if (document.visibilityState === "visible")
      void refreshAgentPanel(getConnection()).catch(logError);
  };
  setInterval(poll, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", poll);
}
