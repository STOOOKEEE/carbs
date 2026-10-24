/**
 * A test double of the AlphaNet's public JSON-RPC and faucet, for the live-migration tests. It
 * speaks the node's answers (`account_info`, `account_tx`, `submit`, `tx`, ...) and decodes the
 * blobs the client submits with the same definitions, so the client's real encoding and signing
 * are exercised. It applies only what the migration needs, with the node's own result codes
 * (the order of K3: `tefBAD_AUTH` before the regular key is set, `tecNEED_MASTER_KEY` for
 * `asfDisableMaster` from the regular key, `tefMASTER_DISABLED` afterwards). It checks no
 * signature. This is a TEST DOUBLE; nothing it answers is a node's.
 */
import {
  RpcError,
  addressFromPublicKey,
  decodeTx,
  parseDefinitions,
  transactionHash,
  type Definitions,
  type NodeClient,
} from "@carbs/sessions";
import { alphanetServerDefinitions } from "@carbs/sessions/testing";

interface FakeAccount {
  sequence: number;
  regularKey: string | undefined;
  masterDisabled: boolean;
  history: { hash: string; ledgerIndex: number; tx: Record<string, unknown>; result: string }[];
}

export class FakeAlphaNet implements NodeClient {
  readonly defs: Definitions = parseDefinitions(alphanetServerDefinitions(), {
    requireSessions: false,
  });
  readonly accounts = new Map<string, FakeAccount>();
  readonly requests: string[] = [];
  readonly results = new Map<string, string>();
  ledger = 236_000;

  /** The faucet: a `fetch` that funds the destination. */
  readonly faucet: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { destination: string };
    this.accounts.set(body.destination, {
      sequence: 1,
      regularKey: undefined,
      masterDisabled: false,
      history: [],
    });
    return new Response("{}", { status: 200 });
  };

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push(method);
    switch (method) {
      case "server_definitions":
        return structuredClone(alphanetServerDefinitions());
      case "server_info":
        return { info: { network_id: 24100 } };
      case "fee":
        return { drops: { base_fee: "10" }, ledger_current_index: this.ledger };
      case "account_info":
        return this.accountInfo(String(params["account"]));
      case "account_objects":
        return { account: params["account"], account_objects: [] };
      case "account_tx":
        return this.accountTx(String(params["account"]), params["forward"] === true);
      case "submit":
        return this.submit(String(params["tx_blob"]));
      case "tx":
        return this.tx(String(params["transaction"]));
      default:
        throw new Error(`FakeAlphaNet: ${method} is not served`);
    }
  }

  private disableMasterFlag(): number {
    return this.defs.raw.LEDGER_ENTRY_FLAGS?.["AccountRoot"]?.["lsfDisableMaster"] ?? 0;
  }

  private accountInfo(address: string): unknown {
    const account = this.accounts.get(address);
    if (!account) throw new RpcError("account_info", "actNotFound", "Account not found.");
    return {
      account_data: {
        Account: address,
        Balance: "100000000",
        Flags: account.masterDisabled ? this.disableMasterFlag() : 0,
        OwnerCount: 0,
        Sequence: account.sequence,
        ...(account.regularKey ? { RegularKey: account.regularKey } : {}),
      },
    };
  }

  private accountTx(address: string, forward: boolean): unknown {
    const account = this.accounts.get(address);
    const history = [...(account?.history ?? [])];
    if (!forward) history.reverse();
    return {
      account: address,
      ledger_index_min: 1,
      ledger_index_max: this.ledger,
      validated: true,
      transactions: [
        // The creation of the account, so that the history is complete.
        ...(forward
          ? [
              {
                hash: "C".repeat(64),
                ledger_index: 100,
                validated: true,
                tx_json: { TransactionType: "Payment", Account: "rFaucet", Destination: address },
                meta: {
                  TransactionResult: "tesSUCCESS",
                  AffectedNodes: [
                    {
                      CreatedNode: {
                        LedgerEntryType: "AccountRoot",
                        NewFields: { Account: address },
                      },
                    },
                  ],
                },
              },
            ]
          : []),
        ...history.map((h) => ({
          hash: h.hash,
          ledger_index: h.ledgerIndex,
          validated: true,
          tx_json: h.tx,
          meta: { TransactionResult: h.result, AffectedNodes: [] },
        })),
        ...(!forward
          ? [
              {
                hash: "C".repeat(64),
                ledger_index: 100,
                validated: true,
                tx_json: { TransactionType: "Payment", Account: "rFaucet", Destination: address },
                meta: {
                  TransactionResult: "tesSUCCESS",
                  AffectedNodes: [
                    {
                      CreatedNode: {
                        LedgerEntryType: "AccountRoot",
                        NewFields: { Account: address },
                      },
                    },
                  ],
                },
              },
            ]
          : []),
      ],
    };
  }

  private submit(blob: string): unknown {
    const tx = decodeTx(blob, this.defs);
    const hash = transactionHash(blob);
    const account = this.accounts.get(String(tx["Account"]));
    const result = account ? this.apply(account, tx) : "terNO_ACCOUNT";
    const included = result.startsWith("tes") || result.startsWith("tec");
    if (account && included) {
      account.sequence += 1;
      this.ledger += 1;
      account.history.push({ hash, ledgerIndex: this.ledger, tx, result });
    }
    this.results.set(hash, result);
    return {
      engine_result: result,
      engine_result_code: 0,
      engine_result_message: result,
      accepted: included,
      tx_json: { hash },
    };
  }

  private apply(account: FakeAccount, tx: Record<string, unknown>): string {
    const signer = addressFromPublicKey(String(tx["SigningPubKey"]));
    const address = String(tx["Account"]);
    const isMaster = signer === address;
    if (isMaster && account.masterDisabled) return "tefMASTER_DISABLED";
    if (!isMaster && signer !== account.regularKey) return "tefBAD_AUTH";
    if (tx["TransactionType"] === "SetRegularKey") {
      account.regularKey = String(tx["RegularKey"]);
      return "tesSUCCESS";
    }
    if (
      tx["TransactionType"] === "AccountSet" &&
      tx["SetFlag"] === this.defs.accountSetFlag("asfDisableMaster")
    ) {
      if (!isMaster) return "tecNEED_MASTER_KEY";
      account.masterDisabled = true;
      return "tesSUCCESS";
    }
    return "tesSUCCESS";
  }

  private tx(hash: string): unknown {
    const result = this.results.get(hash);
    if (!result) throw new RpcError("tx", "txnNotFound", "Transaction not found.");
    return {
      hash,
      validated: true,
      ledger_index: this.ledger,
      meta: { TransactionResult: result },
    };
  }
}
