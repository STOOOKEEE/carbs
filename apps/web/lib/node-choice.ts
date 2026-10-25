/**
 * The one choice of the header: which node the Account, Session, Actions and Attack screens
 * run on. The simulation is the default; the local node runs on the person's machine
 * (`pnpm demo`), the team node on the team's server. The Quantum screen reads the public
 * networks and does not follow this choice.
 */
export type NodeChoice = "simulated" | "local" | "team";

/** The live choices, in the order the header lists them. */
export type LiveNodeChoice = Exclude<NodeChoice, "simulated">;

export const NODE_CHOICES: readonly { id: NodeChoice; label: string }[] = [
  { id: "simulated", label: "Simulated" },
  { id: "local", label: "Local node" },
  { id: "team", label: "Team node" },
];

export const NODE_STORAGE_KEY = "carbs-node";

export function isNodeChoice(value: unknown): value is NodeChoice {
  return value === "simulated" || value === "local" || value === "team";
}

export function isLiveChoice(value: NodeChoice): value is LiveNodeChoice {
  return value !== "simulated";
}

/** Minimal storage surface, so tests can pass a fake (or none). */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The build's default (`NUXT_PUBLIC_BACKEND`): `local` or `team`; `live`, its former value,
 * means the local node; anything else is the simulation.
 */
export function defaultNodeChoice(fallback: unknown): NodeChoice {
  if (fallback === "live") return "local";
  return isNodeChoice(fallback) ? fallback : "simulated";
}

/** The saved choice, else the build's default, else the simulation. */
export function readNodeChoice(storage: ChoiceStorage | null, fallback: unknown): NodeChoice {
  try {
    const saved = storage?.getItem(NODE_STORAGE_KEY);
    if (isNodeChoice(saved)) return saved;
  } catch {
    // Storage can be blocked: the default applies.
  }
  return defaultNodeChoice(fallback);
}

export function saveNodeChoice(storage: ChoiceStorage | null, choice: NodeChoice): void {
  try {
    storage?.setItem(NODE_STORAGE_KEY, choice);
  } catch {
    // Not saved; the choice then lasts for this page only.
  }
}

/** Forget the saved choice: the build's default applies on the next load. */
export function clearNodeChoice(storage: ChoiceStorage | null): void {
  try {
    storage?.removeItem(NODE_STORAGE_KEY);
  } catch {
    // Nothing saved, or storage blocked.
  }
}
