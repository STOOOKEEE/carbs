/**
 * The networks the app knows. The local node is the standalone node of `infra/` on the
 * person's machine (URL from the environment, spec 6.12); the team node is the same node on
 * the team's server, behind TLS. AlphaNet and mainnet (read-only, spec 8.7) serve the Quantum
 * screen. The same list builds the Content-Security-Policy (`lib/csp.ts`), so a host that is
 * not listed here cannot be contacted. The explorers are only linked to (navigation, in a new
 * tab), so they are not in it.
 */

export type NetworkId = "alphanet" | "local" | "team" | "mainnet";

export interface AppNetwork {
  id: NetworkId;
  name: string;
  /** XRPL network id, when the network has one that we rely on. */
  networkId: number | null;
  wss: string;
  rpc: string;
  faucet: string | null;
  /** Base of the public explorer's pages (`/accounts/<address>`, `/transactions/<hash>`). */
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
/** The team's node on its server, behind TLS, reachable on the team's tailnet. */
export const DEFAULT_TEAM_WSS = "wss://debian-docker.tail8b5861.ts.net:9448";
/** The faucet of the team's wallet server (`apps/passkey-wallet`, `/api/faucet`). */
export const DEFAULT_TEAM_FAUCET = "https://debian-docker.tail8b5861.ts.net:9449/api/faucet";
/** Hosts that browsers treat as potentially trustworthy over plain ws:// and http://. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export interface LocalEndpoints {
  wss: string;
  rpc: string;
  faucet?: string;
}

export interface TeamEndpoints {
  wss: string;
  faucet?: string;
}

export function createNetworks(
  local: LocalEndpoints = {
    wss: DEFAULT_LOCAL_WSS,
    rpc: DEFAULT_LOCAL_RPC,
    faucet: DEFAULT_LOCAL_FAUCET,
  },
  team: TeamEndpoints = { wss: DEFAULT_TEAM_WSS, faucet: DEFAULT_TEAM_FAUCET },
): Record<NetworkId, AppNetwork> {
  return {
    alphanet: {
      id: "alphanet",
      name: "AlphaNet",
      networkId: 24100,
      wss: "wss://alphanet.xrpl.org",
      rpc: "https://rpc.alphanet.xrpl.org",
      faucet: "https://faucet.alphanet.xrpl.org/accounts",
      // The XRPL Explorer in custom-network mode: the AlphaNet host itself serves no explorer.
      explorer: "https://custom.xrpl.org/alphanet.xrpl.org",
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
    team: {
      id: "team",
      name: "Team node",
      networkId: null,
      wss: team.wss,
      rpc: localRpcFor(team.wss),
      faucet: team.faucet ?? null,
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
/** A custom URL for the local node, typed in the Local node dialog. */
export const LOCAL_URL_STORAGE_KEY = "carbs-local-node-url";

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

/** Whether `hostname` (as `URL.hostname` gives it) is this machine's loopback. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.includes(hostname.toLowerCase());
}

/**
 * Whether a node URL can be used from a page served over `pageProtocol`. A page served over
 * https cannot call ws:// or http:// on another host (mixed content), so it accepts wss:// and
 * https:// there. The loopback (localhost, 127.0.0.1, [::1]) is potentially trustworthy for
 * browsers, so its ws:// and http:// URLs are allowed from an https page too. An http page
 * accepts all four.
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
    return { ok: false, reason: "Use a ws://, wss://, http:// or https:// URL." };
  }
  if (pageProtocol === "https:" && !secure && !isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      reason:
        "This page is served over https, so the browser blocks ws:// and http:// on any host but localhost (mixed content). Use a wss:// or https:// URL.",
    };
  }
  return { ok: true, reason: null };
}

/** The origins (scheme, host, port) a network needs in `connect-src`: its node and its faucet. */
export function networkOrigins(network: AppNetwork): string[] {
  // The app talks to our own nodes over their public WebSocket only (the local HTTP port is
  // the admin RPC).
  const rpc = network.id === "local" || network.id === "team" ? null : network.rpc;
  // The explorer is only linked to, never fetched: navigation needs no connect-src.
  const origins = [network.wss, rpc, network.faucet]
    .filter((value): value is string => value !== null)
    .map((value) => new URL(value).origin);
  return [...new Set(origins)];
}

/** `ws://host:6006` -> the JSON-RPC URL of the same host (default port for localhost). */
export function localRpcFor(wss: string): string {
  try {
    const url = new URL(wss);
    if (isLoopbackHost(url.hostname)) return DEFAULT_LOCAL_RPC;
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url.origin;
  } catch {
    return DEFAULT_LOCAL_RPC;
  }
}

/** Every origin the page may connect to: the nodes and faucets of all configured networks. */
export function allConnectOrigins(networks: Record<NetworkId, AppNetwork>): string[] {
  return [...new Set(Object.values(networks).flatMap(networkOrigins))];
}
