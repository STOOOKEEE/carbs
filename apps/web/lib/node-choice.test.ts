import { describe, expect, it } from "vitest";
import {
  NODE_CHOICES,
  NODE_STORAGE_KEY,
  clearNodeChoice,
  readNodeChoice,
  saveNodeChoice,
  type ChoiceStorage,
} from "./node-choice";

function memory(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  };
}

describe("node choice", () => {
  it("offers three nodes, the simulation first", () => {
    expect(NODE_CHOICES.map((c) => c.label)).toEqual(["Simulated", "Local node", "Team node"]);
  });

  it("defaults to the simulation", () => {
    expect(readNodeChoice(memory(), undefined)).toBe("simulated");
    expect(readNodeChoice(null, "")).toBe("simulated");
    expect(readNodeChoice(memory(), "production")).toBe("simulated");
  });

  it("takes the build's default; `live`, its former value, means the local node", () => {
    expect(readNodeChoice(memory(), "local")).toBe("local");
    expect(readNodeChoice(memory(), "team")).toBe("team");
    expect(readNodeChoice(memory(), "live")).toBe("local");
  });

  it("prefers the saved choice, and ignores a saved value it does not know", () => {
    expect(readNodeChoice(memory({ [NODE_STORAGE_KEY]: "team" }), "local")).toBe("team");
    expect(readNodeChoice(memory({ [NODE_STORAGE_KEY]: "simulated" }), "local")).toBe("simulated");
    expect(readNodeChoice(memory({ [NODE_STORAGE_KEY]: "live" }), undefined)).toBe("simulated");
  });

  it("saves and forgets the choice, and survives a storage that throws", () => {
    const storage = memory();
    saveNodeChoice(storage, "team");
    expect(storage.data[NODE_STORAGE_KEY]).toBe("team");
    clearNodeChoice(storage);
    expect(storage.data[NODE_STORAGE_KEY]).toBeUndefined();
    const blocked: ChoiceStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    expect(readNodeChoice(blocked, "team")).toBe("team");
    expect(() => saveNodeChoice(blocked, "local")).not.toThrow();
    expect(() => clearNodeChoice(blocked)).not.toThrow();
  });
});
