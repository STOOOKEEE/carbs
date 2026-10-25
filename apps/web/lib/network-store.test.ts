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
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe("network store", () => {
  it("starts on the simulation, which stands in for the local node", () => {
    const store = createNetworkStore({ storage: memory() });
    expect(store.state.node).toBe("simulated");
    expect(store.selected().id).toBe("local");
    store.state.node = "team";
    expect(store.selected().id).toBe("team");
  });

  it("takes the local and team endpoints from the configuration", () => {
    const store = createNetworkStore({
      localWss: "ws://127.0.0.1:6006",
      localFaucet: "http://127.0.0.1:3005/accounts",
      teamWss: "wss://team.example.org:9448",
      teamFaucet: "https://team.example.org:9449/api/faucet",
    });
    expect(store.nodeNetwork("local").wss).toBe("ws://127.0.0.1:6006");
    expect(store.nodeNetwork("local").faucet).toBe("http://127.0.0.1:3005/accounts");
    expect(store.nodeNetwork("team").wss).toBe("wss://team.example.org:9448");
    expect(store.nodeNetwork("team").faucet).toBe("https://team.example.org:9449/api/faucet");
  });

  it("accepts the default local node from an https page (the loopback is trusted)", () => {
    const store = createNetworkStore({ storage: null, pageProtocol: "https:" });
    expect(store.check("local").ok).toBe(true);
    expect(store.check("team").ok).toBe(true);
  });

  it("refuses a plain ws:// node on another host from an https page and does not keep it", () => {
    const storage = memory();
    const store = createNetworkStore({ storage, pageProtocol: "https:" });
    const result = store.setLocalWss("ws://node.example.org:6006");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("mixed content");
    expect(store.state.localWss).toBe("ws://localhost:6006");
    expect(storage.data["carbs-local-node-url"]).toBeUndefined();
    expect(store.setLocalWss("wss://node.example.org:6006").ok).toBe(true);
    expect(storage.data["carbs-local-node-url"]).toBe("wss://node.example.org:6006");
    expect(createNetworkStore({ storage }).nodeNetwork("local").wss).toBe(
      "wss://node.example.org:6006",
    );
  });

  it("goes back to the default local URL when the custom one is cleared", () => {
    const storage = memory({ "carbs-local-node-url": "ws://127.0.0.1:7006" });
    const store = createNetworkStore({ storage });
    expect(store.state.localWss).toBe("ws://127.0.0.1:7006");
    expect(store.setLocalWss("  ").ok).toBe(true);
    expect(store.state.localWss).toBe("ws://localhost:6006");
    expect(storage.data["carbs-local-node-url"]).toBeUndefined();
  });

  it("works without storage, and with a storage that throws", () => {
    expect(createNetworkStore({ storage: null }).setLocalWss("ws://127.0.0.1:7006").ok).toBe(true);
    const blocked: KeyValueStorage = {
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
    const store = createNetworkStore({ storage: blocked });
    expect(store.state.localWss).toBe("ws://localhost:6006");
    expect(store.setLocalWss("ws://127.0.0.1:7006").ok).toBe(true);
    expect(store.setLocalWss("").ok).toBe(true);
  });
});
