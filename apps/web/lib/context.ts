import { inject, type InjectionKey } from "vue";
import type { Demo } from "./demo";
import type { DevicePrompt } from "./device-prompt";
import type { Migration } from "./migration";
import type { Backend } from "./ports";

export const BACKEND_KEY: InjectionKey<Backend> = Symbol("carbs-backend");
export const DEMO_KEY: InjectionKey<Demo> = Symbol("carbs-demo");
export const MIGRATION_KEY: InjectionKey<Migration> = Symbol("carbs-migration");
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
