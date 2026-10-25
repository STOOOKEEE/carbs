// WebSocket upgrades on the wallet's origin are piped to the node, so one origin serves both the
// pages and the node: the pages connect to wss://<host>, and so can the XRPL explorer
// (custom.xrpl.org/<host>). Plain HTTP requests never reach this module.

import type { IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";

const WEBSOCKET_PROTOCOL = "ws:";
const DEFAULT_WS_PORT = 80;
const HEADER_LINE_END = "\r\n";

type UpgradeHandler = (req: IncomingMessage, client: Duplex, head: Buffer) => void;

/** The `upgrade` listener for an HTTP server: forwards each WebSocket handshake to `nodeWsUrl`. */
export function nodeUpgradeProxy(nodeWsUrl: string): UpgradeHandler {
  const target = new URL(nodeWsUrl);
  if (target.protocol !== WEBSOCKET_PROTOCOL)
    throw new Error(`node proxy: ${nodeWsUrl} is not a ws:// URL`);
  const port = target.port === "" ? DEFAULT_WS_PORT : Number(target.port);

  return (req, client, head) => {
    if (req.headers.upgrade?.toLowerCase() !== "websocket") {
      client.destroy();
      return;
    }
    const upstream = connect(port, target.hostname, () => {
      upstream.write(handshake(req, target.host));
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    const close = (error: Error): void => {
      console.error(`node proxy: ${req.url ?? "/"}: ${error.message}`);
      upstream.destroy();
      client.destroy();
    };
    upstream.on("error", close);
    client.on("error", close);
    upstream.on("close", () => client.destroy());
    client.on("close", () => upstream.destroy());
  };
}

/** The client's handshake as received, addressed to the node's host. */
function handshake(req: IncomingMessage, nodeHost: string): string {
  const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
  const raw = req.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] ?? "";
    const value = raw[index + 1] ?? "";
    lines.push(`${name}: ${name.toLowerCase() === "host" ? nodeHost : value}`);
  }
  return lines.join(HEADER_LINE_END) + HEADER_LINE_END + HEADER_LINE_END;
}
