import { describe, expect, it } from "vitest";
import {
  NETWORKS,
  allConnectOrigins,
  checkNodeUrl,
  createNetworks,
  explorerAccountUrl,
  explorerTxUrl,
  isLoopbackHost,
  localRpcFor,
} from "./networks";

describe("networks", () => {
  it("knows AlphaNet, the local node, the team node and read-only mainnet", () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(["alphanet", "local", "mainnet", "team"]);
    const alpha = NETWORKS.alphanet;
    expect(alpha.networkId).toBe(24100);
    expect(alpha.rpc).toBe("https://rpc.alphanet.xrpl.org");
    expect(alpha.wss).toBe("wss://alphanet.xrpl.org");
    expect(alpha.faucet).toBe("https://faucet.alphanet.xrpl.org/accounts");
    expect(alpha.explorer).toBe("https://custom.xrpl.org/alphanet.xrpl.org");
    expect(NETWORKS.local.wss).toBe("ws://localhost:6006");
    expect(NETWORKS.mainnet.readOnly).toBe(true);
    expect(NETWORKS.mainnet.faucet).toBeNull();
  });

  it("presets the team node and its faucet, and takes them from the configuration", () => {
    expect(NETWORKS.team.wss).toBe("wss://debian-docker.tail8b5861.ts.net:9448");
    expect(NETWORKS.team.faucet).toBe("https://debian-docker.tail8b5861.ts.net:9449/api/faucet");
    expect(NETWORKS.team.explorer).toBeNull();
    const custom = createNetworks(undefined, {
      wss: "wss://team.example.org:9448",
      faucet: "https://team.example.org:9449/api/faucet",
    });
    expect(custom.team.wss).toBe("wss://team.example.org:9448");
    expect(allConnectOrigins(custom)).toEqual(
      expect.arrayContaining(["wss://team.example.org:9448", "https://team.example.org:9449"]),
    );
  });

  it("puts the team node's WebSocket and faucet in connect-src, not its RPC port", () => {
    const origins = allConnectOrigins(NETWORKS);
    expect(origins).toContain("wss://debian-docker.tail8b5861.ts.net:9448");
    expect(origins).toContain("https://debian-docker.tail8b5861.ts.net:9449");
    expect(origins).not.toContain("https://debian-docker.tail8b5861.ts.net:9448");
    expect(origins).toContain("ws://localhost:6006");
    expect(origins).toContain("http://localhost:3005");
    expect(origins).not.toContain("http://localhost:5005");
  });

  it("has no Testnet, Devnet or WalletConnect leftover", () => {
    const text = JSON.stringify(NETWORKS).toLowerCase();
    expect(text).not.toContain("testnet");
    expect(text).not.toContain("devnet");
    expect(text).not.toContain("walletconnect");
  });

  it("links transactions and accounts to the explorer of the network", () => {
    expect(explorerTxUrl(NETWORKS.alphanet, "ABC")).toBe(
      "https://custom.xrpl.org/alphanet.xrpl.org/transactions/ABC",
    );
    expect(explorerTxUrl(NETWORKS.mainnet, "ABC")).toBe(
      "https://livenet.xrpl.org/transactions/ABC",
    );
    expect(explorerAccountUrl(NETWORKS.alphanet, "rX")).toBe(
      "https://custom.xrpl.org/alphanet.xrpl.org/accounts/rX",
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
    expect(origins).toContain("https://xrplcluster.com");
    expect(origins.every((o) => /^(wss?|https?):\/\/[^/]+$/.test(o))).toBe(true);
  });

  it("leaves the explorers out of connect-src: they are only linked to", () => {
    const origins = allConnectOrigins(NETWORKS);
    for (const explorer of [NETWORKS.alphanet.explorer, NETWORKS.mainnet.explorer]) {
      expect(origins).not.toContain(new URL(explorer ?? "").origin);
    }
  });
});

describe("node URL rules", () => {
  it("over https accepts wss:// and https:// on any host", () => {
    expect(checkNodeUrl("wss://node.example.org", "https:").ok).toBe(true);
    expect(checkNodeUrl("https://node.example.org", "https:").ok).toBe(true);
  });

  it("over https accepts ws:// and http:// on the loopback, which browsers trust", () => {
    for (const url of [
      "ws://localhost:6006",
      "http://localhost:3005/accounts",
      "ws://127.0.0.1:6006",
      "http://127.0.0.1:3005/accounts",
      "ws://[::1]:6006",
      "http://[::1]:3005/accounts",
      "ws://LOCALHOST:6006",
    ]) {
      expect(checkNodeUrl(url, "https:"), url).toEqual({ ok: true, reason: null });
    }
  });

  it("over https refuses ws:// and http:// on any other host, and says why", () => {
    for (const url of [
      "ws://node.example.org",
      "http://node.example.org",
      "ws://192.168.1.10:6006",
      "ws://localhost.example.org:6006",
      "ws://127.0.0.2:6006",
      "ws://debian-docker.tail8b5861.ts.net:9448",
    ]) {
      const result = checkNodeUrl(url, "https:");
      expect(result.ok, url).toBe(false);
      expect(result.reason).toContain("mixed content");
    }
  });

  it("knows the loopback by name and by address", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("node.localhost.example")).toBe(false);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
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
