import { describe, expect, it } from "vitest";
import { createDemo } from "../demo";
import { NETWORKS } from "../networks";
import { DeviceRejectedError, type ExposurePort } from "../ports";
import { softwarePasskeySource } from "../wallets/passkey";
import { createLiveBackend } from "./backend";
import { FakeAlphaNet } from "./fake-alphanet";

const LOCAL = { ...NETWORKS.local, faucet: "http://localhost:3005/accounts" };
const noExposure: ExposurePort = {
  mode: "live",
  async check() {
    throw new Error("not used");
  },
};

async function live(fake = new FakeAlphaNet({ sessions: true })) {
  const approve = { value: true };
  const backend = await createLiveBackend({
    client: fake,
    network: () => LOCAL,
    approver: () => async () => approve.value,
    passkeys: softwarePasskeySource(),
    exposure: noExposure,
    fetcher: fake.faucet,
    sleep: async () => undefined,
  });
  return { fake, backend, approve };
}

describe("live backend", () => {
  it("refuses a node that does not serve the SigningSessions names", async () => {
    await expect(live(new FakeAlphaNet({ sessions: false }))).rejects.toThrow(
      /does not serve SigningSessions/,
    );
  });

  it("is live, has no simulated clock and real counterparties", async () => {
    const { backend } = await live();
    expect(backend.mode).toBe("live");
    expect(backend.clock).toBeNull();
    expect(backend.counterparties.sink).toMatch(/^r/);
    expect(backend.counterparties.sink).not.toMatch(/^rSim/);
    expect(backend.counterparties.sink).not.toBe(backend.counterparties.victim);
  });
});

describe("live builders (the node's shapes, from its definitions)", () => {
  it("builds the three session modes without the envelope", async () => {
    const { backend, fake } = await live();
    const b = backend.builders;
    const account = backend.counterparties.sink;
    const key = backend.counterparties.victim;
    const params = { durationSec: 600, permissions: ["Payment", "TrustSet"], capDrops: 20_000_000 };
    const all = b.sessionSet(account, key, { ...params, mode: "A" });
    expect(all["Flags"]).toBe(fake.defs.transactionFlag("SigningSessionSet", "tfAllTransactions"));
    const permissions = b.sessionSet(account, key, { ...params, mode: "P" });
    expect(permissions["Permissions"]).toEqual([
      { Permission: { PermissionValue: "Payment" } },
      { Permission: { PermissionValue: "TrustSet" } },
    ]);
    const cap = b.sessionSet(account, key, { ...params, mode: "C" });
    expect(cap["SessionCap"]).toBe("20000000");
    for (const tx of [all, permissions, cap]) {
      expect(tx.TransactionType).toBe(
        "SigningSessionDelete" === tx.TransactionType ? "" : "SigningSessionSet",
      );
      expect(tx["SessionDuration"]).toBe(600);
      for (const field of ["Sequence", "Fee", "LastLedgerSequence"]) {
        expect(tx).not.toHaveProperty(field);
      }
    }
  });

  it("takes the AccountSet flag from the definitions, not from a constant", async () => {
    const { backend, fake } = await live();
    const tx = backend.builders.accountSetDisableMaster(backend.counterparties.sink);
    expect(tx["SetFlag"]).toBe(fake.defs.accountSetFlag("asfDisableMaster"));
  });

  it("builds the passkey list in the node's object shape", async () => {
    const { backend } = await live();
    const tx = backend.builders.passkeyListSet(backend.counterparties.sink, [
      { publicKey: "F6AA", credentialId: "BB" },
    ]);
    expect(tx["Passkeys"]).toEqual([{ Passkey: { PasskeyID: "BB", PublicKey: "F6AA" } }]);
  });
});

describe("the demo store on the live backend (real encoding and signing, test double node)", () => {
  async function started(profile: "demo" | "mac" | "ledger" = "demo") {
    const rig = await live();
    const demo = createDemo(rig.backend);
    expect(await demo.createAccount(profile)).toBe(true);
    return { ...rig, demo };
  }

  it("funds an account at the faucet and reads it back from the node", async () => {
    const { demo, fake } = await started();
    expect(demo.state.error).toBeNull();
    expect(demo.state.address).toMatch(/^r/);
    expect(fake.accounts.has(demo.state.address ?? "")).toBe(true);
    expect(demo.state.info?.sequence).toBeGreaterThan(0);
  });

  it("reads no objects, instead of failing, for an account the validated ledger does not have yet", async () => {
    const { backend } = await live();
    const objects = await backend.node.accountObjects(backend.counterparties.victim);
    expect(objects).toEqual({ sessions: [], passkeys: [], signerList: null });
  });

  it("opens a mode C session signed by the master key and shows the node's session entry", async () => {
    const { demo, fake } = await started();
    const result = await demo.openSession({
      mode: "C",
      durationSec: 600,
      permissions: [],
      capDrops: 20_000_000,
    });
    expect(result?.code).toBe("tesSUCCESS");
    expect(demo.state.session?.mode).toBe("C");
    expect(demo.state.session?.capDrops).toBe(20_000_000);
    expect(demo.state.session?.spentDrops).toBe(0);
    expect(demo.state.session?.expiration).toBe(fake.closeTime - 3 + 600);
    expect(demo.state.session?.sessionKey).toBe(demo.state.sessionKey?.address);
  });

  it("signs session payments with the P-256 session key and counts them against the cap", async () => {
    const { demo } = await started();
    await demo.openSession({ mode: "C", durationSec: 600, permissions: [], capDrops: 5_000_000 });
    const first = await demo.runAction("payment");
    expect(first?.result.code).toBe("tesSUCCESS");
    expect(first?.result.hash).toMatch(/^[0-9A-F]{64}$/);
    expect(demo.state.session?.spentDrops).toBeGreaterThan(3_500_000);
    const second = await demo.runAction("payment");
    expect(second?.result.code).toBe("tefSESSION_LIMIT");
    expect(second?.result.feeClaimed).toBe(false);
  });

  it("shows the node's own refusals for the attacks", async () => {
    const { demo } = await started();
    await demo.openSession({ mode: "P", durationSec: 600, permissions: ["Payment"], capDrops: 0 });
    for (const [id, code] of [
      ["regular-key", "tefSESSION_TX_NOT_ALLOWED"],
      ["passkey", "tefSESSION_TX_NOT_ALLOWED"],
      ["disable-master", "tefSESSION_TX_NOT_ALLOWED"],
      ["open-session", "tefSESSION_TX_NOT_ALLOWED"],
      ["fee-burn", "tefSESSION_LIMIT"],
      ["no-last-ledger", "tefSESSION_TX_NOT_ALLOWED"],
    ] as const) {
      const entry = await demo.runAttack(id);
      expect(entry?.result.code, id).toBe(code);
    }
  });

  it("waits for a live session to expire, then shows tefSESSION_EXPIRED (no simulated clock)", async () => {
    const { demo, fake } = await started();
    await demo.openSession({ mode: "P", durationSec: 60, permissions: ["Payment"], capDrops: 0 });
    const early = await demo.runAttack("after-expiry");
    expect(early).toBeNull();
    expect(demo.state.error).toContain("Wait for the session to expire");
    fake.closeTime += 100;
    await demo.refresh();
    const late = await demo.runAttack("after-expiry");
    expect(late?.result.code).toBe("tefSESSION_EXPIRED");
  });

  it("closes the session with the session key itself", async () => {
    const { demo } = await started();
    await demo.openSession({ mode: "A", durationSec: 600, permissions: [], capDrops: 0 });
    const closed = await demo.closeSession();
    expect(closed?.code).toBe("tesSUCCESS");
    expect(demo.state.session).toBeNull();
  });

  it("registers a passkey and opens a session by passkey (WebAuthn over the binary signing data)", async () => {
    const { demo, fake } = await started("mac");
    expect(demo.state.error).toBeNull();
    expect(demo.state.objects?.passkeys).toHaveLength(0); // the double does not list passkey_list objects
    const opened = await demo.openSession({
      mode: "A",
      durationSec: 600,
      permissions: [],
      capDrops: 0,
    });
    expect(opened?.code).toBe("tesSUCCESS");
    const account = fake.accounts.get(demo.state.address ?? "");
    expect(account?.passkeys).toHaveLength(1);
    const last = account?.history.at(-1);
    expect(last?.tx["PasskeySignature"]).toBeDefined();
  });

  it("sets up a Ledger account on the simulated device contract", async () => {
    const { demo, fake } = await started("ledger");
    expect(demo.state.error).toBeNull();
    const account = fake.accounts.get(demo.state.address ?? "");
    expect(account?.masterDisabled).toBe(true);
    expect(account?.regularKey).toMatch(/^r/);
    expect(demo.state.info?.masterDisabled).toBe(true);
  });

  it("reports a rejection on the device and sends nothing", async () => {
    const rig = await live();
    rig.approve.value = false;
    const demo = createDemo(rig.backend);
    expect(await demo.createAccount("ledger")).toBe(false);
    expect(demo.state.error).toContain("Rejected on the device");
    expect(rig.fake.requests).not.toContain("submit");
    await expect(
      rig.backend.device.signTransaction("secp256k1", {
        TransactionType: "AccountSet",
        Account: rig.backend.counterparties.sink,
        Fee: "10",
        Sequence: 1,
      }),
    ).rejects.toBeInstanceOf(DeviceRejectedError);
  });
});

describe("counterparties on a real ledger", () => {
  it("funds the payee before the first action, since a real payment below the reserve cannot create it", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const rig = await live(fake);
    const demo = createDemo(rig.backend);
    await demo.createAccount("demo");
    await demo.openSession({ mode: "A", durationSec: 600, permissions: [], capDrops: 0 });
    expect(fake.accounts.has(rig.backend.counterparties.sink)).toBe(false);
    await demo.runAction("payment");
    expect(fake.accounts.has(rig.backend.counterparties.sink)).toBe(true);
  });
});
