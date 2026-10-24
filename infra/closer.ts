// Closes a ledger on the standalone node at a fixed interval (FIANSO-SPEC 6.12, task N9).
// A standalone xrpld never closes ledgers by itself; session expiry is measured on
// ledger close time, so this is the node's clock.
// Run: XRPLD_ADMIN_WS=ws://127.0.0.1:6007 node infra/closer.ts

const DEFAULT_ADMIN_WS = "ws://127.0.0.1:6007";
const CLOSE_INTERVAL_MS = 3_000;
const RECONNECT_DELAY_MS = 2_000;

const adminUrl = process.env["XRPLD_ADMIN_WS"] ?? DEFAULT_ADMIN_WS;

interface RpcAnswer {
  error?: string;
}

function isRpcAnswer(value: unknown): value is RpcAnswer {
  return typeof value === "object" && value !== null;
}

function connect(): void {
  const socket = new WebSocket(adminUrl);

  socket.addEventListener("open", () => {
    console.log(`closer: connected to ${adminUrl}, closing every ${CLOSE_INTERVAL_MS} ms`);
    const timer = setInterval(
      () => socket.send(JSON.stringify({ command: "ledger_accept" })),
      CLOSE_INTERVAL_MS,
    );
    socket.addEventListener("close", () => clearInterval(timer));
  });

  socket.addEventListener("message", (event) => {
    const parsed: unknown = JSON.parse(String(event.data));
    if (isRpcAnswer(parsed) && parsed.error !== undefined) {
      console.error(`closer: ledger_accept failed: ${parsed.error}`);
    }
  });

  socket.addEventListener("close", () => {
    console.error(`closer: connection closed, retrying in ${RECONNECT_DELAY_MS} ms`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  socket.addEventListener("error", () => {
    console.error(`closer: cannot reach ${adminUrl}`);
  });
}

connect();
