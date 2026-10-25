/**
 * Ledger mode: the whole app switches to the Ledger look (dark, violet, silk background)
 * while a Ledger is involved, and back to the XRPL Commons look when it is not. Only colours
 * change (assets/tokens.css); buttons, fonts and layout stay the same.
 */
import { computed, type ComputedRef } from "vue";
import { useDemo, useDeviceSelection, useDevicePrompt, useWallets } from "./context";

export interface LedgerSignals {
  /** The account being set up or used is a Ledger account. */
  profile: string | null;
  /** The wallet connected (or being connected) through the wallet entry. */
  walletId: string | null;
  connectingWalletId: string | null;
  /** A real Stax is connected, or is being connected. */
  deviceConnected: boolean;
  deviceBusy: boolean;
  /** The (simulated) device is asking for a review. */
  reviewing: boolean;
}

export const LEDGER_WALLET_ID = "ledger-stax";
export const LEDGER_PROFILE = "ledger";

export function isLedgerMode(signals: LedgerSignals): boolean {
  return (
    signals.profile === LEDGER_PROFILE ||
    signals.walletId === LEDGER_WALLET_ID ||
    signals.connectingWalletId === LEDGER_WALLET_ID ||
    signals.deviceConnected ||
    signals.deviceBusy ||
    signals.reviewing
  );
}

export function useLedgerMode(): ComputedRef<boolean> {
  const demo = useDemo();
  const wallets = useWallets();
  const device = useDeviceSelection();
  const prompt = useDevicePrompt();
  return computed(() =>
    isLedgerMode({
      profile: demo.state.profile,
      walletId: wallets.state.connectedId,
      connectingWalletId: wallets.state.connecting,
      deviceConnected: device.connected,
      deviceBusy: device.busy,
      reviewing: prompt.review !== null,
    }),
  );
}
