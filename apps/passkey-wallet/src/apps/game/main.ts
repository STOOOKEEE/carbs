// Hash Blaster (game.html): the owner opens one "game" session (Ledger Stax or Touch ID), then
// every shot is a Payment signed by the session key alone, submitted without waiting for the
// ledger. The ledger refuses what the session does not allow; the Stax refuses an opening
// beyond its "game" profile.

import { DeviceError } from "@carbs/ledger";
import { generateSeed } from "ripple-keypairs";

import type { Connection } from "../../account.ts";
import { secondsUntil } from "../../agent-approvals.ts";
import { agentIdOf } from "../../agent-id.ts";
import { NODE_URL } from "../../config.ts";
import { guarded } from "../../dom.ts";
import { addressOfSeed, loadDefinitions } from "../../ledger.ts";
import { NodeClient } from "../../rpc.ts";
import { closeSessionTx, openSessionTx } from "../../session.ts";
import { fetchHouse } from "./api.ts";
import { autoAim, bulletMark, setArenaActive, setupArena, showBanner } from "./arena.ts";
import { sessionGun } from "./gun.ts";
import { type Owner, staxOwner, touchIdOwner } from "./owner.ts";
import { formatXrp, renderSession, resetGrid, showSessionState, tickCountdown } from "./panel.ts";
import { DEVICE_POLICY_CODE, explainRefusal, showRefusal } from "./refusals.ts";
import {
  ABUSE_BET_XRP,
  DUCK,
  GAME_SESSION,
  GOLDEN_DUCK,
  GREEDY_GAME_SESSION,
  type GameSessionRules,
  type Target,
} from "./rules.ts";
import { type GameSessionState, readGameSession } from "./session-entry.ts";
import { type Play, fireShot, reportRefusal } from "./shots.ts";
import { type Tracker, ledgerTracker } from "./tracker.ts";
import { ui } from "./ui.ts";
import { isAccepted } from "./xrpl.ts";

const REFRESH_INTERVAL_MS = 1_000;
const COUNTDOWN_INTERVAL_MS = 1_000;
/** Pause between two auto-clicker shots: about 25 shots a second, far faster than a human. */
const AUTO_CLICK_INTERVAL_MS = 40;
const SECONDS_PER_MINUTE = 60;
const SUCCESS = "tesSUCCESS";

type MessageTone = "info" | "ok" | "error";
type Phase = "none" | "open" | "expired" | "gone";

interface SessionKey {
  seed: string;
  address: string;
}

let connection: { client: Connection; tracker: Tracker } | undefined;
let nodeProblem: string | undefined = "connecting…";
let house: Promise<string> | undefined;
let houseAddress: string | undefined;
let sessionKey = newSessionKey();
let play: Play | undefined;
let phase: Phase = "none";
let busy = false;
let autoClicking = false;
let refreshing: Promise<void> | undefined;

function newSessionKey(): SessionKey {
  const seed = generateSeed({ algorithm: "ecdsa-secp256k1" });
  const address = addressOfSeed(seed);
  ui.agentId.textContent = agentIdOf(address);
  return { seed, address };
}

/** The house account (server/game.ts); asked again after a failure. */
function houseAccount(): Promise<string> {
  house ??= fetchHouse().then(
    (address) => {
      houseAddress = address;
      showConnection();
      return address;
    },
    (error: unknown) => {
      house = undefined;
      throw error;
    },
  );
  return house;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showMessage(text: string, tone: MessageTone): void {
  ui.message.textContent = text;
  ui.message.className = `game-message message-${tone}`;
  ui.message.hidden = false;
}

function showError(error: unknown): void {
  showMessage(errorText(error), "error");
}

function showConnection(): void {
  const node = nodeProblem === undefined ? `node ${NODE_URL}` : `node: ${nodeProblem}`;
  const houseText = houseAddress === undefined ? "house: waiting" : `house ${houseAddress}`;
  ui.connection.textContent = `${node} · ${houseText}`;
  ui.connection.classList.toggle("problem", nodeProblem !== undefined);
}

function renderButtons(): void {
  const canOpen = connection !== undefined && !busy && phase !== "open";
  ui.openStax.disabled = !canOpen;
  ui.openTouchId.disabled = !canOpen;
  ui.openGreedy.disabled = !canOpen;
  const isOpen = play !== undefined && phase === "open";
  ui.abuseBet.disabled = !isOpen || autoClicking;
  ui.abuseAuto.disabled = !isOpen;
  ui.abuseAuto.textContent = autoClicking ? "Stop the auto-clicker" : "Auto-clicker";
  ui.close.disabled = !isOpen || busy;
}

function phaseOf(state: GameSessionState | undefined): Phase {
  if (state === undefined) return "gone";
  return state.expiration === undefined || secondsUntil(state.expiration) > 0 ? "open" : "expired";
}

/** The game's session on the ledger, and what the page allows from it. */
async function refreshSession(client: Connection, current: Play): Promise<void> {
  const state = await readGameSession(client, current.owner, current.sessionKey);
  if (play !== current) return;
  renderSession(state);
  phase = phaseOf(state);
  setArenaActive(phase === "open");
  if (phase !== "open") autoClicking = false;
  const countUsedUp = state?.maxTxCount !== undefined && state.txCount >= state.maxTxCount;
  if (phase === "open" && countUsedUp)
    showSessionState(
      "Tx count used up: the ledger refuses every new shot. The game key can still close it.",
      "over",
    );
  else if (phase === "open")
    showSessionState("Session open: the game key signs every shot, no prompt.", "open");
  else if (phase === "expired")
    showSessionState("Session expired: the ledger refuses the game key.", "over");
  else showSessionState("Session closed: no entry left, the game key signs nothing.", "over");
}

async function render(): Promise<void> {
  if (connection !== undefined) {
    try {
      await connection.tracker.poll();
      if (play !== undefined) await refreshSession(connection.client, play);
      nodeProblem = undefined;
    } catch (error) {
      nodeProblem = errorText(error);
    }
  }
  renderButtons();
  showConnection();
}

function refresh(): Promise<void> {
  refreshing ??= render().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

function requireConnection(): { client: Connection; tracker: Tracker } {
  if (connection === undefined) throw new Error("the node is not connected yet");
  return connection;
}

/** What the owner checks on the device: profile, limits, Agent ID. */
function rulesText(rules: GameSessionRules): string {
  return `Profile: Game · cap ${rules.capXrp} XRP · ${rules.maxPerTxXrp} XRP per payment · ${rules.maxTxCount} tx · ${rules.durationSeconds / SECONDS_PER_MINUTE} min`;
}

/** Signs the opening; false when the Stax or the ledger refused it (shown in the footer). */
async function signOpening(owner: Owner, rules: GameSessionRules): Promise<boolean> {
  try {
    const submitted = await owner.signAndSubmit(
      openSessionTx(owner.address, sessionKey.address, rules),
    );
    if (submitted.result === SUCCESS) return true;
    showRefusal("ledger", submitted.result, explainRefusal(submitted.result, undefined, undefined));
    return false;
  } catch (error) {
    if (!(error instanceof DeviceError && error.kind === "sessionPolicyRefused")) throw error;
    showRefusal(
      "device",
      DEVICE_POLICY_CODE,
      explainRefusal(DEVICE_POLICY_CODE, undefined, undefined),
    );
    showBanner("The Stax refused: beyond its Game profile. Nothing was signed.", "device");
    return false;
  }
}

/** The owner's one approval; then the session key plays alone. */
async function openSession(
  ownerOf: (client: Connection) => Promise<Owner> | Owner,
  rules: GameSessionRules,
): Promise<void> {
  const { client, tracker } = requireConnection();
  busy = true;
  renderButtons();
  try {
    const owner = await ownerOf(client);
    if (play !== undefined) {
      // A new session gets a new key: the previous one is closed or expired.
      play = undefined;
      sessionKey = newSessionKey();
    }
    const houseAddressForPlay = await houseAccount();
    showMessage(
      owner.isStax
        ? `Review on the Stax: ${rulesText(rules)}, Agent ID ${agentIdOf(sessionKey.address)}.`
        : `Touch ID: approve ${rulesText(rules)}.`,
      "info",
    );
    if (!(await signOpening(owner, rules))) return;
    resetGrid(rules.maxTxCount);
    play = {
      connection: client,
      owner: owner.address,
      house: houseAddressForPlay,
      sessionKey: sessionKey.address,
      gun: sessionGun(client, owner.address, sessionKey.seed),
      tracker,
    };
    phase = "open";
    ui.owner.textContent = `Opened once by ${owner.label} for ${owner.address}. ${rulesText(rules)}.`;
    showMessage(
      rules.capXrp > GAME_SESSION.capXrp
        ? `The Stax signed a ${rules.capXrp} XRP cap: this firmware does not enforce the Game profile yet. The ledger still holds every limit of the session.`
        : "Session open: shoot! The game key signs alone, no prompt.",
      rules.capXrp > GAME_SESSION.capXrp ? "error" : "ok",
    );
  } finally {
    busy = false;
  }
}

async function betTooMuch(current: Play): Promise<void> {
  const result = await fireShot(
    current,
    { target: GOLDEN_DUCK, visual: bulletMark() },
    showError,
    ABUSE_BET_XRP,
  );
  showBanner(
    isAccepted(result)
      ? `A ${ABUSE_BET_XRP} XRP bet went through: ${result}`
      : `${ABUSE_BET_XRP} XRP bet → ${result}`,
    isAccepted(result) ? "info" : "ledger",
  );
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Shoots as fast as the node answers until the ledger refuses a shot (or it is stopped). */
async function autoClick(current: Play): Promise<void> {
  autoClicking = true;
  renderButtons();
  let shots = 0;
  try {
    while (autoClicking && play === current) {
      const result = await fireShot(current, autoAim(), showError);
      shots += 1;
      if (!isAccepted(result)) {
        showBanner(`Auto-clicker: shot ${shots} refused by the ledger → ${result}`, "ledger");
        return;
      }
      await sleep(AUTO_CLICK_INTERVAL_MS);
    }
  } finally {
    autoClicking = false;
    renderButtons();
  }
}

/** The session key closes its own session (SigningSessionDelete without Owner). */
async function closeSession(current: Play): Promise<void> {
  autoClicking = false;
  const fired = await current.gun(closeSessionTx(current.owner, current.sessionKey));
  if (!isAccepted(fired.result)) {
    await reportRefusal(current, fired.result);
    return;
  }
  showMessage("Close sent by the game key: waiting for the ledger…", "info");
  const outcome = await current.tracker.watch(fired.hash, fired.lastLedger);
  if (outcome.kind === "validated" && outcome.result === SUCCESS)
    showMessage(
      "Session closed by its own key: validated. A new session needs the owner again.",
      "ok",
    );
  else
    showMessage(
      `Close not applied: ${outcome.kind === "validated" ? outcome.result : "expired"}`,
      "error",
    );
}

function withPlay(action: (current: Play) => Promise<void>): () => void {
  return guarded(
    async () => {
      if (play === undefined) throw new Error("open a session first");
      await action(play);
    },
    showError,
    refresh,
  );
}

function setup(): void {
  const priceText = (target: Target) =>
    `${target.label} ${formatXrp(target.priceXrp)} XRP · pays ${formatXrp(target.rewardXrp)}`;
  ui.priceDuck.textContent = priceText(DUCK);
  ui.priceGolden.textContent = priceText(GOLDEN_DUCK);
  ui.owner.textContent = rulesText(GAME_SESSION);
  ui.abuseBet.textContent = `Bet ${ABUSE_BET_XRP} XRP`;
  ui.openGreedy.textContent = `Ask the Stax for a ${GREEDY_GAME_SESSION.capXrp} XRP game session`;
  resetGrid(GAME_SESSION.maxTxCount);
  setArenaActive(false);

  setupArena((aimed) => {
    if (play !== undefined) fireShot(play, aimed, showError).catch(showError);
  });
  const run = (action: () => Promise<void>) => guarded(action, showError, refresh);
  ui.openStax.addEventListener(
    "click",
    run(() => openSession(staxOwner, GAME_SESSION)),
  );
  ui.openTouchId.addEventListener(
    "click",
    run(() => openSession(touchIdOwner, GAME_SESSION)),
  );
  ui.openGreedy.addEventListener(
    "click",
    run(() => openSession(staxOwner, GREEDY_GAME_SESSION)),
  );
  ui.abuseBet.addEventListener("click", withPlay(betTooMuch));
  ui.abuseAuto.addEventListener(
    "click",
    withPlay(async (current) => {
      if (autoClicking) autoClicking = false;
      else await autoClick(current);
    }),
  );
  ui.close.addEventListener("click", withPlay(closeSession));
}

async function connect(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  const client = { node, defs: await loadDefinitions(node) };
  connection = { client, tracker: ledgerTracker(client) };
  nodeProblem = undefined;
}

setup();
setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
setInterval(tickCountdown, COUNTDOWN_INTERVAL_MS);
houseAccount().catch((error: unknown) =>
  showMessage(`The house is unavailable: ${errorText(error)}`, "error"),
);
connect()
  .catch((error: unknown) => {
    nodeProblem = `unreachable (${errorText(error)})`;
  })
  .finally(() => void refresh());
