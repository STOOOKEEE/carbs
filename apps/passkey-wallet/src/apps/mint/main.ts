// The ticket desk (mint.html): the studio opens one minting session (Stax or Touch ID), then the
// desk's key mints alone; the ledger refuses anything but NFTokenMint and the 51st transaction,
// the Stax refuses a session beyond its minting profile.

import { DeviceError, describeLedgerError } from "@carbs/ledger";

import type { Connection } from "../../account.ts";
import { agentIdOf } from "../../agent-id.ts";
import { NODE_URL } from "../../config.ts";
import { loadDefinitions } from "../../ledger.ts";
import { NodeClient } from "../../rpc.ts";
import { logDeviceRefusal, logInfo, logResult } from "./activity.ts";
import { abuseBurn, abuseCount, abusePayment, closeOwnSession, mintTickets } from "./desk.ts";
import { readOwner, readReserve, readSessionEntry, readTickets } from "./ledger-reads.ts";
import {
  MINT_RULES,
  PROFILE_MAX_TX_COUNT,
  SESSION_DURATION_SECONDS,
  SESSION_MAX_TX_COUNT,
  type MintSession,
  type OpenedSession,
  openSession,
} from "./mint-session.ts";
import { type Owner, connectStaxOwner, macOwner } from "./owner.ts";
import { EVENT_TAXON } from "./tickets.ts";
import { type MessageTone, showMessage, ui } from "./ui.ts";
import { type PageState, render, secondsLeft, tickCountdown } from "./view.ts";

const BURST_SIZE = 20;
/** Twice what the minting profile allows: the Stax must refuse to sign it. */
const OVER_PROFILE_TX_COUNT = 2 * PROFILE_MAX_TX_COUNT;
const SECONDS_PER_MINUTE = 60;
const REFRESH_INTERVAL_MS = 2_000;
const COUNTDOWN_INTERVAL_MS = 1_000;

let connection: Connection | undefined;
let nodeProblem: string | undefined = "connecting…";
let owner: Owner | undefined;
let busy = false;
let refreshing: Promise<void> | undefined;

const state: PageState = {
  session: undefined,
  entry: undefined,
  owner: undefined,
  baseline: undefined,
  reserve: undefined,
  tickets: [],
  heldBeforeSession: undefined,
};

function requireConnection(): Connection {
  if (connection === undefined) throw new Error("the node is not connected");
  return connection;
}

function requireSession(): MintSession {
  if (state.session === undefined) throw new Error("open a session first");
  return state.session;
}

/** The Stax refused to sign because of its session policy (here: the minting profile). */
function isDevicePolicyRefusal(error: unknown): error is DeviceError {
  return error instanceof DeviceError && error.kind === "sessionPolicyRefused";
}

function showConnection(): void {
  const node = nodeProblem === undefined ? `node ${NODE_URL}` : `node: ${nodeProblem}`;
  const account = owner === undefined ? "no owner yet" : `owner ${owner.address} (${owner.label})`;
  ui.connection.textContent = `${node} · ${account}`;
  ui.connection.classList.toggle("problem", nodeProblem !== undefined);
}

function updateButtons(): void {
  const ready = connection !== undefined && !busy;
  const open = state.entry !== undefined && (secondsLeft(state) ?? 0) > 0;
  const withSession = ready && state.session !== undefined;
  ui.openStax.disabled = !ready || open;
  ui.openMac.disabled = !ready || open;
  ui.mintOne.disabled = !withSession;
  ui.mintBurst.disabled = !withSession;
  ui.abusePay.disabled = !withSession;
  ui.abuseCount.disabled = !withSession;
  ui.abuseBurn.disabled = !withSession || state.tickets.length === 0;
  ui.abuseDevice.disabled = !ready || owner?.isStax !== true;
  ui.close.disabled = !ready || state.entry === undefined;
}

async function readAll(): Promise<void> {
  if (connection === undefined) return;
  if (owner !== undefined) {
    [state.owner, state.reserve, state.tickets] = await Promise.all([
      readOwner(connection, owner.address),
      readReserve(connection),
      readTickets(connection, owner.address),
    ]);
  }
  state.entry =
    state.session === undefined
      ? undefined
      : await readSessionEntry(connection, state.session.owner, state.session.keyAddress);
}

/** Reads the ledger and redraws; a call during another one waits for it. */
function refresh(): Promise<void> {
  refreshing ??= readAll()
    .then(() => {
      if (connection !== undefined) nodeProblem = undefined;
    })
    .catch((error: unknown) => {
      nodeProblem = describeLedgerError(error);
    })
    .finally(() => {
      refreshing = undefined;
      render(state);
      updateButtons();
      showConnection();
    });
  return refreshing;
}

/**
 * A click handler: the action starts inside the click (WebHID's chooser needs its user
 * activation), its outcome goes to `target`, then the page reads the ledger again.
 */
function run(target: HTMLElement, action: () => Promise<string>): () => void {
  return () => {
    busy = true;
    updateButtons();
    const done = (text: string, tone: MessageTone) => showMessage(target, text, tone);
    action()
      .then((text) => done(text, "ok"))
      .catch((error: unknown) => done(describeLedgerError(error), "error"))
      .finally(() => {
        busy = false;
        void refresh();
      });
  };
}

/** The owner opens the minting session once; the desk's key is born here and stays in memory. */
async function openWith(signer: Owner): Promise<string> {
  const node = requireConnection();
  owner = signer;
  const [before, held] = await Promise.all([
    readOwner(node, signer.address),
    readTickets(node, signer.address),
  ]);
  showMessage(ui.ownerMessage, signer.prompt, "info");
  let opened: OpenedSession;
  try {
    opened = await openSession(signer, MINT_RULES);
  } catch (error) {
    if (!isDevicePolicyRefusal(error)) throw error;
    logDeviceRefusal("The Stax refused the minting session");
    return "Blocked by the minting profile on the Stax: nothing was signed.";
  }
  const { submitted, session } = opened;
  if (session === undefined) {
    logResult("The ledger refused to open the session", submitted);
    return `The ledger answered ${submitted.result}.`;
  }
  state.session = session;
  state.baseline = before;
  state.heldBeforeSession = new Set(held.map((minted) => minted.nftokenId));
  showMessage(ui.deskMessage, "The desk is open: mint, no prompt.", "info");
  logInfo(
    `${signer.label} opened the desk for Agent ID ${agentIdOf(session.keyAddress)}: profile minting, NFTokenMint only, ${SESSION_MAX_TX_COUNT} transactions, ${SESSION_DURATION_SECONDS / SECONDS_PER_MINUTE} min.`,
  );
  return "Approved once. From now on the desk's key signs every mint alone.";
}

/** The Stax is asked for more than its minting profile allows: it must refuse to sign. */
async function askStaxBeyondProfile(): Promise<string> {
  const node = requireConnection();
  if (owner?.isStax !== true) throw new Error("open the session with the Ledger Stax first");
  showMessage(
    ui.ownerMessage,
    `Asking the Stax for ${OVER_PROFILE_TX_COUNT} transactions (profile max ${PROFILE_MAX_TX_COUNT})…`,
    "info",
  );
  try {
    const { submitted, session } = await openSession(owner, {
      ...MINT_RULES,
      maxTxCount: OVER_PROFILE_TX_COUNT,
    });
    if (session === undefined) {
      logResult(`Session of ${OVER_PROFILE_TX_COUNT} transactions`, submitted);
      return `The ledger answered ${submitted.result}.`;
    }
    logInfo(
      `The Stax signed ${OVER_PROFILE_TX_COUNT} transactions: its firmware does not enforce the minting profile yet. That extra session is closed at once.`,
    );
    await closeOwnSession(node, session);
    return "The device did not refuse: this firmware lacks the minting profile.";
  } catch (error) {
    if (!isDevicePolicyRefusal(error)) throw error;
    logDeviceRefusal(
      `The Stax refuses ${OVER_PROFILE_TX_COUNT} transactions (minting profile: at most ${PROFILE_MAX_TX_COUNT})`,
    );
    return "Blocked on the device: nothing signed, nothing sent.";
  }
}

function setup(): void {
  ui.ruleCount.textContent = String(SESSION_MAX_TX_COUNT);
  ui.ruleDuration.textContent = `${SESSION_DURATION_SECONDS / SECONDS_PER_MINUTE} min`;
  ui.deviceCount.textContent = String(OVER_PROFILE_TX_COUNT);
  ui.taxon.textContent = String(EVENT_TAXON);
  ui.mintBurst.textContent = `Mint ${BURST_SIZE} tickets`;

  ui.openStax.addEventListener(
    "click",
    run(ui.ownerMessage, async () => {
      const node = requireConnection();
      // connectStax first, inside the click: the browser's device chooser needs it.
      const signer = owner?.isStax === true ? owner : await connectStaxOwner(node);
      return openWith(signer);
    }),
  );
  ui.openMac.addEventListener(
    "click",
    run(ui.ownerMessage, () => openWith(macOwner(requireConnection()))),
  );
  ui.close.addEventListener(
    "click",
    run(ui.ownerMessage, () => closeOwnSession(requireConnection(), requireSession())),
  );
  ui.mintOne.addEventListener(
    "click",
    run(ui.deskMessage, () => mintTickets(requireConnection(), requireSession(), 1)),
  );
  ui.mintBurst.addEventListener(
    "click",
    run(ui.deskMessage, () => mintTickets(requireConnection(), requireSession(), BURST_SIZE)),
  );
  ui.abusePay.addEventListener(
    "click",
    run(ui.deskMessage, () => abusePayment(requireConnection(), requireSession())),
  );
  ui.abuseBurn.addEventListener(
    "click",
    run(ui.deskMessage, () => abuseBurn(requireConnection(), requireSession())),
  );
  ui.abuseCount.addEventListener(
    "click",
    run(ui.deskMessage, () => abuseCount(requireConnection(), requireSession())),
  );
  ui.abuseDevice.addEventListener("click", run(ui.ownerMessage, askStaxBeyondProfile));

  setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  setInterval(() => tickCountdown(state), COUNTDOWN_INTERVAL_MS);
}

async function connect(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  connection = { node, defs: await loadDefinitions(node) };
  nodeProblem = undefined;
}

setup();
connect()
  .catch((error: unknown) => {
    nodeProblem = `unreachable (${describeLedgerError(error)})`;
  })
  .finally(() => void refresh());
