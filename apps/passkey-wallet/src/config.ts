// Where the wallet finds the node and the faucet.
// Deployed: the wallet server pipes WebSocket upgrades on its own origin to the node
// (server/node-proxy.ts), so the page, and the XRPL explorer, reach the node at wss://<host>
// whether the origin is the tailnet one (:9449) or the public funnel (:10000).
// In development, VITE_NODE_URL overrides it.

export const NODE_URL: string = import.meta.env["VITE_NODE_URL"] ?? `wss://${location.host}`;

export const FAUCET_PATH = "/api/faucet";

/** The XRPL explorer follows any node: custom.xrpl.org/<host:port>. */
export const EXPLORER_BASE = `https://custom.xrpl.org/${new URL(NODE_URL).host}`;
