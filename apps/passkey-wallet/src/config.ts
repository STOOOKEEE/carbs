// Where the wallet finds the node and the faucet.
// Deployed: the page and the node are served by `tailscale serve` on the same host,
// the node on its own HTTPS port (wss). In development, VITE_NODE_URL overrides it.

/** HTTPS port that `tailscale serve` maps to the node's public WebSocket. */
const NODE_TLS_PORT = 9448;

export const NODE_URL: string =
  import.meta.env["VITE_NODE_URL"] ?? `wss://${location.hostname}:${NODE_TLS_PORT}`;

export const FAUCET_PATH = "/api/faucet";

/** The XRPL explorer can follow any node: custom.xrpl.org/<host:port>. */
export const EXPLORER_BASE = `https://custom.xrpl.org/${new URL(NODE_URL).host}`;
