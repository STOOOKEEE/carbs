import { describe, expect, it } from "vitest";
import {
  DEFAULT_NETWORK_ID,
  NETWORKS,
  SELECTABLE_NETWORK_IDS,
  allConnectOrigins,
  checkNodeUrl,
  createNetworks,
  explorerAccountUrl,
  explorerTxUrl,
  localRpcFor,
} from "./networks";

describe("networks", () => {
  it("knows AlphaNet, the local node and read-only mainnet, and defaults to AlphaNet", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["alphanet", "local", "mainnet"]);
    expect(DEFAULT_NETWORK_ID).toBe("alphanet");
    const alpha = NETWORKS.alphanet;
    expect(alpha.networkId).toBe(24100);
    expect(alpha.rpc).toBe("https://rpc.alphanet.xrpl.org");
    expect(alpha.wss).toBe("wss://alphanet.xrpl.org");
    expect(alpha.faucet).toBe("https://faucet.alphanet.xrpl.org/accounts");
    expect(alpha.explorer).toBe("https://alphanet.xrpl.org");
    expect(NETWORKS.local.wss).toBe("ws://localhost:6006");
    expect(NETWORKS.mainnet.readOnly).toBe(true);
    expect(NETWORKS.mainnet.faucet).toBeNull();
  });

  it("offers AlphaNet and the local node in the header, not mainnet", () => {
    expect(SELECTABLE_NETWORK_IDS).toEqual(["alphanet", "local"]);
  });

  it("has no Testnet, Devnet or WalletConnect leftover", () => {
    const text = JSON.stringify(NETWORKS).toLowerCase();
    expect(text).not.toContain("testnet");
    expect(text).not.toContain("devnet");
    expect(text).not.toContain("walletconnect");
  });

  it("links transactions and accounts to the explorer of the network", () => {
    expect(explorerTxUrl(NETWORKS.alphanet, "ABC")).toBe(
      "https://alphanet.xrpl.org/transactions/ABC",
    );
    expect(explorerTxUrl(NETWORKS.mainnet, "ABC")).toBe(
      "https://livenet.xrpl.org/transactions/ABC",
    );
    expect(explorerAccountUrl(NETWORKS.alphanet, "rX")).toBe(
      "https://alphanet.xrpl.org/accounts/rX",
    );
    expect(explorerTxUrl(NETWORKS.local, "ABC")).toBeNull();
  });

  it("takes the local node URL from the configuration", () => {
    const custom = createNetworks({
      wss: "wss://node.example.org:6006",
      rpc: "https://node.example.org",
    });
    expect(custom.local.wss).toBe("wss://node.example.org:6006");
    expect(localRpcFor("wss://node.example.org:6006")).toBe("https://node.example.org:6006");
    expect(localRpcFor("ws://localhost:6006")).toBe("http://localhost:5005");
  });

  it("lists origins, not paths or bare schemes", () => {
    const origins = allConnectOrigins(NETWORKS);
    expect(origins).toContain("wss://alphanet.xrpl.org");
    expect(origins).toContain("https://faucet.alphanet.xrpl.org");
    expect(origins).toContain("https://livenet.xrpl.org");
    expect(origins.every((o) => /^(wss?|https?):\/\/[^/]+$/.test(o))).toBe(true);
  });
});

describe("node URL rules", () => {
  it("over https accepts wss:// and https:// only, and says why", () => {
    expect(checkNodeUrl("wss://node.example.org", "https:").ok).toBe(true);
    expect(checkNodeUrl("https://node.example.org", "https:").ok).toBe(true);
    for (const url of ["ws://node.example.org", "http://node.example.org", "ws://localhost:6006"]) {
      const result = checkNodeUrl(url, "https:");
      expect(result.ok, url).toBe(false);
      expect(result.reason).toContain("mixed content");
    }
  });

  it("over http accepts the plain schemes too", () => {
    expect(checkNodeUrl("ws://localhost:6006", "http:").ok).toBe(true);
    expect(checkNodeUrl("http://localhost:5005", "http:").ok).toBe(true);
  });

  it("refuses other schemes and non-URLs", () => {
    expect(checkNodeUrl("ftp://node.example.org", "http:").ok).toBe(false);
    expect(checkNodeUrl("not a url", "http:").ok).toBe(false);
  });
});
