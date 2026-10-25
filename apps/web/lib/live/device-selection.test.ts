import { describe, expect, it } from "vitest";
import { addressFromPublicKey, bytesToHex, classicSignerFromSeed } from "@carbs/sessions";
import { kInsPqSign } from "@carbs/ledger";
import { NETWORKS } from "../networks";
import { createLiveClients } from "./clients";
import { createLiveDevice } from "./device";
import {
  NOT_CONNECTED_MESSAGE,
  createDeviceSelection,
  createSelectableDevice,
  watchLedgerDisconnects,
} from "./device-selection";
import { LiveExposure } from "./exposure";
import { FakeAlphaNet } from "./fake-alphanet";
import { fakeStax, type FakeStax } from "./fake-stax";
import { LEDGER_STAX_USB_MODEL } from "./ledger-device";
import { createLiveMigration } from "./migration";

const LEDGER_VENDOR_ID = 0x2c97;
const OTHER_VENDOR_ID = 0x046d;

function rig() {
  const fake = new FakeAlphaNet();
  const staxes: FakeStax[] = [];
  const selection = createDeviceSelection(async () => {
    const stax = fakeStax(fake.defs, staxes.length + 1);
    staxes.push(stax);
    return stax.device;
  });
  const device = createSelectableDevice(
    selection,
    createLiveDevice(fake.defs, () => async () => true),
    fake.defs,
  );
  return { fake, selection, device, staxes };
}

function hidDisconnect(vendorId: number): Event {
  return Object.assign(new Event("disconnect"), { device: { vendorId } });
}

describe("device selection", () => {
  it("starts on the simulated device, labelled SIMULATED", () => {
    const { selection, device } = rig();
    expect(selection.choice).toBe("simulated");
    expect(selection.connected).toBe(false);
    expect(device.mode).toBe("simulated");
    expect(device.model).toMatch(/^SIMULATED/);
  });

  it("forwards the connected Stax's XRP signer kit through its transport, and none once closed", async () => {
    const { selection, staxes } = rig();
    expect(selection.transport.signer).toBeUndefined();
    await selection.connect();
    const signer = { getAppConfig: () => ({}) };
    Object.assign(staxes[0]!.device, { signer });
    expect(selection.transport.signer).toBe(signer);
    await selection.disconnect();
    expect(selection.transport.signer).toBeUndefined();
  });

  it("chosen but not connected, the Stax is never called SIMULATED and refuses to sign", async () => {
    const { selection, device } = rig();
    await selection.choose("usb");
    expect(device.mode).toBe("live");
    expect(device.model).toBe(`${LEDGER_STAX_USB_MODEL}, not connected`);
    await expect(device.getPublicKey("secp256k1")).rejects.toThrow(NOT_CONNECTED_MESSAGE);
  });

  it("connects the Stax, reads its keys and closes it on disconnect", async () => {
    const { selection, device, staxes } = rig();
    await selection.choose("usb");
    await selection.connect();
    expect(selection.connected).toBe(true);
    expect(device.model).toBe(LEDGER_STAX_USB_MODEL);
    const stax = staxes[0];
    if (stax === undefined) throw new Error("not connected");
    const key = await device.getPublicKey("secp256k1");
    expect(key.publicKey).toBe(bytesToHex(classicSignerFromSeed(stax.classicSeed).publicKey));
    const review = device.review({
      TransactionType: "AccountSet",
      Account: key.address,
      Fee: "12",
    });
    expect(review.simulated).toBe(false);

    await selection.disconnect();
    expect(stax.closes).toBe(1);
    expect(selection.connected).toBe(false);
    await expect(device.getPublicKey("secp256k1")).rejects.toThrow(NOT_CONNECTED_MESSAGE);
  });

  it("closes the Stax when the person goes back to the simulated device", async () => {
    const { selection, device, staxes } = rig();
    await selection.connect();
    await selection.choose("simulated");
    expect(staxes[0]?.closes).toBe(1);
    expect(device.mode).toBe("simulated");
  });

  it("reads the keys of a newly connected Stax, not the previous one's", async () => {
    const { selection, device } = rig();
    await selection.connect();
    const first = await device.getPublicKey("mldsa44");
    await selection.disconnect();
    await selection.connect();
    expect((await device.getPublicKey("mldsa44")).publicKey).not.toBe(first.publicKey);
  });

  it("describes a failed connection", async () => {
    const selection = createDeviceSelection(() =>
      Promise.reject({ _tag: "NoAccessibleDeviceError", message: "No device selected" }),
    );
    await selection.choose("usb");
    await selection.connect();
    expect(selection.connected).toBe(false);
    expect(selection.busy).toBe(false);
    expect(selection.error).toBe("NoAccessibleDeviceError · No device selected");
  });

  it("closes the session when a Ledger is unplugged or the page goes away", async () => {
    const { selection, staxes } = rig();
    const page = new EventTarget();
    const hid = new EventTarget();
    watchLedgerDisconnects(selection, page, hid);
    await selection.connect();
    hid.dispatchEvent(hidDisconnect(OTHER_VENDOR_ID));
    await Promise.resolve();
    expect(staxes[0]?.closes).toBe(0);
    hid.dispatchEvent(hidDisconnect(LEDGER_VENDOR_ID));
    await Promise.resolve();
    expect(staxes[0]?.closes).toBe(1);
    expect(selection.connected).toBe(false);

    await selection.connect();
    page.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(staxes[1]?.closes).toBe(1);
  });
});

describe("live migration on the Ledger Stax (USB, fake APDU transport)", () => {
  function usbRig() {
    const { fake, selection, staxes } = rig();
    const clients = createLiveClients(
      () => NETWORKS,
      () => fake,
    );
    const migration = createLiveMigration({
      clients,
      exposure: new LiveExposure(clients),
      network: () => NETWORKS.alphanet,
      approver: async () => {
        throw new Error("a real Stax never asks the page's simulated screen");
      },
      device: selection,
      fetcher: fake.faucet,
      sleep: async () => undefined,
    });
    return { fake, selection, staxes, migration };
  }

  it("refuses to start before a Stax is connected", async () => {
    const { selection, migration } = usbRig();
    await selection.choose("usb");
    await migration.start();
    expect(migration.state.error).toBe(NOT_CONNECTED_MESSAGE);
    expect(migration.state.address).toBeNull();
  });

  it("migrates with the Stax's keys, and disables the master key only once the key read again matches after a reinstall", async () => {
    const { fake, selection, staxes, migration } = usbRig();
    await selection.connect();
    const stax = staxes[0];
    if (stax === undefined) throw new Error("not connected");

    await migration.start();
    expect(migration.state.error).toBeNull();
    expect(migration.state.realDevice).toBe(true);
    const address = migration.state.address ?? "";
    expect(address).toBe(addressFromPublicKey(classicSignerFromSeed(stax.classicSeed).publicKey));
    for (const step of migration.state.steps) {
      expect(step.signedBy).toContain("Ledger Stax (USB)");
      expect(step.signedBy).not.toMatch(/simulated/i);
    }

    await migration.runStep(1);
    expect(fake.accounts.get(address)?.regularKey).toBe(
      addressFromPublicKey(stax.contract.mlDsaPublicKey),
    );
    await migration.runStep(2);
    expect(migration.state.steps[1]?.status).toBe("ok");
    expect(stax.instructions).toContain(kInsPqSign);

    // Read again without confirming the reinstall: the key matches, but it is no evidence yet.
    migration.state.authoritiesReviewed = true;
    await migration.proveRecoverable();
    expect(migration.state.recoverableProven).toBe(false);
    expect(migration.state.recoverySeed).toBeNull();
    await migration.runStep(3);
    expect(migration.state.steps[2]?.refusal).toContain("after reinstalling the app");

    // The XRP app was reinstalled: the Stax is reconnected and the key read again.
    await selection.disconnect();
    expect(stax.closes).toBe(1);
    await selection.connect();
    expect(staxes).toHaveLength(2);
    migration.state.recoveryConfirmed = true;
    await migration.proveRecoverable();
    // A different device (another seed) answers another key: refused, nothing sent.
    expect(migration.state.error).toMatch(/different ML-DSA-44 key/);
    expect(migration.state.recoverableProven).toBe(false);
    await migration.runStep(3);
    expect(migration.state.steps[2]?.refusal).toContain("differs from the key of the plan");
    expect(fake.accounts.get(address)?.masterDisabled).toBe(false);
  });

  it("disables the master key when the same Stax answers the same key after the reinstall", async () => {
    const fake = new FakeAlphaNet();
    const stax = fakeStax(fake.defs);
    const selection = createDeviceSelection(async () => stax.device);
    const clients = createLiveClients(
      () => NETWORKS,
      () => fake,
    );
    const migration = createLiveMigration({
      clients,
      exposure: new LiveExposure(clients),
      network: () => NETWORKS.alphanet,
      approver: async () => false,
      device: selection,
      fetcher: fake.faucet,
      sleep: async () => undefined,
    });
    await selection.connect();
    await migration.start();
    await migration.runStep(1);
    await migration.runStep(2);
    await selection.disconnect();
    await selection.connect();
    migration.state.recoveryConfirmed = true;
    migration.state.authoritiesReviewed = true;
    await migration.proveRecoverable();
    expect(migration.state.error).toBeNull();
    expect(migration.state.recoverableProven).toBe(true);
    await migration.runStep(3);
    expect(migration.state.steps[2]?.status).toBe("ok");
    expect(fake.accounts.get(migration.state.address ?? "")?.masterDisabled).toBe(true);
    expect(stax.reviews).toEqual(["classic", "ml-dsa", "classic"]);
  });
});
