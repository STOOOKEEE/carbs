/**
 * The networks the app knows. AlphaNet is the default; the local node is the standalone
 * node of `infra/` (URL from the environment, spec 6.12); mainnet is read-only and used by
 * the Quantum screen only (spec 8.7). The same list builds the Content-Security-Policy
 * (`lib/csp.ts`), so a host that is not listed here cannot be contacted.
 */

export type NetworkId = "alphanet" | "local" | "mainnet";

export interface AppNetwork {
  id: NetworkId;
  name: string;
  /** XRPL network id, when the network has one that we rely on. */
  networkId: number | null;
  wss: string;
  rpc: string;
  faucet: string | null;
  explorer: string | null;
  /** Only read from; never submitted to. */
  readOnly: boolean;
}

/** Default URL of the standalone node's public WebSocket (`infra/standalone.cfg`). */
export const DEFAULT_LOCAL_WSS = "ws://localhost:6006";
/** Default URL of its JSON-RPC port. */
export const DEFAULT_LOCAL_RPC = "http://localhost:5005";
/** The dev faucet that `pnpm demo` starts for the local node (the browser never holds the genesis key). */
export const DEFAULT_LOCAL_FAUCET = "http://localhost:3005/accounts";

export function createNetworks(
  local: { wss: string; rpc: string; faucet?: string } = {
    wss: DEFAULT_LOCAL_WSS,
    rpc: DEFAULT_LOCAL_RPC,
    faucet: DEFAULT_LOCAL_FAUCET,
  },
): Record<NetworkId, AppNetwork> {
  return {
    alphanet: {
      id: "alphanet",
      name: "AlphaNet",
      networkId: 24100,
      wss: "wss://alphanet.xrpl.org",
      rpc: "https://rpc.alphanet.xrpl.org",
      faucet: "https://faucet.alphanet.xrpl.org/accounts",
      explorer: "https://alphanet.xrpl.org",
      readOnly: false,
    },
    local: {
      id: "local",
      name: "Local node",
      networkId: null,
      wss: local.wss,
      rpc: local.rpc,
      faucet: local.faucet ?? null,
      explorer: null,
      readOnly: false,
    },
    mainnet: {
      id: "mainnet",
      name: "Mainnet (read-only)",
      networkId: 0,
      wss: "wss://xrplcluster.com",
      rpc: "https://xrplcluster.com",
      faucet: null,
      explorer: "https://livenet.xrpl.org",
      readOnly: true,
    },
  };
}

export const NETWORKS = createNetworks();
export const DEFAULT_NETWORK_ID: NetworkId = "alphanet";
/** Networks the header selector offers (mainnet is for the Quantum screen). */
export const SELECTABLE_NETWORK_IDS: readonly NetworkId[] = ["alphanet", "local"];
export const NETWORK_STORAGE_KEY = "carbs-network";
export const LOCAL_URL_STORAGE_KEY = "carbs-local-node-url";

export function isNetworkId(value: unknown): value is NetworkId {
  return value === "alphanet" || value === "local" || value === "mainnet";
}

/** Link to a transaction on the explorer of `network`, or null if it has none. */
export function explorerTxUrl(network: AppNetwork, hash: string): string | null {
  if (network.explorer === null) return null;
  return `${network.explorer}/transactions/${hash}`;
}

/** Link to an account on the explorer of `network`. */
export function explorerAccountUrl(network: AppNetwork, address: string): string | null {
  if (network.explorer === null) return null;
  return `${network.explorer}/accounts/${address}`;
}

export interface UrlCheck {
  ok: boolean;
  /** Said in the UI when `ok` is false. */
  reason: string | null;
}

const SECURE_SCHEMES = ["wss:", "https:"];
const PLAIN_SCHEMES = ["ws:", "http:"];

/**
 * Whether a node URL can be used from a page served over `pageProtocol`. A page served
 * over https cannot call ws:// or http:// (mixed content), so it accepts wss:// and
 * https:// only; an http page accepts all four.
 */
export function checkNodeUrl(raw: string, pageProtocol: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  const secure = SECURE_SCHEMES.includes(url.protocol);
  if (!secure && !PLAIN_SCHEMES.includes(url.protocol)) {
    return { ok: false, reason: "Use a wss:// or https:// URL." };
  }
  if (pageProtocol === "https:" && !secure) {
    return {
      ok: false,
      reason:
        "This page is served over https, so the browser blocks ws:// and http:// nodes (mixed content). Use a wss:// or https:// URL.",
    };
  }
  return { ok: true, reason: null };
}

/** The origins (scheme, host, port) a network needs in `connect-src`. */
export function networkOrigins(network: AppNetwork): string[] {
  // The app talks to the local node over its public WebSocket only; its HTTP port is the admin RPC.
  const rpc = network.id === "local" ? null : network.rpc;
  const origins = [network.wss, rpc, network.faucet, network.explorer]
    .filter((value): value is string => value !== null)
    .map((value) => new URL(value).origin);
  return [...new Set(origins)];
}

/** `ws://host:6006` -> the JSON-RPC URL of the same host (default port for localhost). */
export function localRpcFor(wss: string): string {
  try {
    const url = new URL(wss);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return DEFAULT_LOCAL_RPC;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url.origin;
  } catch {
    return DEFAULT_LOCAL_RPC;
  }
}

/** Every origin the page may connect to: all configured networks and their explorers. */
export function allConnectOrigins(networks: Record<NetworkId, AppNetwork>): string[] {
  return [...new Set(Object.values(networks).flatMap(networkOrigins))];
}
