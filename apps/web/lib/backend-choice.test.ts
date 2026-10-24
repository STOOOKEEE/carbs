import { describe, expect, it } from "vitest";
import { BACKEND_STORAGE_KEY, readBackendChoice, saveBackendChoice } from "./backend-choice";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("backend choice", () => {
  it("defaults to the simulation", () => {
    expect(readBackendChoice(memory(), undefined)).toBe("simulated");
    expect(readBackendChoice(null, "")).toBe("simulated");
  });

  it("takes the build's default, then the saved choice over it", () => {
    expect(readBackendChoice(memory(), "live")).toBe("live");
    expect(readBackendChoice(memory({ [BACKEND_STORAGE_KEY]: "simulated" }), "live")).toBe(
      "simulated",
    );
  });

  it("ignores a saved value it does not know", () => {
    expect(readBackendChoice(memory({ [BACKEND_STORAGE_KEY]: "production" }), "live")).toBe("live");
  });

  it("saves, and survives a storage that throws", () => {
    const storage = memory();
    saveBackendChoice(storage, "live");
    expect(storage.data[BACKEND_STORAGE_KEY]).toBe("live");
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readBackendChoice(blocked, "live")).toBe("live");
    expect(() => saveBackendChoice(blocked, "live")).not.toThrow();
  });
});
