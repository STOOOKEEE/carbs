import { reactive } from "vue";
import type { AccountInfo } from "xrpl-connect";
import { WEBHID_MESSAGE } from "../browser-support";
import type { Backend } from "../ports";
import type { CarbsAdapter } from "./adapters";
import {
  simulatedParts,
  type SimulatedPart,
  type WalletDescription,
  type WalletId,
} from "./catalog";

/** What the manager does for us; `WalletManager` of xrpl-connect satisfies it. */
export interface ManagerLike {
  connect(walletId: string): Promise<AccountInfo>;
  disconnect(): Promise<void>;
}

export interface WalletEntry {
  description: WalletDescription;
  available: boolean;
  /** Why it is unavailable, in one sentence. */
  unavailableReason: string | null;
  /** The parts of this wallet that are SIMULATED right now. */
  simulated: SimulatedPart[];
}

export interface WalletsState {
  entries: WalletEntry[];
  connectedId: WalletId | null;
  address: string | null;
  connecting: WalletId | null;
  error: string | null;
}

const PASSKEY_UNAVAILABLE =
  "WebAuthn needs a browser with passkeys and a secure context (https or localhost).";

/** The wallet entry's logic, separate from the modal so that it can be tested alone. */
export function createWalletsApi(
  manager: ManagerLike,
  adapters: readonly CarbsAdapter[],
  backend: Backend,
  authenticatorSimulated: boolean,
) {
  const state = reactive<WalletsState>({
    entries: [],
    connectedId: null,
    address: null,
    connecting: null,
    error: null,
  });

  async function refresh(): Promise<void> {
    const entries: WalletEntry[] = [];
    for (const adapter of adapters) {
      const available = await adapter.isAvailable();
      const reason =
        adapter.id === "ledger-stax"
          ? WEBHID_MESSAGE
          : adapter.id === "passkey-mac"
            ? PASSKEY_UNAVAILABLE
            : null;
      entries.push({
        description: adapter.description,
        available,
        unavailableReason: available ? null : reason,
        simulated: simulatedParts(
          adapter.description,
          backend.mode === "simulated",
          authenticatorSimulated,
          backend.device.mode === "simulated",
        ),
      });
    }
    state.entries = entries;
  }

  async function connect(id: WalletId): Promise<boolean> {
    state.connecting = id;
    state.error = null;
    try {
      const account = await manager.connect(id);
      state.connectedId = id;
      state.address = account.address;
      return true;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      state.connecting = null;
    }
  }

  async function disconnect(): Promise<void> {
    await manager.disconnect();
    state.connectedId = null;
    state.address = null;
  }

  return { state, refresh, connect, disconnect };
}

export type WalletsApi = ReturnType<typeof createWalletsApi>;
