import { describe, expect, it } from "vitest";
import { addressFromPublicKey, mlDsaKeyPairFromSeed } from "@carbs/sessions";
import { NETWORKS } from "../networks";
import { createLiveClients } from "./clients";
import { LiveExposure } from "./exposure";
import { FakeAlphaNet } from "./fake-alphanet";
import { createLiveMigration } from "./migration";

function rig(options: { approve?: boolean; network?: typeof NETWORKS.alphanet } = {}) {
  const fake = new FakeAlphaNet();
  const clients = createLiveClients(
    () => NETWORKS,
    () => fake,
  );
  const reviews: string[][] = [];
  const migration = createLiveMigration({
    clients,
    exposure: new LiveExposure(clients),
    network: () => options.network ?? NETWORKS.alphanet,
    approver: async (review) => {
      reviews.push(review.lines.map((l) => `${l.label}: ${l.value}`));
      return options.approve ?? true;
    },
    fetcher: fake.faucet,
    sleep: async () => undefined,
  });
  return { fake, migration, reviews };
}

async function through(migration: ReturnType<typeof rig>["migration"], upTo: 1 | 2 | 3) {
  await migration.start();
  for (const id of [1, 2, 3] as const) {
    if (id > upTo) break;
    if (id === 3) {
      await migration.proveRecoverable();
      migration.state.recoveryConfirmed = true;
      migration.state.authoritiesReviewed = true;
    }
    await migration.runStep(id);
  }
}

describe("live migration on the AlphaNet (node double, SIMULATED device)", () => {
  it("starts on a fresh funded account with a complete, unexposed history", async () => {
    const { migration, fake } = rig();
    await migration.start();
    expect(migration.state.error).toBeNull();
    expect(migration.state.address).toMatch(/^r/);
    expect(fake.accounts.has(migration.state.address ?? "")).toBe(true);
    expect(migration.state.steps.map((s) => s.status)).toEqual(["todo", "todo", "todo"]);
    expect(migration.state.before?.status).toBe("no-exposure-found");
    expect(migration.state.before?.simulated).toBe(false);
  });

  it("runs the three steps in order and ends with the master disabled and a post-quantum regular key", async () => {
    const { migration, fake, reviews } = rig();
    await through(migration, 3);
    expect(migration.state.error).toBeNull();
    expect(migration.state.steps.map((s) => s.result?.code)).toEqual([
      "tesSUCCESS",
      "tesSUCCESS",
      "tesSUCCESS",
    ]);
    expect(migration.state.steps.every((s) => s.status === "ok")).toBe(true);
    const account = fake.accounts.get(migration.state.address ?? "");
    expect(account?.masterDisabled).toBe(true);
    expect(account?.regularKey).toMatch(/^r/);
    // Three confirmations on the (simulated) device, each with the account on its screen.
    expect(reviews).toHaveLength(3);
    expect(
      reviews.every((lines) => lines.some((l) => l === `Account: ${migration.state.address}`)),
    ).toBe(true);
    expect(migration.state.after?.status).toBe("no-exposure-found");
  });

  it("refuses the proof before the regular key is set, and sends nothing", async () => {
    const { migration, fake } = rig();
    await migration.start();
    await migration.runStep(2);
    expect(migration.state.steps[1]?.status).toBe("refused");
    expect(migration.state.steps[1]?.refusal).toContain("Step 1 must be accepted first");
    expect(fake.requests).not.toContain("submit");
  });

  it("refuses asfDisableMaster until the seed is saved and the authorities are reviewed", async () => {
    const { migration, fake } = rig();
    await migration.start();
    await migration.runStep(1);
    await migration.runStep(2);
    const submits = () => fake.requests.filter((r) => r === "submit").length;
    expect(submits()).toBe(2);

    await migration.runStep(3);
    const first = migration.state.steps[2];
    expect(first?.status).toBe("refused");
    expect(first?.refusal).toContain("not proven recoverable");
    expect(first?.refusal).toContain("were not acknowledged");

    await migration.proveRecoverable();
    expect(migration.state.recoverySeed).toMatch(/^[0-9A-F]{128}$/);
    migration.state.authoritiesReviewed = true;
    await migration.runStep(3);
    expect(migration.state.steps[2]?.refusal).toContain("not proven recoverable");

    migration.state.recoveryConfirmed = true;
    await migration.runStep(3);
    expect(migration.state.steps[2]?.status).toBe("ok");
    expect(submits()).toBe(3);
  });

  it("derives the ML-DSA key from the seed it shows, so that the backup restores it", async () => {
    const { migration, fake } = rig();
    await through(migration, 2);
    await migration.proveRecoverable();
    expect(migration.state.recoverySeed).not.toBeNull();
    const account = fake.accounts.get(migration.state.address ?? "");
    expect(account?.regularKey).toMatch(/^r/);
    // The seed is the device's BIP39 seed; the key is derived from it by SLIP-21 (core of @carbs/ledger).
    const { deviceMlDsaSeed } = await import("@carbs/ledger");
    const hex = migration.state.recoverySeed ?? "";
    const seed = Uint8Array.from(hex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
    const restored = addressFromPublicKey(mlDsaKeyPairFromSeed(deviceMlDsaSeed(seed)).publicKey);
    expect(restored).toBe(account?.regularKey);
  });

  it("sends nothing when the device rejects", async () => {
    const { migration, fake } = rig({ approve: false });
    await migration.start();
    await migration.runStep(1);
    expect(migration.state.error).toContain("Rejected on the device");
    expect(fake.requests).not.toContain("submit");
    expect(migration.state.steps[0]?.status).toBe("todo");
  });

  it("refuses a read-only network", async () => {
    const { migration, fake } = rig({ network: NETWORKS.mainnet });
    await migration.start();
    expect(migration.state.error).toContain("read-only");
    expect(migration.state.address).toBeNull();
    expect(fake.accounts.size).toBe(0);
  });

  it("shows the node's own refusal when a step fails", async () => {
    const { migration, fake } = rig();
    await migration.start();
    await migration.runStep(1);
    const account = fake.accounts.get(migration.state.address ?? "");
    if (account) account.regularKey = "rSomeoneElseSomeoneElseSomeone1"; // the node no longer knows our key
    await migration.runStep(2);
    expect(migration.state.steps[1]?.result?.code).toBe("tefBAD_AUTH");
    expect(migration.state.steps[1]?.status).toBe("failed");
  });
});
