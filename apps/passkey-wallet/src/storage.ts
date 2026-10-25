// The wallet kept in this browser (proof of concept on a test node).
// The master seed stays here until the account is locked to its passkey;
// it is never sent anywhere. Do not reuse this storage with real funds.

import type { Passkey } from "./passkey.ts";

const STORAGE_KEY = "carbs.passkey-wallet.v1";

export interface StoredWallet {
  address: string;
  /** Classical master key seed; deleted once the master key is disabled. */
  masterSeed?: string;
  passkey?: Passkey;
  /** The master key is disabled and the regular key is the black hole: only the passkey signs. */
  passkeyOnly: boolean;
}

function isStoredWallet(value: unknown): value is StoredWallet {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "address") === "string" &&
    typeof Reflect.get(value, "passkeyOnly") === "boolean"
  );
}

export function loadWallet(): StoredWallet | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!isStoredWallet(parsed))
    throw new Error("the stored wallet is unreadable; clear it to start again");
  return parsed;
}

export function saveWallet(wallet: StoredWallet): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
}

export function clearWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}
