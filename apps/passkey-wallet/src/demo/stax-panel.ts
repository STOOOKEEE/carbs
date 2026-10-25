// The right column: the Stax (connect, account, post-quantum root) and the agent's requests
// waiting for the human, approved on the device or refused (shared logic: agent-approvals.ts).

import type {
  AgentRequestRecord,
  PaymentIntent,
  SessionRequest,
} from "../../server/agent-requests.ts";
import type { Connection } from "../account.ts";
import {
  DevicePolicyRefusal,
  agentErrorText,
  approveAgentRequest,
  intentMemoText,
  rejectAgentRequest,
} from "../agent-approvals.ts";
import { agentIdOf } from "../agent-id.ts";
import { guarded } from "../dom.ts";
import {
  type Stax,
  accountState,
  connectStax,
  isPostQuantumRoot,
  submitSignedByStax,
} from "../stax.ts";
import { ui } from "./ui.ts";

const SECONDS_PER_MINUTE = 60;
const ADDRESS_PREFIX_LENGTH = 8;

type MessageTone = "info" | "ok" | "device" | "error";

/** What the page gives the panel at setup. */
interface Wiring {
  getConnection: () => Connection | undefined;
  refreshAll: () => Promise<void>;
}

let wiring: Wiring | undefined;
let stax: Stax | undefined;
let postQuantum = false;
/** Requests whose decision is in progress: their buttons stay off. */
const busy = new Set<string>();
/** What the pending list shows, to redraw it only when it changes. */
let renderedKey = "";

function shortAddress(address: string): string {
  return `${address.slice(0, ADDRESS_PREFIX_LENGTH)}…`;
}

function showMessage(text: string, tone: MessageTone): void {
  ui.staxMessage.hidden = false;
  ui.staxMessage.textContent = text;
  ui.staxMessage.className = `stax-message message-${tone}`;
}

function showError(error: unknown): void {
  if (error instanceof DevicePolicyRefusal) showMessage(error.message, "device");
  else showMessage(agentErrorText(error), "error");
}

function line(className: string, text: string): HTMLParagraphElement {
  const node = document.createElement("p");
  node.className = className;
  node.textContent = text;
  return node;
}

function sessionCard(request: SessionRequest): HTMLElement[] {
  const minutes = request.durationSeconds / SECONDS_PER_MINUTE;
  return [
    line("card-title", "The agent asks for a budget"),
    line("card-agent-id", `Agent ID ${agentIdOf(request.sessionKey)}`),
    line(
      "card-facts",
      `${request.capXrp} XRP total · ${request.maxPerTxXrp} XRP per payment · ${minutes} min`,
    ),
  ];
}

function paymentCard(request: PaymentIntent): HTMLElement[] {
  return [
    line("card-title", "Over-limit purchase: your signature"),
    line("card-amount", `${request.amountXrp} XRP`),
    line("card-facts", `To ${shortAddress(request.destination)}`),
    line("card-memo", `Agent says: ${intentMemoText(request)} (not verified)`),
  ];
}

async function approve(record: AgentRequestRecord): Promise<void> {
  const connection = wiring?.getConnection();
  const device = stax;
  if (connection === undefined) throw new Error("the node is not connected");
  if (device === undefined) throw new Error("connect the Stax first");
  showMessage(`Review it on the Stax and sign${postQuantum ? " (ML-DSA-44 root)" : ""}…`, "info");
  const decision = await approveAgentRequest(record, {
    address: device.account.address,
    signAndSubmit: (tx) => submitSignedByStax(connection, device, tx, postQuantum),
  });
  showMessage(
    decision.status === "approved"
      ? `Signed on the Stax: ${decision.result ?? "tesSUCCESS"}`
      : `Submitted, but the ledger answered ${decision.result ?? "an error"}`,
    decision.status === "approved" ? "ok" : "error",
  );
}

async function refuse(record: AgentRequestRecord): Promise<void> {
  await rejectAgentRequest(record);
  showMessage("Refused: the agent is told no.", "info");
}

/** Runs a decision with its buttons off, shows its error, then refreshes the page. */
function decide(record: AgentRequestRecord, action: () => Promise<void>): () => void {
  return guarded(
    async () => {
      busy.add(record.id);
      renderedKey = "";
      try {
        await action();
      } finally {
        busy.delete(record.id);
      }
    },
    showError,
    () => wiring?.refreshAll() ?? Promise.resolve(),
  );
}

function button(
  text: string,
  className: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  node.disabled = disabled;
  node.addEventListener("click", onClick);
  return node;
}

function renderPending(pending: readonly AgentRequestRecord[], canSign: boolean): void {
  const key = JSON.stringify([pending.map((record) => record.id), [...busy], canSign]);
  if (key === renderedKey) return;
  renderedKey = key;
  ui.pending.innerHTML = "";
  if (pending.length === 0) {
    ui.pending.append(line("pending-empty", "Nothing waiting for you."));
    return;
  }
  for (const record of pending) {
    const card = document.createElement("article");
    card.className = `card card-${record.request.kind}`;
    card.append(
      ...(record.request.kind === "session"
        ? sessionCard(record.request)
        : paymentCard(record.request)),
    );
    const actions = document.createElement("div");
    actions.className = "card-actions";
    const isBusy = busy.has(record.id);
    actions.append(
      button(
        "Approve on Stax",
        "primary",
        !canSign || isBusy,
        decide(record, () => approve(record)),
      ),
      button(
        "Refuse",
        "secondary",
        isBusy,
        decide(record, () => refuse(record)),
      ),
    );
    card.append(actions);
    ui.pending.append(card);
  }
}

async function renderDevice(connection: Connection | undefined): Promise<void> {
  ui.staxConnect.hidden = stax !== undefined;
  ui.staxConnect.disabled = connection === undefined;
  if (stax === undefined) {
    ui.staxStatus.textContent = "Not connected (Chrome or Edge, XRP app open).";
    showRootKey("Ledger Stax not connected", false);
    return;
  }
  if (connection === undefined) return;
  const state = await accountState(connection, stax.account.address);
  postQuantum = isPostQuantumRoot(stax, state);
  const funded = state === undefined ? "not funded" : state.balance;
  ui.staxStatus.textContent = `${shortAddress(stax.account.address)} · ${funded} · ${
    postQuantum ? "signs with its ML-DSA-44 root" : "classical key (not migrated)"
  }`;
  ui.staxStatus.classList.toggle("post-quantum", postQuantum);
  showRootKey(
    postQuantum
      ? "root key ML-DSA-44 on Ledger Stax"
      : "root key on Ledger Stax (classical, not migrated)",
    postQuantum,
  );
}

/** The header subtitle: the ML-DSA-44 claim only for a migrated account. */
function showRootKey(text: string, postQuantumRoot: boolean): void {
  ui.rootKey.textContent = text;
  ui.rootKey.classList.toggle("root-muted", !postQuantumRoot);
}

/** Redraws the device line and the requests waiting for the human. */
export async function refreshStaxPanel(
  connection: Connection | undefined,
  records: readonly AgentRequestRecord[],
): Promise<void> {
  await renderDevice(connection);
  renderPending(
    records.filter((record) => record.status === "pending"),
    stax !== undefined && connection !== undefined,
  );
}

export function setupStaxPanel(
  getConnection: () => Connection | undefined,
  refreshAll: () => Promise<void>,
): void {
  wiring = { getConnection, refreshAll };
  ui.staxConnect.addEventListener(
    "click",
    guarded(
      async () => {
        showMessage("Choose the Stax in the browser window…", "info");
        stax = await connectStax();
        renderedKey = "";
        showMessage("Stax connected.", "ok");
      },
      showError,
      refreshAll,
    ),
  );
}
