import { describe, expect, it } from "vitest";
import {
  isIncluded,
  NodeResultError,
  resultCategory,
  resultError,
  RpcError,
  SessionExpiredError,
  SessionLimitError,
  SessionRefusedError,
  SessionTxNotAllowedError,
} from "./errors.js";
import {
  fetchCommonFields,
  getAccountState,
  JsonRpcClient,
  NodeClientError,
  submitAndWait,
  submitBlob,
  submitSignedAndWait,
  findBySequence,
  identityOf,
  WebSocketClient,
} from "./node.js";
import { RecordedNode, type RecordedCall } from "./testing/recorded-node.js";

const account = "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK";

describe("typed results", () => {
  it("maps each tefSESSION code to its error and rule", () => {
    const expired = resultError("tefSESSION_EXPIRED", "msg", "H");
    expect(expired).toBeInstanceOf(SessionExpiredError);
    expect(expired).toBeInstanceOf(SessionRefusedError);
    expect(resultError("tefSESSION_LIMIT", "")).toBeInstanceOf(SessionLimitError);
    const notAllowed = resultError("tefSESSION_TX_NOT_ALLOWED", "");
    expect(notAllowed).toBeInstanceOf(SessionTxNotAllowedError);
    expect((notAllowed as SessionTxNotAllowedError).rule.rule).toContain("6.5");
    expect(notAllowed.included).toBe(false);
    const tec = resultError("tecNO_PERMISSION", "No permission.");
    expect(tec).toBeInstanceOf(NodeResultError);
    expect(tec).not.toBeInstanceOf(SessionRefusedError);
    expect(tec.included).toBe(true);
    expect(tec.message).toBe("tecNO_PERMISSION: No permission.");
    expect(resultCategory("temMALFORMED")).toBe("tem");
    expect(resultCategory("xyz")).toBeUndefined();
    expect(isIncluded("tesSUCCESS")).toBe(true);
    expect(isIncluded("tefBAD_AUTH")).toBe(false);
  });
});

describe("JSON-RPC client", () => {
  it("posts the method and unwraps the result; refuses methods off the public list", async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (_url, init) => {
      seen.push(String(init?.body));
      return new Response(
        JSON.stringify({ result: { status: "success", info: { network_id: 24100 } } }),
      );
    };
    const client = new JsonRpcClient("http://node", fake);
    await expect(client.request("server_info", {})).resolves.toMatchObject({
      info: { network_id: 24100 },
    });
    expect(JSON.parse(seen[0] ?? "")).toEqual({ method: "server_info", params: [{}] });
    await expect(client.request("sign", {})).rejects.toThrow(NodeClientError);
    await expect(client.request("wallet_propose", {})).rejects.toThrow(NodeClientError);
    await expect(client.request("ledger_accept", {})).rejects.toThrow(NodeClientError);
  });

  it("raises the node's error", async () => {
    const fake: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          result: { status: "error", error: "actNotFound", error_message: "Account not found." },
        }),
      );
    const client = new JsonRpcClient("http://node", fake);
    await expect(client.request("account_info", { account })).rejects.toMatchObject({
      error: "actNotFound",
    });
    await expect(getAccountState(client, account)).resolves.toBeUndefined();
  });
});

const network: RecordedCall[] = [
  { method: "server_info", params: {}, result: { info: { network_id: 24100 } } },
  { method: "fee", params: {}, result: { drops: { base_fee: "10" }, ledger_current_index: 1000 } },
];

describe("common fields and submission", () => {
  it("fills Sequence, Fee, LastLedgerSequence and NetworkID above 1024", async () => {
    const node = new RecordedNode([
      ...network,
      {
        method: "account_info",
        params: { account, ledger_index: "current" },
        result: {
          account_data: {
            Account: account,
            Sequence: 42,
            Flags: 0,
            Balance: "100000000",
            OwnerCount: 0,
          },
        },
      },
    ]);
    await expect(fetchCommonFields(node, account)).resolves.toEqual({
      Sequence: 42,
      Fee: "10",
      LastLedgerSequence: 1150,
      NetworkID: 24100,
    });
  });

  it("stops waiting at a tef answer, which is never included", async () => {
    const node = new RecordedNode([
      {
        method: "submit",
        params: { tx_blob: "AB" },
        result: {
          engine_result: "tefSESSION_EXPIRED",
          engine_result_code: -172,
          engine_result_message: "The session has expired.",
          accepted: false,
          tx_json: { hash: "H1" },
        },
      },
    ]);
    const final = await submitAndWait(node, "AB", "H1", 10);
    expect(final).toMatchObject({ result: "tefSESSION_EXPIRED", validated: false });
    expect(node.requests).toHaveLength(1);
  });

  it("waits for validation and returns the validated result", async () => {
    const node = new RecordedNode([
      ...network,
      {
        method: "submit",
        params: { tx_blob: "CD" },
        result: {
          engine_result: "tesSUCCESS",
          engine_result_code: 0,
          engine_result_message: "",
          accepted: true,
          tx_json: { hash: "H2" },
        },
      },
      {
        method: "tx",
        params: { transaction: "H2" },
        result: {
          validated: true,
          ledger_index: 999,
          meta: { TransactionResult: "tecNO_DST_INSUF_XRP" },
        },
      },
    ]);
    const final = await submitAndWait(node, "CD", "H2", 1100, { sleep: async () => undefined });
    expect(final).toMatchObject({
      result: "tecNO_DST_INSUF_XRP",
      validated: true,
      ledgerIndex: 999,
    });
    await expect(submitBlob(node, "CD")).resolves.toMatchObject({
      engineResult: "tesSUCCESS",
      hash: "H2",
    });
  });

  it("gives up once LastLedgerSequence has passed", async () => {
    const node = new RecordedNode([
      { method: "server_info", params: {}, result: { info: {} } },
      {
        method: "fee",
        params: {},
        result: { drops: { base_fee: "10" }, ledger_current_index: 1200 },
      },
      {
        method: "submit",
        params: { tx_blob: "EF" },
        result: {
          engine_result: "terQUEUED",
          engine_result_code: -89,
          engine_result_message: "",
          accepted: true,
        },
      },
      { method: "tx", params: { transaction: "H3" }, error: { error: "txnNotFound" } },
    ]);
    const final = await submitAndWait(node, "EF", "H3", 1100, { sleep: async () => undefined });
    expect(final).toMatchObject({ result: "terQUEUED", validated: false });
    expect(new RpcError("tx", "txnNotFound", "").message).toBe("tx: txnNotFound");
  });
});

describe("rate limits", () => {
  it("retries tooBusy with the server's hint, then gives up", async () => {
    let calls = 0;
    const waits: number[] = [];
    const busy = () =>
      new Response(
        JSON.stringify({
          result: {
            status: "error",
            error: "tooBusy",
            error_message: "rate limit: retry in ~1234ms",
          },
        }),
      );
    const fake: typeof fetch = async () => {
      calls += 1;
      return calls < 3 ? busy() : new Response(JSON.stringify({ result: { ok: true } }));
    };
    const client = new JsonRpcClient("http://node", fake, {
      sleep: async (ms) => void waits.push(ms),
    });
    await expect(client.request("server_info", {})).resolves.toEqual({ ok: true });
    expect(waits).toEqual([1234, 1234]);
    const always: typeof fetch = async () => busy();
    const limited = new JsonRpcClient("http://node", always, {
      busyRetries: 1,
      sleep: async () => undefined,
    });
    await expect(limited.request("server_info", {})).rejects.toMatchObject({ error: "tooBusy" });
  });
});

describe("local-check refusals", () => {
  it("returns submit's invalidTransaction as a result with the node's exception text", async () => {
    const node = new RecordedNode([
      {
        method: "submit",
        params: { tx_blob: "AA" },
        error: {
          error: "invalidTransaction",
          error_message: "",
          error_exception: "fails local checks: Invalid signature.",
        },
      },
    ]);
    const final = await submitAndWait(node, "AA", "H4", 10);
    expect(final).toMatchObject({ result: "invalidTransaction", validated: false });
    expect(final.submit.engineResultMessage).toBe("fails local checks: Invalid signature.");
  });
});

describe("WebSocket client", () => {
  it("sends `command` with the parameters and maps the answer and the error", async () => {
    const sent: Record<string, unknown>[] = [];
    class FakeSocket extends EventTarget {
      static readonly OPEN = 1;
      readyState = 1;
      constructor(readonly url: string) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      send(text: string) {
        const message = JSON.parse(text) as Record<string, unknown>;
        sent.push(message);
        const reply =
          message["command"] === "submit"
            ? {
                id: message["id"],
                status: "error",
                error: "invalidTransaction",
                error_exception: "fails local checks: Invalid signature.",
              }
            : { id: message["id"], status: "success", result: { info: { network_id: 0 } } };
        queueMicrotask(() =>
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(reply) })),
        );
      }
      close() {}
    }
    const original = globalThis.WebSocket;
    Object.defineProperty(globalThis, "WebSocket", { value: FakeSocket, configurable: true });
    try {
      const client = new WebSocketClient("ws://node");
      await expect(client.request("server_info", {})).resolves.toEqual({ info: { network_id: 0 } });
      expect(sent[0]).toEqual({ id: 1, command: "server_info" });
      await expect(submitBlob(client, "AB")).resolves.toMatchObject({
        engineResult: "invalidTransaction",
        engineResultMessage: "fails local checks: Invalid signature.",
      });
      await expect(client.request("sign", {})).rejects.toThrow(NodeClientError);
      client.close();
    } finally {
      Object.defineProperty(globalThis, "WebSocket", { value: original, configurable: true });
    }
  });
});

describe("identity by (Account, Sequence)", () => {
  it("finds a transaction whose id changed on the way (a re-encoded P-256 signature)", async () => {
    const node = new RecordedNode([
      ...network,
      {
        method: "submit",
        params: { tx_blob: "BB" },
        result: {
          engine_result: "tesSUCCESS",
          engine_result_code: 0,
          engine_result_message: "",
          accepted: true,
        },
      },
      { method: "tx", params: { transaction: "OURS" }, error: { error: "txnNotFound" } },
      {
        method: "account_info",
        params: { account, ledger_index: "validated" },
        result: {
          account_data: { Account: account, Sequence: 8, Flags: 0, Balance: "1", OwnerCount: 0 },
        },
      },
      {
        method: "account_tx",
        params: { account, ledger_index_min: -1, ledger_index_max: -1, limit: 20 },
        result: {
          transactions: [
            {
              hash: "THEIRS",
              ledger_index: 900,
              validated: true,
              tx_json: { Account: account, Sequence: 7 },
              meta: { TransactionResult: "tesSUCCESS" },
            },
          ],
        },
      },
    ]);
    const final = await submitSignedAndWait(
      node,
      {
        blob: "BB",
        hash: "OURS",
        tx: { TransactionType: "Payment", Account: account, Sequence: 7 },
      },
      1100,
      { sleep: async () => undefined },
    );
    expect(final).toMatchObject({
      hash: "THEIRS",
      result: "tesSUCCESS",
      validated: true,
      ledgerIndex: 900,
    });
  });

  it("waits while the account's validated sequence has not moved past the transaction", async () => {
    const node = new RecordedNode([
      {
        method: "account_info",
        params: { account, ledger_index: "validated" },
        result: {
          account_data: { Account: account, Sequence: 7, Flags: 0, Balance: "1", OwnerCount: 0 },
        },
      },
    ]);
    await expect(findBySequence(node, { account, sequence: 7 })).resolves.toBeUndefined();
    expect(identityOf({ Account: account, Sequence: 0, TicketSequence: 3 })).toEqual({
      account,
      sequence: 0,
      ticketSequence: 3,
    });
  });
});
