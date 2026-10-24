/** One test per defect found by the independent review of the web app. */
import { addressFromPublicKey, mlDsaKeyPairFromSeed, type FinalResult } from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import { createSimBackend } from "./backend";
import { createDemo } from "./demo";
import { createDevicePrompt } from "./device-prompt";
import { LiveExposure } from "./live/exposure";
import { createLiveClients } from "./live/clients";
import { FakeAlphaNet } from "./live/fake-alphanet";
import { createLiveMigration } from "./live/migration";
import { createLiveBackend } from "./live/backend";
import { toNodeResult } from "./live/result";
import { NETWORKS } from "./networks";
import type { ExposureReport } from "./ports";
import { softwarePasskeySource } from "./wallets/passkey";
import { accountIdOf, simPublicKey, signWith } from "./sim/keys";
import { SimulatedNode } from "./sim/node";

const A = { mode: "A" as const, durationSec: 600, permissions: [], capDrops: 0 };

describe("a result is final only when the node said its last word", () => {
  const make = (result: string, validated: boolean): FinalResult => ({
    hash: "AB".repeat(32),
    result,
    validated,
    ledgerIndex: validated ? 10 : undefined,
    submit: {
      engineResult: result,
      engineResultCode: 0,
      engineResultMessage: "",
      hash: "AB".repeat(32),
      accepted: true,
    },
  });

  it("does not call an unvalidated tesSUCCESS a success", () => {
    const result = toNodeResult(make("tesSUCCESS", false));
    expect(result).toMatchObject({ success: false, feeClaimed: false, final: false });
  });

  it("keeps a validated tesSUCCESS and a definitive refusal", () => {
    expect(toNodeResult(make("tesSUCCESS", true))).toMatchObject({
      success: true,
      final: true,
      feeClaimed: true,
    });
    expect(toNodeResult(make("tefBAD_AUTH", false))).toMatchObject({
      success: false,
      final: true,
      feeClaimed: false,
    });
  });
});

describe("the store", () => {
  it("keeps the node's answer when the refresh after it fails", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    await demo.openSession(A);
    backend.node.accountObjects = async () => {
      throw new Error("tooBusy");
    };
    const entry = await demo.runAction("ticket");
    expect(entry?.result.code).toBe("tesSUCCESS");
    expect(demo.state.error).toBeNull();
    expect(demo.state.actionLog).toHaveLength(1);
  });

  it("does not let a slow poll overwrite a newer refresh", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    await demo.openSession(A);
    expect(demo.state.session).not.toBeNull();

    const real = backend.node.accountObjects.bind(backend.node);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    backend.node.accountObjects = async (address) => {
      calls += 1;
      if (calls === 1) {
        await gate; // the slow poll, which read the state before the session existed
        return { sessions: [], passkeys: [], signerList: null };
      }
      return real(address);
    };
    const slow = demo.refresh();
    await demo.refresh();
    release();
    await slow;
    expect(demo.state.session).not.toBeNull();
  });

  it("the poll never throws and skips while an action runs", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    backend.node.serverInfo = async () => {
      throw new Error("down");
    };
    await expect(demo.tick()).resolves.toBeUndefined();
  });

  it("is not ready when the setup failed half-way, so the other screens ask for an account", async () => {
    const backend = createSimBackend();
    backend.simDevice.setApprover(async () => false);
    const demo = createDemo(backend);
    expect(await demo.createAccount("ledger")).toBe(false);
    expect(demo.state.ready).toBe(false);
    expect(demo.state.address).not.toBeNull(); // the partial setup stays visible on the Account screen
  });

  it("creates a second Ledger account on a fresh device", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    expect(await demo.createAccount("ledger")).toBe(true);
    const first = demo.state.address;
    expect(await demo.createAccount("ledger")).toBe(true);
    expect(demo.state.address).not.toBe(first);
    expect(demo.state.ready).toBe(true);
  });

  it("keeps the logs bounded", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    await demo.openSession(A);
    for (let i = 0; i < 55; i += 1) await demo.runAction("ticket");
    expect(demo.state.actionLog.length).toBeLessThanOrEqual(50);
  });

  it("funds the victim account only for the attack that needs it", async () => {
    const backend = createSimBackend();
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    await demo.openSession(A);
    await demo.runAttack("regular-key");
    expect(await backend.node.accountInfo(backend.counterparties.victim)).toBeNull();
    await demo.runAttack("other-account");
    expect(await backend.node.accountInfo(backend.counterparties.victim)).not.toBeNull();
  });
});

describe("the simulated node checks in the order of spec 6.5", () => {
  it("answers a malformed session opening with tem before it looks for the account", async () => {
    const node = new SimulatedNode();
    const pub = simPublicKey("secp256k1", "nobody");
    const tx = signWith(pub, {
      TransactionType: "SigningSessionSet",
      Account: accountIdOf(pub),
      Fee: "12",
      SessionKey: accountIdOf(simPublicKey("p256", "k")),
      SessionDuration: 60,
    });
    expect((await node.submit(tx)).code).toBe("temMALFORMED"); // no mode set
  });

  it("refuses a stranger's key before it looks at the fee", async () => {
    const node = new SimulatedNode();
    const owner = simPublicKey("secp256k1", "owner");
    const account = accountIdOf(owner);
    await node.fundAccount(account);
    const stranger = simPublicKey("secp256k1", "stranger");
    const tx = signWith(stranger, {
      TransactionType: "Payment",
      Account: account,
      Destination: accountIdOf(simPublicKey("secp256k1", "d")),
      Amount: "2000000",
      Fee: "1",
      Sequence: (await node.accountInfo(account))?.sequence ?? 0,
    });
    expect((await node.submit(tx)).code).toBe("tefBAD_AUTH");
  });
});

describe("the device prompt shows one review at a time", () => {
  it("queues a second request instead of replacing the first", async () => {
    const prompt = createDevicePrompt();
    const review = (title: string) => ({ title, lines: [], simulated: true });
    const first = prompt.approver(review("first"));
    const second = prompt.approver(review("second"));
    await Promise.resolve();
    expect(prompt.review?.title).toBe("first");
    prompt.answer(true);
    await expect(first).resolves.toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(prompt.review?.title).toBe("second");
    prompt.answer(false);
    await expect(second).resolves.toBe(false);
    expect(prompt.review).toBeNull();
  });
});

describe("the live migration never shows another run's seed", () => {
  class FlakyExposure extends LiveExposure {
    calls = 0;
    override async check(
      address: string,
      network: Parameters<LiveExposure["check"]>[1],
    ): Promise<ExposureReport> {
      this.calls += 1;
      if (this.calls === 2) throw new Error("tooBusy");
      return super.check(address, network);
    }
  }

  it("shows the seed of the latest start even when its exposure check failed", async () => {
    const fake = new FakeAlphaNet();
    const clients = createLiveClients(
      () => NETWORKS,
      () => fake,
    );
    const migration = createLiveMigration({
      clients,
      exposure: new FlakyExposure(clients),
      network: () => NETWORKS.alphanet,
      approver: async () => true,
      fetcher: fake.faucet,
      sleep: async () => undefined,
    });
    await migration.start();
    expect(migration.state.error).toBeNull();
    await migration.start(); // the exposure check fails this time
    expect(migration.state.error).toContain("tooBusy");
    await migration.runStep(1);
    await migration.proveRecoverable();
    const { deviceMlDsaSeed } = await import("@carbs/ledger");
    const hex = migration.state.recoverySeed ?? "";
    const seed = Uint8Array.from(hex.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
    const restored = addressFromPublicKey(mlDsaKeyPairFromSeed(deviceMlDsaSeed(seed)).publicKey);
    expect(restored).toBe(fake.accounts.get(migration.state.address ?? "")?.regularKey);
  });
});

describe("the live backend labels what is real", () => {
  it("does not call the real faucet or the browser's passkey simulated", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    let faucetCalls = 0;
    const backend = await createLiveBackend({
      client: fake,
      network: () => ({ ...NETWORKS.local, faucet: "http://localhost:3005/accounts" }),
      approver: () => async () => true,
      passkeys: { ...softwarePasskeySource(), simulated: false },
      exposure: {
        mode: "live",
        async check() {
          throw new Error("n/a");
        },
      },
      fetcher: async (...args) => {
        faucetCalls += 1;
        return fake.faucet(...args);
      },
      sleep: async () => undefined,
    });
    const demo = createDemo(backend);
    await demo.createAccount("mac");
    const labels = demo.state.steps.map((s) => s.label).join(" | ");
    expect(labels).toContain("Fund the account at the faucet");
    expect(labels).not.toContain("SIMULATED");
    expect(faucetCalls).toBe(1);
    await demo.openSession(A);
    await demo.runAttack("regular-key");
    expect(faucetCalls).toBe(1); // the victim account is not funded for this attack
  });
});
