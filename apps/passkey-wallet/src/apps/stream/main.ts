// Pay-as-you-go streaming (stream.html): the owner opens one session (profile "streaming",
// on the Stax or with Touch ID), then the session key pays the provider 0.005 XRP every 3 s
// while playing, with no prompt. The provider reads the payments on the ledger and cuts the
// stream when they stop; the ledger refuses anything beyond the session's limits.

import { DeviceError } from "@carbs/ledger";

import type { Connection } from "../../account.ts";
import { agentErrorText } from "../../agent-approvals.ts";
import { NODE_URL } from "../../config.ts";
import { guarded } from "../../dom.ts";
import { loadDefinitions } from "../../ledger.ts";
import { NodeClient } from "../../rpc.ts";
import { closeSessionTx, openSessionTx, paymentTx } from "../../session.ts";
import {
  ABUSE_PAYMENT_XRP,
  CAP_XRP,
  DEVICE_ABUSE_CAP_XRP,
  MAX_PER_PAYMENT_XRP,
  MAX_TX_COUNT,
  PAY_INTERVAL_MS,
  PRICE_XRP,
  STREAM_RULES,
} from "./config.ts";
import { passkeyOwner, staxOwner } from "./owner.ts";
import { fetchAccess, fetchProviderAddress } from "./provider.ts";
import { DEVICE_PROFILE_CODE, addRefusal, showMessage } from "./refusals.ts";
import {
  type StreamSession,
  currentLedger,
  newSessionKey,
  readSessionEntry,
  sendAndWait,
  sendNow,
} from "./session-key.ts";
import { isActive, state } from "./state.ts";
import { ui } from "./ui.ts";
import { render } from "./view.ts";

const TICK_MS = 1_000;
const LEDGER_POLL_MS = 2_000;
const ACCESS_POLL_MS = 1_500;
const SUCCESS = "tesSUCCESS";
const LIMIT = "tefSESSION_LIMIT";
const EXPIRED = "tefSESSION_EXPIRED";
/** While fast-forwarding, the page redraws every this many payments. */
const FAST_FORWARD_RENDER_EVERY = 10;
const OWNER_READY = "Owner ready: open the session.";

let connection: Connection | undefined;
/** The meter's payment in flight, so that pause, close and fast-forward wait for it. */
let payment: Promise<void> | undefined;
let fastForwarding = false;
let readingLedger = false;
let readingAccess = false;

function requireConnection(): Connection {
  if (connection === undefined) throw new Error("the node is not connected");
  return connection;
}

function requireSession(): { session: StreamSession; provider: string } {
  if (state.session === undefined || !isActive(state)) throw new Error("open a session first");
  if (state.provider === undefined) throw new Error("the provider is not reached");
  return { session: state.session, provider: state.provider };
}

/** The Stax refused to sign because the opening goes beyond its streaming profile. */
function isProfileRefusal(error: unknown): boolean {
  return error instanceof DeviceError && error.kind === "sessionPolicyRefused";
}

/** Why the stream stops for good when the ledger refuses one of the meter's payments. */
function endReasonFor(code: string): string {
  if (code === LIMIT)
    return `The ledger stopped the stream: the session's ${CAP_XRP} XRP is spent (${LIMIT}).`;
  if (code === EXPIRED)
    return `The 10-minute session is over: the ledger refuses the key (${EXPIRED}).`;
  return `The ledger refused the payment (${code}): the stream stops.`;
}

/** Runs an owner action or an abuse attempt with the buttons off, and shows its error. */
function action(run: () => Promise<void>): (event?: Event) => void {
  return guarded(
    async () => {
      if (state.busy) return;
      state.busy = true;
      render(state);
      try {
        await run();
      } finally {
        state.busy = false;
      }
    },
    (error) => showMessage(agentErrorText(error), "error"),
    async () => render(state),
  );
}

/** One meter payment: the session key pays the provider, no prompt. */
async function payOnce(session: StreamSession, provider: string): Promise<void> {
  const attempt = `payment #${state.sentPayments + 1}: ${PRICE_XRP} XRP`;
  const { result } = await sendNow(
    requireConnection(),
    session,
    paymentTx(session.owner, provider, PRICE_XRP),
  );
  if (result === SUCCESS) {
    state.sentPayments += 1;
    return;
  }
  addRefusal("ledger", result, attempt);
  state.wantsToPlay = false;
  state.endReason = endReasonFor(result);
}

/** Every PAY_INTERVAL_MS while playing; skipped while a payment is in flight. */
function meterTick(): void {
  if (!state.wantsToPlay || payment !== undefined || fastForwarding || !isActive(state)) return;
  const { session, provider } = requireSession();
  payment = payOnce(session, provider)
    .catch((error: unknown) => showMessage(agentErrorText(error), "error"))
    .finally(() => {
      payment = undefined;
      render(state);
    });
}

async function stopPaying(): Promise<void> {
  state.wantsToPlay = false;
  await payment;
}

async function readLedger(): Promise<void> {
  const session = state.session;
  if (connection === undefined || session === undefined || state.sessionOver || readingLedger)
    return;
  readingLedger = true;
  try {
    const entry = await readSessionEntry(connection, session.owner, session.keyAddress);
    if (state.session !== session) return;
    if (entry === undefined) {
      state.sessionOver = true;
      state.wantsToPlay = false;
      state.endReason ??= "Session closed: no entry left on the ledger.";
      return;
    }
    state.entry = entry;
  } finally {
    readingLedger = false;
  }
}

/** The provider's verdict; once the session is closed and the stream cut, it cannot change. */
async function readAccess(): Promise<void> {
  const session = state.session;
  const finalVerdict = state.sessionOver && state.access?.granted === false;
  if (session === undefined || readingAccess || finalVerdict) return;
  readingAccess = true;
  try {
    const access = await fetchAccess(session.owner, session.sinceLedger);
    if (state.session === session) state.access = access;
  } finally {
    readingAccess = false;
  }
}

function poll(read: () => Promise<void>): void {
  read()
    .then(() => {
      if (connection !== undefined && state.provider !== undefined) state.problem = undefined;
    })
    .catch((error: unknown) => {
      state.problem = agentErrorText(error);
    })
    .finally(() => render(state));
}

async function openSession(): Promise<void> {
  const conn = requireConnection();
  const owner = state.owner;
  if (owner === undefined) throw new Error("choose the owner first");
  const sinceLedger = await currentLedger(conn);
  const { keySeed, keyAddress } = newSessionKey();
  showMessage(owner.prompt, "info");
  let result: string;
  try {
    ({ result } = await owner.signAndSubmit(
      openSessionTx(owner.address, keyAddress, STREAM_RULES),
    ));
  } catch (error) {
    if (!isProfileRefusal(error)) throw error;
    addRefusal("device", DEVICE_PROFILE_CODE, "the streaming session");
    showMessage("The Stax refused the opening: beyond its streaming profile.", "device");
    return;
  }
  if (result !== SUCCESS) {
    showMessage(`The ledger refused the opening: ${result}`, "error");
    return;
  }
  state.session = { owner: owner.address, keySeed, keyAddress, sinceLedger };
  state.sessionOver = false;
  state.endReason = undefined;
  state.wantsToPlay = false;
  state.sentPayments = 0;
  state.entry = undefined;
  state.access = undefined;
  state.watchedSeconds = 0;
  showMessage("Session open. Press Play: from here the session key pays alone.", "ok");
  await readLedger();
}

/** Abuse 1: one payment far above the per-payment limit. Expected: tefSESSION_LIMIT. */
async function payTooMuch(): Promise<void> {
  const { session, provider } = requireSession();
  const { result } = await sendNow(
    requireConnection(),
    session,
    paymentTx(session.owner, provider, ABUSE_PAYMENT_XRP),
  );
  if (result === SUCCESS) {
    showMessage(
      `The ledger accepted ${ABUSE_PAYMENT_XRP} XRP: the per-payment limit did not hold.`,
      "error",
    );
    return;
  }
  addRefusal(
    "ledger",
    result,
    `one payment of ${ABUSE_PAYMENT_XRP} XRP (max ${MAX_PER_PAYMENT_XRP})`,
  );
  showMessage(`${ABUSE_PAYMENT_XRP} XRP at once → ${result}. The stream goes on.`, "ok");
}

/**
 * Abuse 2: keep streaming until the cap, fast. The same 0.005 XRP payments, sent back to back
 * instead of one per ledger, until the ledger refuses one: tefSESSION_LIMIT stops the stream.
 */
async function fastForward(): Promise<void> {
  const { session, provider } = requireSession();
  const conn = requireConnection();
  await stopPaying();
  state.wantsToPlay = true;
  fastForwarding = true;
  showMessage(
    `Fast-forward: ${PRICE_XRP} XRP payments back to back until the ledger says no…`,
    "info",
  );
  try {
    const firstPayment = state.sentPayments;
    for (let sent = 0; sent < MAX_TX_COUNT; sent++) {
      const attempt = `payment #${state.sentPayments + 1}: ${PRICE_XRP} XRP`;
      const { result } = await sendNow(
        conn,
        session,
        paymentTx(session.owner, provider, PRICE_XRP),
      );
      if (result === SUCCESS) {
        state.sentPayments += 1;
        if (sent % FAST_FORWARD_RENDER_EVERY === 0) render(state);
        continue;
      }
      addRefusal("ledger", result, attempt);
      state.wantsToPlay = false;
      state.endReason = endReasonFor(result);
      showMessage(
        `${state.sentPayments - firstPayment} more payments, then ${result}: the stream stopped by itself.`,
        result === LIMIT ? "ok" : "error",
      );
      return;
    }
    showMessage(`${MAX_TX_COUNT} payments and no refusal: the cap did not hold.`, "error");
  } finally {
    fastForwarding = false;
  }
}

/** Abuse 3: a streaming session worth more than a coffee. Expected: refused on the Stax. */
async function askDeviceForMore(): Promise<void> {
  const conn = requireConnection();
  const owner = state.owner;
  if (owner?.kind !== "stax") throw new Error("connect the Stax first");
  const { keySeed, keyAddress } = newSessionKey();
  showMessage(`Asking the Stax for a ${DEVICE_ABUSE_CAP_XRP} XRP streaming session…`, "info");
  let result: string;
  try {
    ({ result } = await owner.signAndSubmit(
      openSessionTx(owner.address, keyAddress, { ...STREAM_RULES, capXrp: DEVICE_ABUSE_CAP_XRP }),
    ));
  } catch (error) {
    if (!isProfileRefusal(error)) throw error;
    addRefusal("device", DEVICE_PROFILE_CODE, `a ${DEVICE_ABUSE_CAP_XRP} XRP streaming session`);
    showMessage("The Stax refused: a streaming session never holds more than 2 XRP.", "device");
    return;
  }
  if (result !== SUCCESS) {
    showMessage(`The ledger answered ${result}`, "error");
    return;
  }
  // A firmware without the streaming profile signed it: the key closes it at once.
  await sendAndWait(
    conn,
    { owner: owner.address, keySeed },
    closeSessionTx(owner.address, keyAddress),
  );
  showMessage(
    `This Stax signed a ${DEVICE_ABUSE_CAP_XRP} XRP session (its firmware has no streaming profile); it was closed at once.`,
    "error",
  );
}

/** The session key closes its own session (no Owner field): nothing more can be paid. */
async function closeSession(): Promise<void> {
  const { session } = requireSession();
  await stopPaying();
  const { result } = await sendAndWait(
    requireConnection(),
    session,
    closeSessionTx(session.owner, session.keyAddress),
  );
  if (result !== SUCCESS) {
    showMessage(`The ledger refused the close: ${result}`, "error");
    return;
  }
  state.sessionOver = true;
  state.endReason = "Session closed by its own key: nothing more can be paid.";
  showMessage("Session closed: the key is now useless.", "ok");
}

ui.connectStax.addEventListener(
  "click",
  action(async () => {
    // connectStax() first, inside the click: WebHID's device chooser needs its activation.
    state.owner = await staxOwner(requireConnection());
    showMessage(OWNER_READY, "ok");
  }),
);
ui.usePasskey.addEventListener(
  "click",
  action(async () => {
    state.owner = passkeyOwner(requireConnection());
    showMessage(OWNER_READY, "ok");
  }),
);
ui.open.addEventListener("click", action(openSession));
ui.play.addEventListener("click", () => {
  state.wantsToPlay = true;
  meterTick();
  render(state);
});
ui.pause.addEventListener("click", () => {
  state.wantsToPlay = false;
  render(state);
});
ui.abuseBig.addEventListener("click", action(payTooMuch));
ui.abuseBinge.addEventListener("click", action(fastForward));
ui.abuseDevice.addEventListener("click", action(askDeviceForMore));
ui.close.addEventListener("click", action(closeSession));

setInterval(meterTick, PAY_INTERVAL_MS);
setInterval(() => poll(readLedger), LEDGER_POLL_MS);
setInterval(() => poll(readAccess), ACCESS_POLL_MS);
setInterval(() => {
  if (state.wantsToPlay && state.access?.granted === true) state.watchedSeconds += 1;
  render(state);
}, TICK_MS);

async function connect(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  connection = { node, defs: await loadDefinitions(node) };
  state.connected = true;
  state.provider = await fetchProviderAddress();
  state.problem = undefined;
}

render(state);
connect()
  .catch((error: unknown) => {
    state.problem = `unreachable: ${agentErrorText(error)}`;
  })
  .finally(() => render(state));
