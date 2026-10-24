import { inject, type InjectionKey } from "vue";
import type { Demo } from "./demo";
import type { DevicePrompt } from "./device-prompt";
import type { Migration } from "./migration";
import type { NetworkStore } from "./network-store";
import type { Backend, ExposurePort } from "./ports";
import type { WalletsApi } from "./wallets/api";

export const BACKEND_KEY: InjectionKey<Backend> = Symbol("carbs-backend");
export const DEMO_KEY: InjectionKey<Demo> = Symbol("carbs-demo");
export const MIGRATION_KEY: InjectionKey<Migration> = Symbol("carbs-migration");
export const NETWORK_KEY: InjectionKey<NetworkStore> = Symbol("carbs-network");
export const WALLETS_KEY: InjectionKey<WalletsApi> = Symbol("carbs-wallets");
export const LIVE_EXPOSURE_KEY: InjectionKey<ExposurePort> = Symbol("carbs-live-exposure");
export const LIVE_MIGRATION_KEY: InjectionKey<Migration> = Symbol("carbs-live-migration");
export const DEVICE_PROMPT_KEY: InjectionKey<DevicePrompt> = Symbol("carbs-device-prompt");

function required<T>(key: InjectionKey<T>): T {
  const value = inject(key);
  if (value === undefined) throw new Error(`Missing provider: ${String(key.description)}`);
  return value;
}

export const useBackend = (): Backend => required(BACKEND_KEY);
export const useDemo = (): Demo => required(DEMO_KEY);
export const useMigration = (): Migration => required(MIGRATION_KEY);
export const useDevicePrompt = (): DevicePrompt => required(DEVICE_PROMPT_KEY);
export const useNetwork = (): NetworkStore => required(NETWORK_KEY);
export const useWallets = (): WalletsApi => required(WALLETS_KEY);
export const useLiveExposure = (): ExposurePort => required(LIVE_EXPOSURE_KEY);
export const useLiveMigration = (): Migration => required(LIVE_MIGRATION_KEY);
