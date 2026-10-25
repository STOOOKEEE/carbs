// Minimal JSON-RPC over WebSocket to xrpld, shared by the browser and the faucet server
// (both have a global WebSocket). No xrpl.js: this node speaks types (passkeys, ML-DSA)
// that the library's default definitions do not know, so encoding uses server_definitions.

export interface RpcResult {
  [key: string]: unknown;
}

interface RpcReply {
  id?: number;
  status?: string;
  type?: string;
  result?: RpcResult;
  error?: string;
  error_message?: string;
}

interface Pending {
  resolve: (result: RpcResult) => void;
  reject: (error: Error) => void;
}

function isRpcReply(value: unknown): value is RpcReply {
  return typeof value === "object" && value !== null;
}

// No TypeScript parameter properties here: the faucet server runs this file with
// Node's type stripping, which only removes types.
export class RpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class NodeClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values())
        reject(new Error("connection to the node closed"));
      this.pending.clear();
    });
  }

  static connect(url: string): Promise<NodeClient> {
    const { promise, resolve, reject } = Promise.withResolvers<NodeClient>();
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(new NodeClient(socket)), { once: true });
    socket.addEventListener("error", () => reject(new Error(`cannot reach the node at ${url}`)), {
      once: true,
    });
    return promise;
  }

  request(command: string, params: Record<string, unknown> = {}): Promise<RpcResult> {
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<RpcResult>();
    this.pending.set(id, { resolve, reject });
    this.socket.send(JSON.stringify({ id, command, ...params }));
    return promise;
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(data: string): void {
    const reply: unknown = JSON.parse(data);
    if (!isRpcReply(reply) || reply.id === undefined) return;
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    if (reply.status === "error" || reply.error !== undefined) {
      const code = reply.error ?? "unknown";
      pending.reject(new RpcError(code, reply.error_message ?? code));
    } else {
      pending.resolve(reply.result ?? {});
    }
  }
}
