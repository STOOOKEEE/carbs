// Where the wallet finds the node and the faucet.
// Deployed: `tailscale serve` (tailnet, :9449) or `tailscale funnel` (public, :10000) proxies the
// page at "/" and the node's WebSocket at "/node" on the same origin, so the page works on any of
// them. In development, VITE_NODE_URL overrides it.

/** Path that the proxy maps to the node's public WebSocket, next to the page. */
const NODE_PATH = "/node";
/** The node's own HTTPS port on the tailnet, which the XRPL explorer connects to. */
const EXPLORER_NODE_PORT = 9448;

/** Development only: a node at another address (e.g. ws://127.0.0.1:6006). */
const DEV_NODE_URL: string | undefined = import.meta.env["VITE_NODE_URL"];

export const NODE_URL: string = DEV_NODE_URL ?? `wss://${location.host}${NODE_PATH}`;

export const FAUCET_PATH = "/api/faucet";

/** The XRPL explorer follows a node at the root of a host:port: custom.xrpl.org/<host:port>. */
export const EXPLORER_BASE =
  DEV_NODE_URL === undefined
    ? `https://custom.xrpl.org/${location.hostname}:${EXPLORER_NODE_PORT}`
    : `https://custom.xrpl.org/${new URL(DEV_NODE_URL).host}`;
