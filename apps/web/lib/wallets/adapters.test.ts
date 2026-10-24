import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { WalletManager } from "xrpl-connect";
import { describe, expect, it } from "vitest";
import { createAppContext } from "../app-context";
import { DeviceRejectedError } from "../ports";
import { accountIdOf } from "../sim/keys";
import { verifyPasskeyAssertion } from "../sim/webauthn";
import { createWalletAdapters } from "./adapters";
import { WALLET_DESCRIPTIONS } from "./catalog";
import { softwarePasskeySource } from "./passkey";

function rig() {
  const ctx = createAppContext();
  ctx.sim.simDevice.setApprover(async () => true);
  const adapters = createWalletAdapters(
    { backend: ctx.backend, demo: ctx.demo, network: ctx.network },
    softwarePasskeySource(),
  );
  const manager = new WalletManager({ adapters, autoConnect: false, logger: { level: "error" } });
  return { ctx, adapters, manager };
}

const SINK = accountIdOf("sink");

function payment(account: string, drops = "2000000") {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: SINK,
    Amount: drops,
  } as const;
}

describe("the three adapters", () => {
  it("are exactly Ledger Stax, Passkey (this Mac) and Demo account", () => {
    const { adapters } = rig();
    expect(adapters.map((a) => a.name)).toEqual([
      "Ledger Stax",
      "Passkey (this Mac)",
      "Demo account",
    ]);
    expect(adapters.map((a) => a.id)).toEqual(["ledger-stax", "passkey-mac", "demo-account"]);
    expect(adapters.every((a) => a.capabilities.signMessage === false)).toBe(true);
  });

  it("describe their key type and who signs what", () => {
    for (const description of WALLET_DESCRIPTIONS) {
      expect(description.keyType.length).toBeGreaterThan(10);
      expect(description.signs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("register in the real WalletManager of xrpl-connect", () => {
    const { manager } = rig();
    expect(manager.wallets.map((w) => w.id)).toEqual([
      "ledger-stax",
      "passkey-mac",
      "demo-account",
    ]);
  });
});

describe("Demo account", () => {
  it("connects, signs and submits a payment through the manager", async () => {
    const { manager, ctx } = rig();
    const account = await manager.connect("demo-account");
    expect(account.address).toBe(ctx.demo.state.address);
    expect(account.network.name).toContain("SIMULATED");
    expect(manager.connected).toBe(true);
    const result = await manager.signAndSubmit(payment(account.address) as never);
    expect(result["engine_result"]).toBe("tesSUCCESS");
    expect(result["simulated"]).toBe(true);
    const signed = await manager.sign(payment(account.address) as never);
    expect(signed.hash).toMatch(/^[0-9A-F]{64}$/);
  });

  it("refuses a transaction of another account and message signing", async () => {
    const { manager } = rig();
    const account = await manager.connect("demo-account");
    await expect(manager.signAndSubmit(payment(SINK) as never)).rejects.toThrow(
      /connected account/,
    );
    await expect(manager.signMessage("hello")).rejects.toThrow();
    void account;
  });
});

describe("Passkey (this Mac)", () => {
  it("registers the passkey and signs with a real WebAuthn assertion", async () => {
    const { manager, ctx } = rig();
    const account = await manager.connect("passkey-mac");
    expect(ctx.demo.state.profile).toBe("mac");
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(1);
    expect(account.publicKey).toBe(ctx.demo.state.objects?.passkeys[0]);

    const signed = await ctx.demo.signAsAccount(
      await ctx.demo.prepare({ ...payment(account.address), Fee: "12" }),
    );
    expect(signed["PasskeySignature"]).toBeDefined();
    expect(verifyPasskeyAssertion(signed)).toBe(true);

    const result = await manager.signAndSubmit(payment(account.address) as never);
    expect(result["engine_result"]).toBe("tesSUCCESS");
  });

  it("is refused by the node when the assertion is tampered with", async () => {
    const { manager, ctx } = rig();
    const account = await manager.connect("passkey-mac");
    const signed = await ctx.demo.signAsAccount(
      await ctx.demo.prepare({ ...payment(account.address), Fee: "12" }),
    );
    expect(verifyPasskeyAssertion({ ...signed, Amount: "9000000" })).toBe(false);
    const result = await ctx.backend.node.submit({ ...signed, Amount: "9000000" });
    expect(result.code).toBe("temBAD_SIGNATURE");
    const wrongChallenge = { ...signed, LastLedgerSequence: Number(signed.LastLedgerSequence) + 1 };
    expect(verifyPasskeyAssertion(wrongChallenge)).toBe(false);
  });

  it("opens a session by passkey and the session key signs with no prompt", async () => {
    const { manager, ctx } = rig();
    await manager.connect("passkey-mac");
    const opened = await ctx.demo.openSession({
      mode: "A",
      durationSec: 600,
      permissions: [],
      capDrops: 0,
    });
    expect(opened?.code).toBe("tesSUCCESS");
    const action = await ctx.demo.runAction("payment");
    expect(action?.result.code).toBe("tesSUCCESS");
  });
});

describe("Ledger Stax", () => {
  it("sets up a post-quantum account in three device confirmations", async () => {
    const { manager, ctx } = rig();
    const reviews: string[] = [];
    ctx.sim.simDevice.setApprover(async (review) => {
      reviews.push(review.title);
      return true;
    });
    const account = await manager.connect("ledger-stax");
    expect(reviews).toEqual(["Set regular key?", "Account settings?", "Account settings?"]);
    expect(ctx.demo.state.info?.masterDisabled).toBe(true);
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(0);
    expect(account.publicKey?.length).toBe(2624);
  });

  it("connects nothing when the device rejects", async () => {
    const { manager, ctx } = rig();
    ctx.sim.simDevice.setApprover(async () => false);
    await expect(manager.connect("ledger-stax")).rejects.toThrow();
    expect(manager.connected).toBe(false);
    expect(DeviceRejectedError).toBeDefined();
  });
});

describe("no legacy Ledger stack, no keys, no third-party wallet", () => {
  const roots = [
    "lib",
    "plugins",
    "components",
    "layouts",
    "pages",
    "nuxt.config.ts",
    ".env.example",
  ];
  const banned = [
    /LedgerAdapter/,
    /hw-app-xrp/,
    /hw-transport/,
    /ledgerjs/i,
    /Xaman/i,
    /WalletConnect(?!or)/i,
    /GemWallet/i,
    /ApiKey/,
  ];

  function files(path: string): string[] {
    const full = join(import.meta.dirname, "..", "..", path);
    if (statSync(full).isFile()) return [full];
    return readdirSync(full).flatMap((entry) => files(join(path, entry)));
  }

  it("keeps the sources clean", () => {
    const own = roots.flatMap(files).filter((f) => !/\.test\.ts$/.test(f));
    expect(own.length).toBeGreaterThan(20);
    for (const file of own) {
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of banned) expect(text, `${file} ${pattern}`).not.toMatch(pattern);
    }
  });

  it("depends on no legacy Ledger package", () => {
    const pkg = readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8");
    expect(pkg).not.toMatch(/@ledgerhq\/hw-/);
    expect(pkg).not.toMatch(/walletconnect|xumm/i);
  });
});

describe("the adapters on the live backend (node double)", () => {
  async function liveRig() {
    const { FakeAlphaNet } = await import("../live/fake-alphanet");
    const { createLiveBackend } = await import("../live/backend");
    const { createDemo } = await import("../demo");
    const { NETWORKS } = await import("../networks");
    const fake = new FakeAlphaNet({ sessions: true });
    const ctx = createAppContext();
    const backend = await createLiveBackend({
      client: fake,
      network: () => ({ ...NETWORKS.local, faucet: "http://localhost:3005/accounts" }),
      approver: () => async () => true,
      passkeys: softwarePasskeySource(),
      exposure: {
        mode: "live",
        async check() {
          throw new Error("n/a");
        },
      },
      fetcher: fake.faucet,
      sleep: async () => undefined,
    });
    const demo = createDemo(backend);
    const adapters = createWalletAdapters(
      { backend, demo, network: ctx.network },
      softwarePasskeySource(),
    );
    const manager = new WalletManager({ adapters, autoConnect: false, logger: { level: "error" } });
    return { fake, backend, demo, manager };
  }

  it("signs with the real transaction hash and the signer's real address, not the simulation's", async () => {
    const { manager, demo, backend } = await liveRig();
    const account = await manager.connect("passkey-mac");
    const signed = await manager.sign({
      TransactionType: "Payment",
      Account: account.address,
      Destination: backend.counterparties.sink,
      Amount: "2000000",
    } as never);
    expect(signed.hash).toMatch(/^[0-9A-F]{64}$/);
    expect(signed.signerAddress).toMatch(/^r/);
    expect(signed.signerAddress).not.toMatch(/^rSim/);
    expect(signed.hash).toBe(backend.node.transactionHash(signed["tx"] as never));
    expect(demo.state.objects?.passkeys).toBeDefined();
  });

  it("registers the live wallet's passkey, which signs the node's binary signing data", async () => {
    const { manager, fake } = await liveRig();
    const account = await manager.connect("passkey-mac");
    const result = await manager.signAndSubmit({
      TransactionType: "Payment",
      Account: account.address,
      Destination: fake.accounts.keys().next().value ?? account.address,
      Amount: "2000000",
    } as never);
    expect(result["engine_result"]).toBe("tesSUCCESS");
    expect(fake.accounts.get(account.address)?.passkeys).toHaveLength(1);
  });
});
