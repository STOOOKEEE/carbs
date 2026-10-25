import { describe, expect, it } from "vitest";
import { isLedgerMode, type LedgerSignals } from "./ledger-mode";

const idle: LedgerSignals = {
  profile: null,
  walletId: null,
  connectingWalletId: null,
  deviceConnected: false,
  deviceBusy: false,
  reviewing: false,
};

describe("Ledger mode", () => {
  it("is off with no Ledger involved: no account, a Mac account, a demo account", () => {
    expect(isLedgerMode(idle)).toBe(false);
    expect(isLedgerMode({ ...idle, profile: "mac" })).toBe(false);
    expect(isLedgerMode({ ...idle, walletId: "passkey-mac" })).toBe(false);
    expect(isLedgerMode({ ...idle, walletId: "demo-account" })).toBe(false);
  });

  it.each([
    ["a Ledger account is created or used", { profile: "ledger" }],
    ["the Ledger Stax wallet is connected", { walletId: "ledger-stax" }],
    ["the Ledger Stax wallet is connecting", { connectingWalletId: "ledger-stax" }],
    ["a real Stax is connected", { deviceConnected: true }],
    ["a real Stax is being connected", { deviceBusy: true }],
    ["the device asks for a review", { reviewing: true }],
  ] as const)("is on when %s", (_name, signal) => {
    expect(isLedgerMode({ ...idle, ...signal })).toBe(true);
  });
});
