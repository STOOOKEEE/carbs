// The AI agent's requests, decided by the human on the Stax: a mode C session budget for the
// agent's key (cap, max per payment, short expiry), or a payment above that budget. The wallet
// server only relays them; every approval is a transaction of the Stax account, read in clear
// and signed on the device (classical key, or the ML-DSA-44 root once migrated).

import { describeLedgerError } from "@carbs/ledger";

import {
  AGENT_REQUESTS_PATH,
  type AgentDecision,
  type AgentRequestRecord,
  type AgentRequestStatus,
  MAX_TEXT_LENGTH,
  type PaymentIntent,
  type SessionRequest,
  isAgentRequestRecord,
} from "../server/agent-requests.ts";
import type { Connection } from "./account.ts";
import { element, guarded } from "./dom.ts";
import { type SubmittedTx, read } from "./ledger.ts";
import { signAndSubmitWithStax, staxAccount } from "./ledger-panel.ts";
import { explorerLink, log, logError } from "./log.ts";
import { RpcError, type RpcResult } from "./rpc.ts";
import { closeSessionTx, openSessionTx, paymentTx } from "./session.ts";

const POLL_INTERVAL_MS = 2_000;
const DROPS_PER_XRP = 1_000_000;
/** Seconds between the Unix epoch and the XRPL epoch (2000-01-01). */
const RIPPLE_EPOCH_OFFSET_S = 946_684_800;
const SECONDS_PER_MINUTE = 60;
const HASH_PREFIX_LENGTH = 12;

const STATUS_LABELS: Record<AgentRequestStatus, string> = {
  pending: "en attente",
  approved: "approuvée",
  rejected: "refusée",
  failed: "échouée",
};

const ui = {
  status: element("agent-status", HTMLElement),
  session: element("agent-session", HTMLElement),
  revoke: element("agent-revoke", HTMLButtonElement),
  staxHint: element("agent-stax-hint", HTMLElement),
  pending: element("agent-pending", HTMLElement),
  history: element("agent-history", HTMLOListElement),
};

/** The agent session the human approved last: the owner account and the agent's key. */
interface AgentSession {
  owner: string;
  sessionKey: string;
}

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

async function fetchRecords(): Promise<AgentRequestRecord[]> {
  const answer = await fetch(AGENT_REQUESTS_PATH);
  if (!answer.ok) throw new Error(`wallet server: HTTP ${answer.status} on ${AGENT_REQUESTS_PATH}`);
  const body: unknown = await answer.json();
  if (!Array.isArray(body) || !body.every(isAgentRequestRecord))
    throw new Error("wallet server: unexpected agent requests answer");
  return body;
}

async function postDecision(id: string, decision: AgentDecision): Promise<void> {
  const answer = await fetch(`${AGENT_REQUESTS_PATH}/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (!answer.ok) {
    const body: unknown = await answer.json();
    const reason = read(body, ["error"]);
    throw new Error(
      `wallet server refused the decision: ${typeof reason === "string" ? reason : `HTTP ${answer.status}`}`,
    );
  }
  log(`Décision transmise à l'agent : demande ${STATUS_LABELS[decision.status]}.`);
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : describeLedgerError(error);
  return (message.trim() === "" ? "unknown error" : message).slice(0, MAX_TEXT_LENGTH);
}

function lastApprovedSession(): AgentSession | undefined {
  const record = records.find(
    (candidate) =>
      candidate.request.kind === "session" &&
      candidate.status === "approved" &&
      candidate.owner !== undefined,
  );
  if (record?.owner === undefined) return undefined;
  return { owner: record.owner, sessionKey: record.request.sessionKey };
}

/** The session's ledger entry; undefined once it is gone (revoked or closed). */
async function sessionEntry(
  connection: Connection,
  session: AgentSession,
): Promise<RpcResult | undefined> {
  try {
    return await connection.node.request("ledger_entry", {
      signing_session: { account: session.owner, session_key: session.sessionKey },
    });
  } catch (error) {
    if (error instanceof RpcError && error.code === "entryNotFound") return undefined;
    throw error;
  }
}

function xrp(drops: unknown): string {
  return typeof drops === "string" ? `${Number(drops) / DROPS_PER_XRP}` : "?";
}

function describeDuration(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  if (minutes === 0) return `${seconds} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

function describeSessionRequest(request: SessionRequest): string {
  return (
    `Budget demandé par l'agent : plafond ${request.capXrp} XRP, ` +
    `max ${request.maxPerTxXrp} XRP par paiement, durée ${describeDuration(request.durationSeconds)}, ` +
    `but : « ${request.purpose} », clé de l'agent ${request.sessionKey}.`
  );
}

function describePaymentIntent(request: PaymentIntent): string {
  const tag = request.destinationTag === undefined ? "" : ` (tag ${request.destinationTag})`;
  return (
    `L'agent demande ${request.amountXrp} XRP pour « ${request.reason} » vers ` +
    `${request.destination}${tag} (au-dessus de sa limite).`
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
  const tx =
    request.kind === "session"
      ? openSessionTx(stax.address, request.sessionKey, {
          mode: "cap",
          capXrp: request.capXrp,
          maxPerTxXrp: request.maxPerTxXrp,
          durationSeconds: request.durationSeconds,
        })
      : {
          ...paymentTx(stax.address, request.destination, request.amountXrp),
          ...(request.destinationTag === undefined
            ? {}
            : { DestinationTag: request.destinationTag }),
        };
  log(
    request.kind === "session"
      ? `Session de l'agent : ouverture du budget sur la Stax${stax.postQuantum ? " (racine ML-DSA-44)" : ""}…`
      : `Paiement escaladé par l'agent : ${request.amountXrp} XRP vers ${request.destination}, signez sur la Stax…`,
  );
  let submitted: SubmittedTx;
  try {
    submitted = await signAndSubmitWithStax(connection, tx, stax.postQuantum);
  } catch (error) {
    // The device refusal (or any signing error) is reported to the agent, then to the journal.
    await postDecision(record.id, {
      status: "failed",
      owner: stax.address,
      note: errorText(error),
    }).catch(logError);
    throw error;
  }
  await postDecision(record.id, {
    status: submitted.result === "tesSUCCESS" ? "approved" : "failed",
    owner: stax.address,
    txHash: submitted.hash,
    result: submitted.result,
  });
}

async function reject(record: AgentRequestRecord): Promise<void> {
  log(`Demande de l'agent refusée : ${describeRequest(record)}`);
  await postDecision(record.id, { status: "rejected", note: "refused by the owner" });
}

/** Runs a decision with its buttons off, logs its error, then refreshes the page. */
function decide(record: AgentRequestRecord, action: () => Promise<void>): () => void {
  return guarded(
    async () => {
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
    ui.pending.textContent = "Aucune demande en attente.";
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
      record.request.kind === "session" ? "Approuver sur la Stax" : "Signer sur la Stax";
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
    rejectButton.textContent = "Refuser";
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
    const time = new Date(record.createdAt).toLocaleTimeString("fr-FR");
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
  const session = lastApprovedSession();
  const stax = staxAccount();
  if (session === undefined) {
    ui.session.textContent = "Aucune session d'agent approuvée.";
    ui.revoke.disabled = true;
    return;
  }
  if (connection === undefined) {
    ui.session.textContent = "Nœud non connecté.";
    ui.revoke.disabled = true;
    return;
  }
  const entry = await sessionEntry(connection, session);
  const node = read(entry, ["node"]);
  ui.revoke.disabled = node === undefined || stax?.address !== session.owner;
  if (node === undefined) {
    ui.session.textContent = `Session de l'agent ${session.sessionKey} : fermée (plus d'entrée sur le ledger).`;
    return;
  }
  const expiration = read(node, ["Expiration"]);
  const remaining =
    typeof expiration === "number"
      ? expiration - (Math.floor(Date.now() / 1000) - RIPPLE_EPOCH_OFFSET_S)
      : undefined;
  const time =
    remaining === undefined ? "" : remaining > 0 ? ` · expire dans ${remaining} s` : " · expirée";
  ui.session.textContent =
    `Session de l'agent ${session.sessionKey} (compte ${session.owner}) : ` +
    `dépensé ${xrp(read(node, ["SessionSpent"]))} / ${xrp(read(node, ["SessionCap"]))} XRP` +
    ` · max ${xrp(read(node, ["SessionMaxPerTx"]))} XRP par paiement${time}`;
}

async function render(connection: Connection | undefined): Promise<void> {
  try {
    records = await fetchRecords();
    ui.status.textContent = `Serveur du wallet joint · ${records.length} demande(s) de l'agent.`;
  } catch (error) {
    ui.status.textContent = `Serveur du wallet injoignable : ${errorText(error)}`;
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
        const session = lastApprovedSession();
        const stax = staxAccount();
        if (connection === undefined || session === undefined) return;
        if (stax?.address !== session.owner)
          throw new Error("connect the Stax of the account that opened the agent session");
        log(`Couper l'agent : SigningSessionDelete de ${session.sessionKey}, validez sur la Stax…`);
        const closed = await signAndSubmitWithStax(
          connection,
          closeSessionTx(session.owner, session.sessionKey),
          stax.postQuantum,
        );
        log("Session de l'agent révoquée par la Stax :", closed);
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
