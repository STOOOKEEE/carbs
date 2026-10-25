// The DEX page (dex.html): a grid bot quotes XRP/USD on the XRPL's native DEX for ten minutes,
// signed by a session key alone. The owner signs at setup only: the USD trust line, then the
// session (mode P: OfferCreate and OfferCancel, 200 transactions, Stax profile "trading").

import type { Connection } from "../../account.ts";
import { agentIdOf } from "../../agent-id.ts";
import { NODE_URL } from "../../config.ts";
import { guarded } from "../../dom.ts";
import { type SubmittedTx, loadDefinitions } from "../../ledger.ts";
import { NodeClient } from "../../rpc.ts";
import { type SessionRules, closeSessionTx, paymentTx } from "../../session.ts";
import { type Stax, connectStax } from "../../stax.ts";
import { loadWallet } from "../../storage.ts";
import { errorText, logDeviceRefusal, logError, logResult, note } from "./activity.ts";
import { type Market, REFERENCE_PRICE_USD, TAKER_SIZE_XRP, type TakerSide } from "./api.ts";
import { readOrderBook } from "./book.ts";
import { renderBook } from "./book-view.ts";
import { GridBot } from "./bot.ts";
import { fetchMarket, requestInventory, sendTakerOrder } from "./client.ts";
import { DEVICE_POLICY_CODE } from "./explain.ts";
import { type Quote, usdAmount } from "./offers.ts";
import {
  type Owner,
  ensureTrustLine,
  isDevicePolicyRefusal,
  openTradingSession,
  passkeyOwner,
  staxOwner,
} from "./owner.ts";
import { type SessionPhase, renderSession, showRuleLimits, tickCountdown } from "./panel.ts";
import { PAYMENT_PERMISSION, TRADING_PERMISSIONS, tradingRules } from "./rules.ts";
import { type SessionKey, SessionSigner, newSessionKey, readSessionEntry } from "./session-key.ts";
import { ui } from "./ui.ts";

/** About one ledger: the book and the session entry are read again this often. */
const REFRESH_INTERVAL_MS = 3_000;
const COUNTDOWN_INTERVAL_MS = 1_000;
const SUCCESS = "tesSUCCESS";
const PRICE_DECIMALS = 4;
/** What the abuse attempts ask for: small, the point is the refusal code. */
const ABUSE_PAYMENT_XRP = 1;
const ABUSE_TRUST_LIMIT_USD = 1_000_000;
const ADDRESS_PREFIX_LENGTH = 8;

interface Trading {
  key: SessionKey;
  signer: SessionSigner;
  bot: GridBot;
}

let connection: Connection | undefined;
let market: Market | undefined;
let stax: Stax | undefined;
let owner: Owner | undefined;
let trading: Trading | undefined;
let phase: SessionPhase = "none";
/** An owner step (choose, open, device test) or the close is in progress. */
let busy = false;
let problem: string | undefined = "connecting…";
let refreshing: Promise<void> | undefined;

function shortAddress(address: string): string {
  return `${address.slice(0, ADDRESS_PREFIX_LENGTH)}…`;
}

function showConnection(): void {
  const issuer = market === undefined ? "–" : shortAddress(market.issuer);
  ui.connection.textContent =
    problem === undefined
      ? `node ${NODE_URL} · USD issued by ${issuer}`
      : `node ${NODE_URL}: ${problem}`;
  ui.connection.classList.toggle("problem", problem !== undefined);
}

function renderControls(): void {
  const ready = connection !== undefined && market !== undefined;
  const open = phase === "open" && trading !== undefined;
  const controls = ui.controls;
  controls.useStax.disabled = !ready || busy || open;
  controls.usePasskey.disabled = !ready || busy || open;
  controls.open.disabled = !ready || busy || open || owner === undefined;
  controls.abusePayment.disabled = !open || busy;
  controls.abuseTrustSet.disabled = !open || busy;
  controls.close.disabled = !open || busy;
  controls.abuseDevice.disabled = !ready || busy || open || owner?.kind !== "stax";
  ui.book.takerBuy.disabled = !ready;
  ui.book.takerSell.disabled = !ready;
  ui.ownerLabel.textContent = owner?.label ?? "owner not chosen";
  ui.ownerLabel.classList.toggle("root-muted", owner?.postQuantum !== true);
  controls.ownerStatus.textContent =
    owner === undefined
      ? "Choose who owns the trading account."
      : `${owner.label} · ${owner.address}`;
}

async function render(): Promise<void> {
  renderControls();
  if (connection === undefined || market === undefined) return;
  try {
    const book = await readOrderBook(connection, market);
    renderBook(book, market, owner?.address, trading?.bot.referencePrice ?? REFERENCE_PRICE_USD);
    const entry =
      trading === undefined
        ? undefined
        : await readSessionEntry(connection, trading.signer.owner, trading.key.address);
    // The entry is gone without our own close (deleted once expired, or revoked by the owner).
    if (phase === "open" && !busy && trading !== undefined && entry === undefined) {
      phase = "closed";
      await trading.bot.stop();
      note("The session's entry left the ledger: the bot stops.", "warning");
    }
    renderSession(trading?.key.address, entry, phase);
    problem = undefined;
  } catch (error) {
    problem = errorText(error);
  }
  showConnection();
}

function refresh(): Promise<void> {
  refreshing ??= render().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

function requireReady(): { connection: Connection; market: Market } {
  if (connection === undefined || market === undefined)
    throw new Error("the node or the market is not ready yet");
  return { connection, market };
}

function requireTrading(): Trading {
  if (trading === undefined || phase !== "open") throw new Error("open the session first");
  return trading;
}

/** An owner step: the other owner buttons stay off until it ends. */
function ownerStep(action: () => Promise<void>): () => void {
  return guarded(
    async () => {
      busy = true;
      renderControls();
      try {
        await action();
      } finally {
        busy = false;
      }
    },
    logError,
    refresh,
  );
}

function describeQuote(quote: Quote): string {
  const verb = quote.side === "bid" ? "Bid" : "Ask";
  return `${verb} ${quote.sizeXrp} XRP @ ${quote.priceUsd.toFixed(PRICE_DECIMALS)} USD`;
}

async function chooseStax(): Promise<void> {
  const ready = requireReady();
  note("Choose the Stax in the browser window (Chrome or Edge, XRP app open)…");
  stax ??= await connectStax();
  owner = await staxOwner(ready.connection, stax);
  note(`Owner: ${owner.label}, ${owner.address}.`, "ok");
}

async function choosePasskey(): Promise<void> {
  const ready = requireReady();
  const wallet = loadWallet();
  if (wallet === undefined)
    throw new Error("no Mac account in this browser: create it on the wallet page first");
  owner = passkeyOwner(ready.connection, wallet);
  note(`Owner: ${owner.label}, ${owner.address}.`, "ok");
}

/** The opening, signed by the owner; undefined when the Stax refused it under its profile. */
async function signOpening(
  signer: Owner,
  sessionKey: string,
  label: string,
  rules?: SessionRules,
): Promise<SubmittedTx | undefined> {
  try {
    const opened = await openTradingSession(signer, sessionKey, rules);
    logResult(label, opened.result, opened.hash);
    return opened;
  } catch (error) {
    if (!isDevicePolicyRefusal(error)) throw error;
    logDeviceRefusal(label, DEVICE_POLICY_CODE);
    return undefined;
  }
}

/** The trust line (once), then the session: the owner's only signatures. */
async function openSession(): Promise<void> {
  const ready = requireReady();
  const signer = owner;
  if (signer === undefined) throw new Error("choose the owner first");
  note(`USD trust line, signed by the owner (TrustSet is not a session type): ${signer.prompt}…`);
  const trust = await ensureTrustLine(ready.connection, signer, ready.market);
  if (trust === undefined) note("The USD trust line is already there.");
  else {
    logResult("Owner: TrustSet USD", trust.result, trust.hash);
    if (trust.result !== SUCCESS) return;
    await requestInventory(signer.address);
    note("The issuer sent USD inventory for the asks.", "ok");
  }

  const key = newSessionKey();
  note(`Open the session for Agent ID ${agentIdOf(key.address)}: ${signer.prompt}…`);
  const opened = await signOpening(
    signer,
    key.address,
    "Owner: SigningSessionSet, mode P, profile trading",
  );
  if (opened?.result !== SUCCESS) return;

  const sessionSigner = new SessionSigner(ready.connection, signer.address, key);
  const entry = await readSessionEntry(ready.connection, signer.address, key.address);
  const bot = new GridBot(ready.connection, ready.market, sessionSigner, entry?.expiration, {
    onQuote: (quote, result) => logResult(describeQuote(quote), result.result, result.hash),
    onStop: (result) => note(`The bot stops: its key can do nothing more (${result}).`, "ledger"),
    onError: logError,
  });
  trading = { key, signer: sessionSigner, bot };
  phase = "open";
  bot.start();
  note("The bot quotes alone now: no more prompts.", "ok");
}

async function abusePayment(): Promise<void> {
  const { market: current } = requireReady();
  const { signer } = requireTrading();
  const result = await signer.submit(
    paymentTx(signer.owner, current.counterparty, ABUSE_PAYMENT_XRP),
  );
  logResult(`Session key: Payment of ${ABUSE_PAYMENT_XRP} XRP`, result.result, result.hash);
}

async function abuseTrustSet(): Promise<void> {
  const { market: current } = requireReady();
  const { signer } = requireTrading();
  const result = await signer.submit({
    TransactionType: "TrustSet",
    Account: signer.owner,
    LimitAmount: usdAmount(current, ABUSE_TRUST_LIMIT_USD),
  });
  logResult("Session key: TrustSet (raise the USD limit)", result.result, result.hash);
}

/**
 * Asks the Stax for a trading session that may also pay: the trading profile allows offer types
 * only, so the device refuses before signing. A firmware without profiles signs it: the extra
 * session is then closed at once by its own key. Only while no session runs: the owner's
 * Sequence would race the bot's.
 */
async function abuseDevice(): Promise<void> {
  const ready = requireReady();
  const signer = owner;
  if (signer?.kind !== "stax") throw new Error("this test needs the Stax as the owner");
  const probe = newSessionKey();
  note(`Asking the Stax for OfferCreate, OfferCancel and Payment under "trading"…`);
  const opened = await signOpening(
    signer,
    probe.address,
    "Owner: SigningSessionSet with Payment, profile trading",
    tradingRules([...TRADING_PERMISSIONS, PAYMENT_PERMISSION]),
  );
  if (opened?.result !== SUCCESS) return;
  note(
    "This Stax firmware did not enforce the trading profile: closing that session now.",
    "warning",
  );
  const closed = await new SessionSigner(ready.connection, signer.address, probe).submit(
    closeSessionTx(signer.address, probe.address),
  );
  logResult("Probe key: SigningSessionDelete (own close)", closed.result, closed.hash);
}

/** Stops the bot, cancels its offers (they would outlive the session), then the own close. */
async function closeSession(): Promise<void> {
  const { key, signer, bot } = requireTrading();
  await bot.stop();
  note("Bot stopped. Cancelling its offers: they would outlive the session.");
  for (const cancelled of await bot.cancelAll())
    logResult("Session key: OfferCancel", cancelled.result, cancelled.hash);
  const closed = await signer.submit(closeSessionTx(signer.owner, key.address));
  logResult("Session key: SigningSessionDelete (own close)", closed.result, closed.hash);
  if (closed.result === SUCCESS) phase = "closed";
}

async function takerOrder(side: TakerSide): Promise<void> {
  const verb = side === "buy" ? "buys" : "sells";
  note(`The counterparty ${verb} ${TAKER_SIZE_XRP} XRP at market…`);
  const { result } = await sendTakerOrder(side);
  logResult(`Counterparty market order: ${verb} ${TAKER_SIZE_XRP} XRP`, result);
}

async function connect(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  connection = { node, defs: await loadDefinitions(node) };
  problem = "preparing the market (issuer, counterparty)…";
  showConnection();
  market = await fetchMarket();
  problem = undefined;
  note(
    `Market ready: USD from ${shortAddress(market.issuer)}, counterparty ${shortAddress(market.counterparty)}.`,
  );
}

function setup(): void {
  const controls = ui.controls;
  showRuleLimits();
  ui.book.takerBuy.textContent = `Counterparty buys ${TAKER_SIZE_XRP} XRP`;
  ui.book.takerSell.textContent = `Counterparty sells ${TAKER_SIZE_XRP} XRP`;
  controls.useStax.addEventListener("click", ownerStep(chooseStax));
  controls.usePasskey.addEventListener("click", ownerStep(choosePasskey));
  controls.open.addEventListener("click", ownerStep(openSession));
  controls.abuseDevice.addEventListener("click", ownerStep(abuseDevice));
  controls.close.addEventListener("click", ownerStep(closeSession));
  controls.abusePayment.addEventListener("click", guarded(abusePayment, logError, refresh));
  controls.abuseTrustSet.addEventListener("click", guarded(abuseTrustSet, logError, refresh));
  ui.book.takerBuy.addEventListener(
    "click",
    guarded(() => takerOrder("buy"), logError, refresh),
  );
  ui.book.takerSell.addEventListener(
    "click",
    guarded(() => takerOrder("sell"), logError, refresh),
  );
  setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
  setInterval(tickCountdown, COUNTDOWN_INTERVAL_MS);
  renderControls();
  connect()
    .catch((error: unknown) => {
      problem = errorText(error);
      logError(error);
    })
    .finally(() => void refresh());
}

setup();
