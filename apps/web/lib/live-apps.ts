/**
 * The team's live apps behind the Apps screen: the pages of the passkey wallet's server
 * (`apps/passkey-wallet`, `server/server.ts`), each opening one signing session on the carbs
 * node. Every number below is copied from the app's own source, named next to it;
 * `live-apps.test.ts` reads those sources and fails when one drifts, checks each opening against
 * the device's profiles, and checks the Stax rows against the client's prediction of the screen.
 *
 * The screen only links to the pages (navigation, not a request): nothing here talks to the
 * team's server or node, and the Content-Security-Policy does not list them.
 */

import {
  formatDuration,
  formatXrp,
  kDefaultSessionProfiles,
  kSessionCapScopeText,
  kSessionNoteText,
  sessionProfileTitle,
  type SessionProfileName,
  type SessionProfilePolicy,
} from "@carbs/ledger";
import { DROPS_PER_XRP } from "./constants";

/** The team's wallet server on its private network (Tailscale; `infra/compose.yaml`, port 9449). */
export const DEFAULT_APPS_URL = "https://debian-docker.tail8b5861.ts.net:9449";

/** The Stax's status word when its session policy refuses an opening (`SW_SESSION_POLICY_REFUSED`). */
export const DEVICE_POLICY_REFUSED = "0x6986";

export type LiveAppId = "agent" | "game" | "trading" | "streaming" | "minting" | "wallet";

/** C: a spending cap, XRP payments only; P: the listed transaction types; A: every delegable type. */
export type LiveSessionMode = "C" | "P" | "A";

export interface LiveAppSession {
  /** The modes the page opens; the wallet page lets the person choose, the first is its default. */
  modes: readonly [LiveSessionMode, ...LiveSessionMode[]];
  /** `SessionCap`, in XRP (mode C); null otherwise. */
  capXrp: number | null;
  /** `SessionMaxPerTx`, in XRP (mode C); null when the opening sets none. */
  maxPerTxXrp: number | null;
  /** Mode P: the transaction types allowed. */
  permissions: readonly string[];
  /** `SessionMaxTxCount`; null when the opening sets none. */
  maxTxCount: number | null;
  /** `SessionDuration`, in seconds. */
  durationSec: number;
  /** The Stax profile the opening names in a `carbs-profile` memo; null when it names none. */
  profile: SessionProfileName | null;
}

/** The opening a device refusal tries instead of the app's own: the fields that change. */
export interface LiveAppProbe {
  capXrp?: number;
  permissions?: readonly string[];
  maxTxCount?: number;
}

export interface LiveAppRefusal {
  /** What is tried, in a few words. */
  attempt: string;
  /** The ledger's result code, or the Stax's status word. */
  code: string;
  /** Who refuses: every XRPL node, or the Stax before it signs (its session policy must be on). */
  layer: "ledger" | "device";
  /** Device refusals only: the opening that is tried. */
  probe?: LiveAppProbe;
}

export interface LiveApp {
  id: LiveAppId;
  name: string;
  /** The page on the team's wallet server. */
  page: string;
  /** What the app shows, in one sentence. */
  summary: string;
  session: LiveAppSession;
  /** Where the session's numbers are read, in `apps/passkey-wallet`. */
  source: string;
  /** What the numbers do not say on their own; null when nothing. */
  note: string | null;
  refusals: readonly LiveAppRefusal[];
}

/** The session policy the agent's run sheet sets on the Stax (`scripts/agent/README.md`). */
export const AGENT_RUN_SHEET_POLICY = {
  maxSpendXrp: 50,
  maxPerPaymentXrp: 5,
  maxDurationSec: 180,
  /** `AGENT_SESSION_SECONDS` in the run sheet's agent command. */
  agentSessionSec: 120,
} as const;

/** What the apps charge and what their abuse buttons and scripts try, as their sources set it. */
export const FROM_SOURCES = {
  /** `src/apps/game/rules.ts`, `DUCK.priceXrp` and `GOLDEN_DUCK.priceXrp`. */
  gameShotXrp: [0.01, 0.05],
  /** `src/apps/game/rules.ts`, `ABUSE_BET_XRP`. */
  gameBetXrp: 1,
  /** `src/apps/game/rules.ts`, the cap of `GREEDY_GAME_SESSION`. */
  gameGreedyCapXrp: 50,
  /** `src/apps/stream/config.ts`, `PRICE_XRP` every `PAY_INTERVAL_MS`. */
  streamPriceXrp: 0.005,
  streamIntervalSec: 3,
  /** `src/apps/stream/config.ts`, `ABUSE_PAYMENT_XRP`. */
  streamPaymentXrp: 0.5,
  /** `src/apps/stream/config.ts`, `DEVICE_ABUSE_CAP_XRP`. */
  streamDeviceCapXrp: 20,
  /** `src/apps/dex/main.ts`, `ABUSE_PAYMENT_XRP`. */
  tradingPaymentXrp: 1,
  /** `src/apps/mint/desk.ts`, `STOLEN_XRP`. */
  mintStolenXrp: 10,
  /** `src/apps/mint/main.ts`, `OVER_PROFILE_TX_COUNT`: twice `PROFILE_MAX_TX_COUNT`. */
  mintDeviceTxCount: 200,
  /** `scripts/agent/agent.ts`, `DEFAULT_FIRST_CAP_XRP`. */
  agentFirstBudgetXrp: 500,
  /** `scripts/agent/merchant.ts`, the price of `/api/dataset`. */
  agentDatasetXrp: 25,
  /** `scripts/agent/merchant.ts`, `INJECTED_AMOUNT_XRP`. */
  agentInjectedXrp: 500,
  /** `scripts/agent/agent.ts`, `PROBE_PAYMENT_XRP`. */
  agentProbeXrp: 1,
} as const;

/** A profile of a fresh device, with its default limits (`ledger-app/src/policy/session_profiles.c`). */
function deviceProfile(name: SessionProfileName): SessionProfilePolicy {
  const profile = kDefaultSessionProfiles.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`the device has no ${name} profile`);
  return profile;
}

const xrpOfDrops = (drops: bigint | null): number => Number(drops ?? 0n) / DROPS_PER_XRP;

/** `scripts/agent/agent.ts` (`DEFAULT_CAP_XRP`, `DEFAULT_MAX_PER_TX_XRP`, `DEFAULT_DURATION_S`). */
const AGENT: LiveAppSession = {
  modes: ["C"],
  capXrp: 20,
  maxPerTxXrp: 5,
  permissions: [],
  maxTxCount: null,
  durationSec: 180,
  profile: null,
};

/** `src/apps/game/rules.ts`, `GAME_SESSION`. */
const GAME: LiveAppSession = {
  modes: ["C"],
  capXrp: 5,
  maxPerTxXrp: 0.1,
  permissions: [],
  maxTxCount: 300,
  durationSec: 600,
  profile: "game",
};

/** `src/apps/dex/rules.ts`, `tradingRules()`. */
const TRADING: LiveAppSession = {
  modes: ["P"],
  capXrp: null,
  maxPerTxXrp: null,
  permissions: ["OfferCreate", "OfferCancel"],
  maxTxCount: 200,
  durationSec: 600,
  profile: "trading",
};

/** `src/apps/stream/config.ts`, `STREAM_RULES`. */
const STREAMING: LiveAppSession = {
  modes: ["C"],
  capXrp: 1,
  maxPerTxXrp: 0.01,
  permissions: [],
  maxTxCount: 600,
  durationSec: 600,
  profile: "streaming",
};

/** `src/apps/mint/mint-session.ts`, `MINT_RULES`. */
const MINTING: LiveAppSession = {
  modes: ["P"],
  capXrp: null,
  maxPerTxXrp: null,
  permissions: ["NFTokenMint"],
  maxTxCount: 50,
  durationSec: 600,
  profile: "minting",
};

/** `index.html`: the wallet page's session form as it loads (mode C, its amounts, its duration). */
const WALLET: LiveAppSession = {
  modes: ["C", "A", "P"],
  capXrp: 50,
  maxPerTxXrp: 20,
  permissions: [],
  maxTxCount: null,
  durationSec: 300,
  profile: null,
};

const LIMIT = "tefSESSION_LIMIT";
const EXPIRED = "tefSESSION_EXPIRED";
const NOT_ALLOWED = "tefSESSION_TX_NOT_ALLOWED";
const CLOSED = "tefBAD_AUTH";
const S = FROM_SOURCES;

export const LIVE_APPS: readonly LiveApp[] = [
  {
    id: "agent",
    name: "AI agent on a budget",
    page: "demo.html",
    summary:
      "An LLM agent buys data from paid x402 APIs with a session key, within a budget its owner clear-signed on the Stax; a purchase above its limit goes back to the owner, who signs it on the device.",
    session: AGENT,
    source: "scripts/agent/agent.ts, src/agent-approvals.ts",
    note: `Defaults of the agent script (AGENT_SESSION_CAP_XRP, AGENT_MAX_PER_TX_XRP, AGENT_SESSION_SECONDS; the run sheet sets ${AGENT_RUN_SHEET_POLICY.agentSessionSec} s). The opening names no Stax profile and sets no transaction count. An escalated purchase is a Payment the owner signs on the Stax, its memo reading "Agent XXXX-XXXX: <reason>". The page shows the run; the agent and its x402 merchant are processes of scripts/agent, started against the same node.`,
    refusals: [
      {
        attempt: `A first budget of ${S.agentFirstBudgetXrp} XRP, above the policy set on the Stax (${AGENT_RUN_SHEET_POLICY.maxSpendXrp} XRP in the run sheet)`,
        code: DEVICE_POLICY_REFUSED,
        layer: "device",
        probe: { capXrp: S.agentFirstBudgetXrp },
      },
      {
        attempt: `The ${S.agentDatasetXrp} XRP dataset, above ${AGENT.maxPerTxXrp} XRP per payment`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `The ${S.agentInjectedXrp} XRP payment to an attacker that an API's text asks for`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `A ${S.agentProbeXrp} XRP payment after the session expired`,
        code: EXPIRED,
        layer: "ledger",
      },
      {
        attempt: `A ${S.agentProbeXrp} XRP payment after the key closed its session`,
        code: CLOSED,
        layer: "ledger",
      },
    ],
  },
  {
    id: "game",
    name: "Hash Blaster",
    page: "game.html",
    summary: `An arcade where every shot is a payment of ${S.gameShotXrp.join(" or ")} XRP signed by the session key with no prompt; whether it hits is read from the hash of the ledger that validated it.`,
    session: GAME,
    source: "src/apps/game/rules.ts",
    note: null,
    refusals: [
      {
        attempt: `A ${S.gameBetXrp} XRP bet, above ${GAME.maxPerTxXrp} XRP per payment`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `The auto-clicker, once ${GAME.maxTxCount} shots or the ${GAME.capXrp} XRP cap are used up`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `A shot after the session's ${formatDuration(GAME.durationSec)}`,
        code: EXPIRED,
        layer: "ledger",
      },
      {
        attempt: `A ${S.gameGreedyCapXrp} XRP game session: the Game profile allows ${xrpOfDrops(deviceProfile("game").maxCapDrops)} XRP`,
        code: DEVICE_POLICY_REFUSED,
        layer: "device",
        probe: { capXrp: S.gameGreedyCapXrp },
      },
    ],
  },
  {
    id: "trading",
    name: "Grid trading",
    page: "dex.html",
    summary:
      "A grid bot quotes XRP/USD on the XRPL's own order book, each offer signed by the session key alone; the owner signs only the trust line and the opening.",
    session: TRADING,
    source: "src/apps/dex/rules.ts",
    note: "Mode P bounds which types and for how long, not how much: the ledger caps neither the size nor the price of an offer, and offers outlive the session. The bot gives each offer an Expiration at the session's end and cancels them before it closes.",
    refusals: [
      {
        attempt: `A ${S.tradingPaymentXrp} XRP Payment signed by the bot's key`,
        code: NOT_ALLOWED,
        layer: "ledger",
      },
      { attempt: "A TrustSet that raises the USD limit", code: NOT_ALLOWED, layer: "ledger" },
      {
        attempt: `A quote past the ${TRADING.maxTxCount} transactions`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `A quote after the session's ${formatDuration(TRADING.durationSec)}`,
        code: EXPIRED,
        layer: "ledger",
      },
      {
        attempt: "A trading session that also allows Payment",
        code: DEVICE_POLICY_REFUSED,
        layer: "device",
        probe: { permissions: [...TRADING.permissions, "Payment"] },
      },
    ],
  },
  {
    id: "streaming",
    name: "Pay-as-you-go streaming",
    page: "stream.html",
    summary: `A player pays the provider ${S.streamPriceXrp} XRP every ${S.streamIntervalSec} seconds while it plays, signed by the session key with no prompt; the provider reads the payments on the ledger and cuts the stream when they stop.`,
    session: STREAMING,
    source: "src/apps/stream/config.ts",
    note: null,
    refusals: [
      {
        attempt: `One payment of ${S.streamPaymentXrp} XRP, above ${STREAMING.maxPerTxXrp} XRP per payment`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `Payments sent back to back until the ${STREAMING.capXrp} XRP cap`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `A payment after the session's ${formatDuration(STREAMING.durationSec)}`,
        code: EXPIRED,
        layer: "ledger",
      },
      {
        attempt: `A ${S.streamDeviceCapXrp} XRP streaming session: the Streaming profile allows ${xrpOfDrops(deviceProfile("streaming").maxCapDrops)} XRP`,
        code: DEVICE_POLICY_REFUSED,
        layer: "device",
        probe: { capXrp: S.streamDeviceCapXrp },
      },
    ],
  },
  {
    id: "minting",
    name: "Ticket desk",
    page: "mint.html",
    summary:
      "A studio opens a ticket desk once; the desk's key then mints event tickets as NFTs alone, and cannot move a single XRP.",
    session: MINTING,
    source: "src/apps/mint/mint-session.ts",
    note: null,
    refusals: [
      {
        attempt: `Send ${S.mintStolenXrp} XRP to an outside account`,
        code: NOT_ALLOWED,
        layer: "ledger",
      },
      { attempt: "Burn the newest ticket (NFTokenBurn)", code: NOT_ALLOWED, layer: "ledger" },
      {
        attempt: `The transaction after the ${MINTING.maxTxCount}th`,
        code: LIMIT,
        layer: "ledger",
      },
      {
        attempt: `A minting session of ${S.mintDeviceTxCount} transactions: the Minting profile allows ${deviceProfile("minting").maxTxCount}`,
        code: DEVICE_POLICY_REFUSED,
        layer: "device",
        probe: { maxTxCount: S.mintDeviceTxCount },
      },
    ],
  },
  {
    id: "wallet",
    name: "Passkey wallet",
    page: "index.html",
    summary:
      "The test wallet itself, in French: a passkey account signed with Touch ID, a Ledger Stax account and its move to an ML-DSA-44 root, sessions in modes C, A and P, and what a stolen session key would try.",
    session: WALLET,
    source: "index.html (the form's defaults), src/session-panel.ts",
    note: "The rows are the form's defaults in mode C; the person picks the mode and the limits, and may require a witness. The opening names no Stax profile and sets no transaction count.",
    refusals: [
      { attempt: "The session key sets a regular key", code: NOT_ALLOWED, layer: "ledger" },
      { attempt: "The session key sends an AccountSet", code: NOT_ALLOWED, layer: "ledger" },
      { attempt: "The session key signs a Batch", code: NOT_ALLOWED, layer: "ledger" },
      { attempt: "A payment above the max per payment", code: LIMIT, layer: "ledger" },
      {
        attempt: "A payment without the witness's co-signature, when one is required",
        code: "tefSESSION_NO_WITNESS",
        layer: "ledger",
      },
      { attempt: "A payment after the key closed its session", code: CLOSED, layer: "ledger" },
    ],
  },
];

/** One row of the Stax review, `label; value` as the device shows it. */
export interface StaxRow {
  label: string;
  value: string;
}

const drops = (xrp: number): string => String(Math.round(xrp * DROPS_PER_XRP));

/**
 * The rows the Stax review lists for the app's opening, in the device's words and order
 * (`docs/device-contract.md` section 2): the Agent ID, the profile, the limits, what the session
 * allows and the note. The account, session key, network, fee and memo rows are left out.
 */
export function staxRows(app: LiveApp): StaxRow[] {
  const session = app.session;
  const rows: StaxRow[] = [{ label: "Agent ID", value: "XXXX-XXXX, of the session key" }];
  if (session.profile !== null) {
    rows.push({ label: "Profile", value: sessionProfileTitle(session.profile) });
  }
  rows.push({ label: "Valid for", value: formatDuration(session.durationSec) });
  if (session.maxTxCount !== null) {
    rows.push({ label: "Max transactions", value: String(session.maxTxCount) });
  }
  const cap = session.modes[0] === "C" ? session.capXrp : null;
  if (cap !== null) {
    rows.push({ label: "Max spend", value: formatXrp(drops(cap)) });
    if (session.maxPerTxXrp !== null) {
      rows.push({ label: "Max per payment", value: formatXrp(drops(session.maxPerTxXrp)) });
    }
  }
  session.permissions.forEach((name, index) => {
    rows.push({ label: `Allows [${index + 1}]`, value: name });
  });
  if (cap !== null) rows.push({ label: "Allows", value: kSessionCapScopeText });
  rows.push({ label: "Note", value: kSessionNoteText });
  return rows;
}

const MODE_NAMES: Record<LiveSessionMode, string> = {
  C: "C, a spending cap",
  P: "P, listed transaction types",
  A: "A, every delegable type",
};

/** `C, A or P`. */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} or ${items.slice(-1).join("")}`;
}

/** The session mode and the Stax profile, in one line. */
export function modeText(app: LiveApp): string {
  const { modes, profile } = app.session;
  const [first, ...others] = modes;
  const mode = others.length === 0 ? MODE_NAMES[first] : `${listed(modes)}, chosen on the page`;
  const named =
    profile === null
      ? "no Stax profile"
      : `Stax profile ${sessionProfileTitle(profile)} (memo carbs-profile)`;
  return `Mode ${mode}; ${named}.`;
}

/**
 * The base URL of the team's wallet server from the runtime config (`NUXT_PUBLIC_APPS_URL`):
 * the default host when it is empty, null when it is not a plain http(s) URL (a link built from
 * it could run script or carry credentials).
 */
export function appsBaseUrl(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return DEFAULT_APPS_URL;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const plain = url.username === "" && url.password === "" && url.search === "" && url.hash === "";
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !plain) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The page of an app on the team's server. */
export function appPageUrl(baseUrl: string, app: LiveApp): string {
  return `${baseUrl}/${app.page}`;
}
