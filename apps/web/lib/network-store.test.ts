import { describe, expect, it } from "vitest";
import { createNetworkStore, type KeyValueStorage } from "./network-store";

function memory(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("network store", () => {
  it("defaults to AlphaNet and persists the choice under the carbs key", () => {
    const storage = memory();
    const store = createNetworkStore({ storage });
    expect(store.selected().id).toBe("alphanet");
    store.select("local");
    expect(storage.data["carbs-network"]).toBe("local");
    expect(createNetworkStore({ storage }).selected().id).toBe("local");
    expect(Object.keys(storage.data)).not.toContain("scaffold-xrp-network");
  });

  it("ignores a saved value that is not selectable (mainnet, the old Testnet)", () => {
    expect(
      createNetworkStore({ storage: memory({ "carbs-network": "mainnet" }) }).selected().id,
    ).toBe("alphanet");
    expect(
      createNetworkStore({ storage: memory({ "carbs-network": "testnet" }) }).selected().id,
    ).toBe("alphanet");
  });

  it("works without storage", () => {
    const store = createNetworkStore({ storage: null });
    store.select("local");
    expect(store.selected().id).toBe("local");
  });

  it("refuses ws:// nodes on an https page and does not save them", () => {
    const storage = memory();
    const store = createNetworkStore({ storage, pageProtocol: "https:" });
    const result = store.setLocalWss("ws://node.example.org:6006");
    expect(result.ok).toBe(false);
    expect(storage.data["carbs-local-node-url"]).toBeUndefined();
    expect(store.check().ok).toBe(false);
    expect(store.setLocalWss("wss://node.example.org:6006").ok).toBe(true);
    expect(storage.data["carbs-local-node-url"]).toBe("wss://node.example.org:6006");
  });

  it("links transactions to the explorer of the selected network", () => {
    const store = createNetworkStore({ storage: null });
    expect(store.explorerTx("ABC")).toBe(
      "https://custom.xrpl.org/alphanet.xrpl.org/transactions/ABC",
    );
    store.select("local");
    expect(store.explorerTx("ABC")).toBeNull();
  });
});
