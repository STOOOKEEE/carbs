// @vitest-environment node
/**
 * The real `WebSocketClient` against a node that accepts the TCP connection and never answers
 * the WebSocket handshake (a stalled proxy, a firewall that swallows the upgrade): after the
 * timeout, the dialog's probe and the page load must hang up, not leave the socket connecting.
 */
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createAppContext } from "./app-context";
import { chooseBackend } from "./boot";
import { probeNode } from "./node-probe";
import { softwarePasskeySource } from "./wallets/passkey";

interface Stalled {
  url: string;
  connections: Socket[];
  ended: () => number;
}

let server: Server | undefined;
let open: Socket[] = [];

async function stalledNode(): Promise<Stalled> {
  let ended = 0;
  const connections: Socket[] = [];
  server = createServer((socket) => {
    connections.push(socket);
    open.push(socket);
    socket.on("data", () => undefined);
    socket.on("close", () => (ended += 1));
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `ws://127.0.0.1:${port}`, connections, ended: () => ended };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !done(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(done()).toBe(true);
}

afterEach(() => {
  for (const socket of open) socket.destroy();
  open = [];
  server?.close();
  server = undefined;
});

describe("hanging up on a node that never completes the handshake", () => {
  it("the dialog's probe times out and closes the socket", async () => {
    const node = await stalledNode();
    const result = await probeNode(node.url, { timeoutMs: 200 });
    expect(result).toEqual({ ok: false, reason: `${node.url} did not answer within 0.2 s` });
    expect(node.connections).toHaveLength(1);
    await until(() => node.ended() === 1);
  });

  it("the page load times out, stays on the simulation and closes the socket", async () => {
    const node = await stalledNode();
    const ctx = createAppContext({ localWss: node.url });
    const { status } = await chooseBackend(ctx, {
      requested: "local",
      passkeys: softwarePasskeySource(),
      timeoutMs: 200,
    });
    expect(status.active).toBe("simulated");
    expect(status.error).toBe(`${node.url} did not answer within 0.2 s`);
    expect(node.connections).toHaveLength(1);
    await until(() => node.ended() === 1);
  });
});
