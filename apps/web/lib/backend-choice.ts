/** Which backend the page runs on: the simulation (default) or the live node. */
export type BackendChoice = "simulated" | "live";

export const BACKEND_STORAGE_KEY = "carbs-backend";

export function isBackendChoice(value: unknown): value is BackendChoice {
  return value === "simulated" || value === "live";
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The saved choice, else the build's default (`NUXT_PUBLIC_BACKEND`), else the simulation. */
export function readBackendChoice(storage: Storage | null, fallback: unknown): BackendChoice {
  try {
    const saved = storage?.getItem(BACKEND_STORAGE_KEY);
    if (isBackendChoice(saved)) return saved;
  } catch {
    // Storage can be blocked: the default applies.
  }
  return isBackendChoice(fallback) ? fallback : "simulated";
}

export function saveBackendChoice(storage: Storage | null, choice: BackendChoice): void {
  try {
    storage?.setItem(BACKEND_STORAGE_KEY, choice);
  } catch {
    // Not saved; the choice then lasts for this page only.
  }
}
