// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  kSessionPolicyOff,
  kSessionProfileNames,
  reviewLines,
  sessionPolicyRefusal,
  sessionProfileTitle,
  type SessionPolicy,
} from "@carbs/ledger";
import { bytesToHex } from "@carbs/sessions";
import { standaloneDefinitions } from "@carbs/sessions/testing";
import { describe, expect, it } from "vitest";
import { DROPS_PER_XRP, MAX_SESSION_DURATION_SEC, PERMISSION_MAX_SIZE } from "./constants";
import { buildCsp } from "./csp";
import {
  AGENT_RUN_SHEET_POLICY,
  DEFAULT_APPS_URL,
  DEVICE_POLICY_REFUSED,
  FROM_SOURCES,
  LIVE_APPS,
  appPageUrl,
  appsBaseUrl,
  modeText,
  staxRows,
  type LiveApp,
  type LiveAppId,
  type LiveAppProbe,
} from "./live-apps";
import { NETWORKS, allConnectOrigins } from "./networks";

const ROOT = join(import.meta.dirname, "..", "..", "..");
/** The node's own `server_definitions` (the standalone node with the amendment, recorded). */
const defs = standaloneDefinitions();
/** The node's bound on `SessionMaxTxCount` (rippled `kMaxSessionTxCount`). */
const MAX_SESSION_TX_COUNT = 100_000;
/** The account and session key of the device's frozen vectors (`33-session-policy`). */
const OWNER = "rawnHFk1gPQeEBC88cXbetXLqw3hnqk4pE";
const SESSION_KEY = "rHH1wGruhP1ZSzJvvxYeimWLmXGG8WULED";

const drops = (xrp: number): string => String(Math.round(xrp * DROPS_PER_XRP));
const hex = (text: string): string => bytesToHex(new TextEncoder().encode(text));

function app(id: LiveAppId): LiveApp {
  const found = LIVE_APPS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no app ${id}`);
  return found;
}

/** The app's `SigningSessionSet`, decoded, as `openSessionTx` (`src/session.ts`) builds it. */
function opening(entry: LiveApp, probe: LiveAppProbe = {}): Record<string, unknown> {
  const session = { ...entry.session, ...probe };
  const tx: Record<string, unknown> = {
    TransactionType: "SigningSessionSet",
    Account: OWNER,
    SessionKey: SESSION_KEY,
    SessionDuration: session.durationSec,
  };
  if (session.modes[0] === "C" && session.capXrp !== null) {
    tx["SessionCap"] = drops(session.capXrp);
    if (session.maxPerTxXrp !== null) tx["SessionMaxPerTx"] = drops(session.maxPerTxXrp);
  }
  if (session.modes[0] === "P") {
    tx["Permissions"] = session.permissions.map((name) => ({
      Permission: { PermissionValue: name },
    }));
  }
  if (session.maxTxCount !== null) tx["SessionMaxTxCount"] = session.maxTxCount;
  if (session.profile !== null) {
    tx["Memos"] = [{ Memo: { MemoType: hex("carbs-profile"), MemoData: hex(session.profile) } }];
  }
  return tx;
}

const xrpDrops = (xrp: number): bigint => BigInt(Math.round(xrp * DROPS_PER_XRP));
/** A fresh Stax with its session policy on: every profile on, with its default limits. */
const PROFILES_ON: SessionPolicy = { ...kSessionPolicyOff, enabled: true };
/** The policy the agent's run sheet sets on the Stax. */
const RUN_SHEET: SessionPolicy = {
  ...kSessionPolicyOff,
  enabled: true,
  maxCapDrops: xrpDrops(AGENT_RUN_SHEET_POLICY.maxSpendXrp),
  maxPerTxDrops: xrpDrops(AGENT_RUN_SHEET_POLICY.maxPerPaymentXrp),
  maxDurationSeconds: AGENT_RUN_SHEET_POLICY.maxDurationSec,
};

describe("the live apps", () => {
  it("has one entry per page, each with a session and its limits", () => {
    expect(LIVE_APPS.map((entry) => entry.page)).toEqual([
      "demo.html",
      "game.html",
      "dex.html",
      "stream.html",
      "mint.html",
      "index.html",
    ]);
    expect(new Set(LIVE_APPS.map((entry) => entry.id)).size).toBe(LIVE_APPS.length);
    for (const entry of LIVE_APPS) {
      const { session } = entry;
      expect(entry.page, entry.id).toMatch(/^[a-z]+\.html$/);
      expect(entry.summary, entry.id).toMatch(/^[A-Z][^\n]+\.$/);
      expect(Number.isInteger(session.durationSec), entry.id).toBe(true);
      expect(session.durationSec, entry.id).toBeGreaterThan(0);
      expect(session.durationSec, entry.id).toBeLessThanOrEqual(MAX_SESSION_DURATION_SEC);
      if (session.maxTxCount !== null) {
        expect(Number.isInteger(session.maxTxCount), entry.id).toBe(true);
        expect(session.maxTxCount, entry.id).toBeGreaterThan(0);
        expect(session.maxTxCount, entry.id).toBeLessThanOrEqual(MAX_SESSION_TX_COUNT);
      }
      if (session.modes[0] === "C") {
        expect(session.capXrp, entry.id).toBeGreaterThan(0);
        expect(session.permissions, entry.id).toEqual([]);
        if (session.maxPerTxXrp !== null)
          expect(session.maxPerTxXrp, entry.id).toBeLessThanOrEqual(session.capXrp ?? 0);
      } else {
        expect(session.capXrp, entry.id).toBeNull();
        expect(session.permissions.length, entry.id).toBeGreaterThan(0);
        expect(session.permissions.length, entry.id).toBeLessThanOrEqual(PERMISSION_MAX_SIZE);
      }
      expect(entry.refusals.length, entry.id).toBeGreaterThan(0);
      for (const refusal of entry.refusals) {
        const device = refusal.layer === "device";
        expect(refusal.code === DEVICE_POLICY_REFUSED, refusal.attempt).toBe(device);
        expect(refusal.probe !== undefined, refusal.attempt).toBe(device);
      }
    }
  });

  it("names only profiles the Stax has: one per use case, none for the agent and the wallet", () => {
    const profiles = Object.fromEntries(
      LIVE_APPS.map((entry) => [entry.id, entry.session.profile]),
    );
    expect(profiles).toEqual({
      agent: null,
      game: "game",
      trading: "trading",
      streaming: "streaming",
      minting: "minting",
      wallet: null,
    });
    for (const profile of Object.values(profiles)) {
      if (profile !== null) expect(kSessionProfileNames).toContain(profile);
    }
  });

  it("opens within its Stax profile, and the Stax refuses each probe once its policy is on (SIMULATED device logic)", () => {
    for (const entry of LIVE_APPS) {
      const { profile } = entry.session;
      if (profile === null) continue;
      expect(sessionPolicyRefusal(PROFILES_ON, opening(entry), defs), entry.id).toBeUndefined();
      const probes = entry.refusals.flatMap((refusal) => (refusal.probe ? [refusal.probe] : []));
      expect(probes.length, entry.id).toBeGreaterThan(0);
      for (const probe of probes) {
        const reason = sessionPolicyRefusal(PROFILES_ON, opening(entry, probe), defs);
        expect(reason, entry.id).toMatch(new RegExp(`^Profile ${sessionProfileTitle(profile)}: `));
        // With the policy off (a fresh install), the device checks nothing.
        expect(
          sessionPolicyRefusal(kSessionPolicyOff, opening(entry, probe), defs),
        ).toBeUndefined();
      }
    }
  });

  it("asks the agent's budget within the run sheet's policy, and its first budget beyond it", () => {
    const agent = app("agent");
    expect(sessionPolicyRefusal(RUN_SHEET, opening(agent), defs)).toBeUndefined();
    const [probe] = agent.refusals.flatMap((refusal) => (refusal.probe ? [refusal.probe] : []));
    expect(sessionPolicyRefusal(RUN_SHEET, opening(agent, probe), defs)).toBe(
      `Max spend XRP ${FROM_SOURCES.agentFirstBudgetXrp} is above XRP ${AGENT_RUN_SHEET_POLICY.maxSpendXrp}`,
    );
  });

  it("lists the rows the client predicts on the Stax review, Profile and Max transactions included", () => {
    for (const entry of LIVE_APPS) {
      const review = reviewLines(opening(entry), defs);
      expect(review.kind, entry.id).toBe("clear");
      const shown = new Map(review.lines.map((line) => [line.label, line.value]));
      for (const row of staxRows(entry)) {
        expect(shown.has(row.label), `${entry.id}: ${row.label}`).toBe(true);
        // The Agent ID depends on the session key, born in the app.
        if (row.label !== "Agent ID") expect(shown.get(row.label), entry.id).toBe(row.value);
      }
      expect(shown.has("Profile"), entry.id).toBe(entry.session.profile !== null);
      expect(shown.has("Max transactions"), entry.id).toBe(entry.session.maxTxCount !== null);
    }
    expect(staxRows(app("game")).map((row) => `${row.label}; ${row.value}`)).toEqual([
      "Agent ID; XXXX-XXXX, of the session key",
      "Profile; Game",
      "Valid for; 10 minutes",
      "Max transactions; 300",
      "Max spend; XRP 5",
      "Max per payment; XRP 0.1",
      "Allows; XRP payments only, fees included",
      "Note; Cannot change keys or signers",
    ]);
  });

  it("refuses with result codes of the imported tree", () => {
    const codes = readFileSync(join(ROOT, "rippled/src/libxrpl/protocol/TER.cpp"), "utf8");
    for (const entry of LIVE_APPS) {
      for (const refusal of entry.refusals) {
        if (refusal.layer === "ledger") expect(codes).toContain(`MAKE_ERROR(${refusal.code},`);
      }
    }
  });

  it("says the mode and the profile in one line", () => {
    expect(modeText(app("game"))).toBe(
      "Mode C, a spending cap; Stax profile Game (memo carbs-profile).",
    );
    expect(modeText(app("minting"))).toBe(
      "Mode P, listed transaction types; Stax profile Minting (memo carbs-profile).",
    );
    expect(modeText(app("wallet"))).toBe("Mode C, A or P, chosen on the page; no Stax profile.");
  });
});

/** A file of the passkey wallet, as text. */
const walletFile = (path: string): string =>
  readFileSync(join(ROOT, "apps/passkey-wallet", path), "utf8");

/** The first group of `pattern`, or an error that names what the app's source no longer says. */
function found(text: string, pattern: RegExp, what: string): string {
  const value = pattern.exec(text)?.[1];
  if (value === undefined) throw new Error(`${what}: not found in the app's source`);
  return value;
}

const asNumber = (raw: string): number => Number(raw.replaceAll("_", ""));
/** `const NAME = 3_000;` → 3000. */
const constant = (text: string, name: string): number =>
  asNumber(found(text, new RegExp(`\\b${name}\\s*=\\s*([\\d_.]+);`), name));
/** The body of the first object literal after `start`. */
const objectAfter = (text: string, start: string): string =>
  found(text, new RegExp(`${start}[^{]*\\{([^}]*)\\}`), start);
/** A field of an object literal: a number, or a constant of the same file. */
function numberField(text: string, body: string, name: string): number {
  const raw = found(body, new RegExp(`\\b${name}:\\s*([\\w.]+)`), name);
  return /^[\d_.]+$/.test(raw) ? asNumber(raw) : constant(text, raw);
}
const profileField = (body: string): string => found(body, /\bprofile:\s*"(\w+)"/, "profile");
/** PermissionValue (transaction type + 1) → the type's name, from the node's definitions. */
function permissionName(value: number): string {
  const entry = Object.entries(defs.raw.TRANSACTION_TYPES).find(([, type]) => type === value - 1);
  if (entry === undefined) throw new Error(`no transaction type for permission ${value}`);
  return entry[0];
}

describe("the numbers come from the apps' own sources", () => {
  it("Hash Blaster: src/apps/game/rules.ts", () => {
    const text = walletFile("src/apps/game/rules.ts");
    const rules = objectAfter(text, "GAME_SESSION:");
    const { session } = app("game");
    expect(numberField(text, rules, "capXrp")).toBe(session.capXrp);
    expect(numberField(text, rules, "maxPerTxXrp")).toBe(session.maxPerTxXrp);
    expect(numberField(text, rules, "maxTxCount")).toBe(session.maxTxCount);
    expect(numberField(text, rules, "durationSeconds")).toBe(session.durationSec);
    expect(profileField(rules)).toBe(session.profile);
    expect(rules).toMatch(/mode:\s*"cap"/);
    const greedy = objectAfter(text, "GREEDY_GAME_SESSION:");
    expect(numberField(text, greedy, "capXrp")).toBe(FROM_SOURCES.gameGreedyCapXrp);
    expect(constant(text, "ABUSE_BET_XRP")).toBe(FROM_SOURCES.gameBetXrp);
    const prices = ["DUCK:", "GOLDEN_DUCK:"].map((name) =>
      numberField(text, objectAfter(text, `export const ${name}`), "priceXrp"),
    );
    expect(prices).toEqual(FROM_SOURCES.gameShotXrp);
  });

  it("Grid trading: src/apps/dex/rules.ts and main.ts", () => {
    const text = walletFile("src/apps/dex/rules.ts");
    const rules = objectAfter(text, "return");
    const { session } = app("trading");
    expect(numberField(text, rules, "durationSeconds")).toBe(session.durationSec);
    expect(numberField(text, rules, "maxTxCount")).toBe(session.maxTxCount);
    expect(profileField(rules)).toBe(session.profile);
    expect(rules).toMatch(/mode:\s*"permissions"/);
    const permissions = found(text, /TRADING_PERMISSIONS[^=]*=\s*\[([^\]]*)\]/, "permissions")
      .split(",")
      .map((value) => permissionName(asNumber(value.trim())));
    expect(permissions).toEqual(session.permissions);
    const probe = app("trading").refusals.find((refusal) => refusal.probe)?.probe;
    expect(probe?.permissions).toEqual([
      ...permissions,
      permissionName(constant(text, "PAYMENT_PERMISSION")),
    ]);
    expect(constant(walletFile("src/apps/dex/main.ts"), "ABUSE_PAYMENT_XRP")).toBe(
      FROM_SOURCES.tradingPaymentXrp,
    );
  });

  it("Streaming: src/apps/stream/config.ts", () => {
    const text = walletFile("src/apps/stream/config.ts");
    const rules = objectAfter(text, "STREAM_RULES:");
    const { session } = app("streaming");
    expect(numberField(text, rules, "capXrp")).toBe(session.capXrp);
    expect(numberField(text, rules, "maxPerTxXrp")).toBe(session.maxPerTxXrp);
    expect(numberField(text, rules, "maxTxCount")).toBe(session.maxTxCount);
    expect(numberField(text, rules, "durationSeconds")).toBe(session.durationSec);
    expect(profileField(rules)).toBe(session.profile);
    expect(constant(text, "PRICE_XRP")).toBe(FROM_SOURCES.streamPriceXrp);
    expect(constant(text, "PAY_INTERVAL_MS") / 1000).toBe(FROM_SOURCES.streamIntervalSec);
    expect(constant(text, "ABUSE_PAYMENT_XRP")).toBe(FROM_SOURCES.streamPaymentXrp);
    expect(constant(text, "DEVICE_ABUSE_CAP_XRP")).toBe(FROM_SOURCES.streamDeviceCapXrp);
  });

  it("Ticket desk: src/apps/mint/mint-session.ts, desk.ts and main.ts", () => {
    const text = walletFile("src/apps/mint/mint-session.ts");
    const rules = objectAfter(text, "MINT_RULES:");
    const { session } = app("minting");
    expect(numberField(text, rules, "durationSeconds")).toBe(session.durationSec);
    expect(numberField(text, rules, "maxTxCount")).toBe(session.maxTxCount);
    expect(profileField(rules)).toBe(session.profile);
    const permission = found(rules, /permissions:\s*\[(\w+)\]/, "permissions");
    expect([permissionName(constant(text, permission))]).toEqual(session.permissions);
    expect(walletFile("src/apps/mint/main.ts")).toContain(
      "OVER_PROFILE_TX_COUNT = 2 * PROFILE_MAX_TX_COUNT;",
    );
    expect(2 * constant(text, "PROFILE_MAX_TX_COUNT")).toBe(FROM_SOURCES.mintDeviceTxCount);
    expect(constant(walletFile("src/apps/mint/desk.ts"), "STOLEN_XRP")).toBe(
      FROM_SOURCES.mintStolenXrp,
    );
  });

  it("AI agent: scripts/agent and src/agent-approvals.ts", () => {
    const agent = walletFile("scripts/agent/agent.ts");
    const { session } = app("agent");
    expect(constant(agent, "DEFAULT_CAP_XRP")).toBe(session.capXrp);
    expect(constant(agent, "DEFAULT_MAX_PER_TX_XRP")).toBe(session.maxPerTxXrp);
    expect(constant(agent, "DEFAULT_DURATION_S")).toBe(session.durationSec);
    expect(constant(agent, "DEFAULT_FIRST_CAP_XRP")).toBe(FROM_SOURCES.agentFirstBudgetXrp);
    expect(constant(agent, "PROBE_PAYMENT_XRP")).toBe(FROM_SOURCES.agentProbeXrp);
    // The wallet opens the agent's budget in mode C, with no transaction count and no profile.
    const approval = walletFile("src/agent-approvals.ts");
    const budget = objectAfter(approval, 'kind === "session"\\)\\s*return openSessionTx');
    expect(budget).toMatch(/mode:\s*"cap"/);
    expect(budget).not.toMatch(/maxTxCount|profile/);
    const merchant = walletFile("scripts/agent/merchant.ts");
    expect(constant(merchant, "INJECTED_AMOUNT_XRP")).toBe(FROM_SOURCES.agentInjectedXrp);
    expect(
      asNumber(found(merchant, /"\/api\/dataset",[\s\S]*?priceXrp:\s*([\d.]+)/, "dataset price")),
    ).toBe(FROM_SOURCES.agentDatasetXrp);
    const sheet = walletFile("scripts/agent/README.md");
    expect(asNumber(found(sheet, /_Max spend_\s+\*\*(\d+) XRP\*\*/, "max spend"))).toBe(
      AGENT_RUN_SHEET_POLICY.maxSpendXrp,
    );
    expect(asNumber(found(sheet, /_Max per payment_\s+\*\*(\d+) XRP\*\*/, "per payment"))).toBe(
      AGENT_RUN_SHEET_POLICY.maxPerPaymentXrp,
    );
    expect(60 * asNumber(found(sheet, /_Max duration_\s+\*\*(\d+) min\*\*/, "duration"))).toBe(
      AGENT_RUN_SHEET_POLICY.maxDurationSec,
    );
    expect(asNumber(found(sheet, /AGENT_SESSION_SECONDS=(\d+) pnpm agent/, "run sheet"))).toBe(
      AGENT_RUN_SHEET_POLICY.agentSessionSec,
    );
  });

  it("Passkey wallet: the session form of index.html", () => {
    const page = walletFile("index.html");
    const value = (id: string) =>
      asNumber(found(page, new RegExp(`id="${id}"[^>]*value="([\\d.]+)"`), id));
    const { session } = app("wallet");
    expect(value("session-duration")).toBe(session.durationSec);
    expect(value("session-cap")).toBe(session.capXrp);
    expect(value("session-max-per-tx")).toBe(session.maxPerTxXrp);
    const select = found(page, /<select id="session-mode">([\s\S]*?)<\/select>/, "mode select");
    const modes = [...select.matchAll(/value="(\w+)"/g)].map((option) => option[1]);
    const letters: Record<string, string> = { cap: "C", all: "A", permissions: "P" };
    expect(modes.map((mode) => letters[mode ?? ""])).toEqual(session.modes);
  });
});

describe("the link to the team's server", () => {
  it("defaults to the team's host and joins the page", () => {
    for (const empty of [undefined, "", "  "]) expect(appsBaseUrl(empty)).toBe(DEFAULT_APPS_URL);
    expect(appsBaseUrl("https://apps.example.org/carbs/")).toBe("https://apps.example.org/carbs");
    expect(appsBaseUrl("http://localhost:18080")).toBe("http://localhost:18080");
    expect(appPageUrl(DEFAULT_APPS_URL, app("game"))).toBe(`${DEFAULT_APPS_URL}/game.html`);
  });

  it("refuses a value that is not a plain http(s) URL", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://apps.example.org",
      "not a url",
      "https://user:secret@apps.example.org",
      "https://apps.example.org/?page=1",
      "https://apps.example.org/#top",
    ]) {
      expect(appsBaseUrl(bad), bad).toBeNull();
    }
  });

  it("is navigation only: connect-src does not list the team's host", () => {
    const csp = buildCsp({ connectOrigins: allConnectOrigins(NETWORKS) });
    expect(csp).not.toContain(new URL(DEFAULT_APPS_URL).hostname);
  });
});
