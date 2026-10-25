// @vitest-environment node
/**
 * The real-node run recorded in docs/DEVLOG.md ("Actions and Attack on a real node", "mode C,
 * expiry and the cap on a real node"). Not part of `pnpm test`: it needs a node.
 *
 *   XRPLD_BIN=… GENESIS_SEED=… pnpm demo --no-web          (terminal 1)
 *   pnpm --filter web live-run                             (terminal 2)
 *
 * It drives the web app's live backend (the stores behind the Session, Actions and Attack
 * screens) with fresh accounts funded by the dev faucet, signed client-side, and prints the
 * node's own answers. The Mac account's passkey is the software authenticator (SIMULATED).
 */
import { WebSocketClient } from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import { createDemo } from "../lib/demo";
import { NETWORKS } from "../lib/networks";
import { ATTACKS } from "../lib/scenarios";
import { createLiveBackend } from "../lib/live/backend";
import { softwarePasskeySource } from "../lib/wallets/passkey";

const WS = process.env["LIVE_WS"] ?? "ws://127.0.0.1:6006";
const FAUCET = process.env["LIVE_FAUCET"] ?? "http://127.0.0.1:3005/accounts";
const ORIGIN = process.env["LIVE_ORIGIN"] ?? "http://localhost:3000";
/** Printed straight to stdout: the test reporter does not show console output of a passing test. */
const say = (...parts: unknown[]): void => {
  process.stdout.write(`${parts.map(String).join(" ")}\n`);
};

const ACTIONS = ["payment", "offer", "trust", "ticket", "mint", "check"];
const PERMISSIONS = [
  "Payment",
  "OfferCreate",
  "TrustSet",
  "TicketCreate",
  "NFTokenMint",
  "CheckCreate",
];

async function backend() {
  const network = { ...NETWORKS.local, wss: WS, faucet: FAUCET };
  // The dev faucet only answers the page's own origin, as a browser would send it.
  const withOrigin: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      headers: { ...(init?.headers as Record<string, string>), origin: ORIGIN },
    });
  return createLiveBackend({
    client: new WebSocketClient(WS),
    network: () => network,
    approver: () => async () => true,
    passkeys: softwarePasskeySource(),
    exposure: {
      mode: "live",
      async check() {
        throw new Error("not used here");
      },
    },
    fetcher: withOrigin,
  });
}

describe("live run against the standalone node (manual)", () => {
  it("modes A and P: six actions, the attacks, the own close", async () => {
    const live = await backend();
    for (const [label, params] of [
      ["A", { mode: "A" as const, durationSec: 600, permissions: [], capDrops: 0 }],
      ["P", { mode: "P" as const, durationSec: 600, permissions: PERMISSIONS, capDrops: 0 }],
    ] as const) {
      const demo = createDemo(live);
      await demo.createAccount("mac");
      const opened = await demo.openSession(params);
      say(`[${label}] open:`, opened?.code);
      expect(opened?.code).toBe("tesSUCCESS");
      for (const id of ACTIONS)
        say(`[${label}] action ${id}:`, (await demo.runAction(id))?.result.code);
      for (const attack of ATTACKS.filter((a) => !a.needsExpiry && a.needsMode !== "C")) {
        const entry = await demo.runAttack(attack.id);
        say(
          `[${label}] attack ${attack.id}:`,
          entry?.result.code,
          "fee charged:",
          entry?.result.feeClaimed,
        );
      }
      say(`[${label}] own close:`, (await demo.closeSession())?.code);
    }
  }, 600_000);

  it("mode C: the 20 XRP cap and the sixth payment", async () => {
    const live = await backend();
    const demo = createDemo(live);
    await demo.createAccount("mac");
    say(
      "[C] open:",
      (
        await demo.openSession({
          mode: "C",
          durationSec: 600,
          permissions: [],
          capDrops: 20_000_000,
        })
      )?.code,
    );
    for (let i = 1; i <= 6; i += 1) {
      const entry = await demo.runAction("payment");
      say(`[C] payment ${i}:`, entry?.result.code, "spent:", demo.state.session?.spentDrops);
    }
    say("[C] ticket:", (await demo.runAction("ticket"))?.result.code);
    say("[C] cap overflow:", (await demo.runAttack("cap-overflow"))?.result.code);
  }, 600_000);

  it("expiry: a 6 s session, then the attack after expiry and the own close", async () => {
    const live = await backend();
    const demo = createDemo(live);
    await demo.createAccount("demo");
    await demo.openSession({ mode: "A", durationSec: 6, permissions: [], capDrops: 0 });
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await demo.refresh();
      if (
        demo.state.server &&
        demo.state.session &&
        demo.state.server.closeTime >= demo.state.session.expiration
      )
        break;
    }
    say("[expiry] after expiry:", (await demo.runAttack("after-expiry"))?.result.code);
    say("[expiry] own close:", (await demo.closeSession())?.code);
  }, 600_000);
});
