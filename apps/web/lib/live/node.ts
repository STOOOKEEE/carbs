/**
 * The node behind Session, Actions and Attack, through `@carbs/sessions`: the public,
 * non-admin port of a node that carries the amendment. Every answer is the node's own;
 * every refusal code shown is the node's. Transactions are encoded with the definitions
 * the node served, never with bundled ones.
 */
import {
  RpcError,
  encodeTx,
  fetchCommonFields,
  getAccountObjects,
  getAccountState,
  submitAndWait,
  transactionHash,
  type Definitions,
  type NodeClient,
} from "@carbs/sessions";
import type { AppNetwork } from "../networks";
import type {
  AccountInfo,
  AccountObjects,
  AccountTxPage,
  CommonFields,
  CommonFieldsOptions,
  HistoryEntry,
  NodePort,
  NodeResult,
  ServerInfo,
  SessionEntry,
  SessionMode,
  TxJson,
} from "../ports";
import { toNodeResult } from "./result";

type Json = Record<string, unknown>;

const FUND_POLL_MS = 1000;
const FUND_POLLS = 60;
/** The ledger flag of a mode A session (`lsfAllTransactions`), read from the definitions. */
const ALL_TRANSACTIONS_FLAG = "lsfAllTransactions";

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export interface LiveNodeOptions {
  client: NodeClient;
  defs: Definitions;
  network: () => AppNetwork;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class LiveNode implements NodePort {
  readonly mode = "live" as const;
  private readonly client: NodeClient;
  private readonly defs: Definitions;
  private readonly network: () => AppNetwork;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: LiveNodeOptions) {
    this.client = options.client;
    this.defs = options.defs;
    this.network = options.network;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get networkLabel(): string {
    return this.network().name;
  }

  async serverInfo(): Promise<ServerInfo> {
    const answer = await this.client.request("ledger", { ledger_index: "validated" });
    const ledger = isObject(answer) && isObject(answer["ledger"]) ? answer["ledger"] : {};
    const index = asNumber(ledger["ledger_index"]) ?? Number(ledger["ledger_index"]);
    const closeTime = asNumber(ledger["close_time"]);
    if (!Number.isFinite(index) || closeTime === undefined) {
      throw new Error("ledger: the node answered without an index or a close time");
    }
    return {
      ledgerIndex: index,
      closeTime,
      networkLabel: this.networkLabel,
      features: this.defs.hasSessions ? ["SigningSessions"] : [],
    };
  }

  /** The faucet of the network (the dev faucet of `pnpm demo` for the local node). */
  async fundAccount(address: string): Promise<AccountInfo> {
    const faucet = this.network().faucet;
    if (faucet === null) throw new Error(`${this.network().name} has no faucet`);
    const response = await this.fetcher(faucet, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: address, userAgent: "carbs-web" }),
    });
    if (!response.ok) throw new Error(`faucet: HTTP ${response.status}`);
    // Wait until the account is in a validated ledger: `account_objects` and the exposure check
    // read the validated state and answer `actNotFound` before that.
    for (let i = 0; i < FUND_POLLS; i += 1) {
      if ((await getAccountState(this.client, address, "validated")) !== undefined) {
        const info = await this.accountInfo(address);
        if (info !== null) return info;
      }
      await this.sleep(FUND_POLL_MS);
    }
    throw new Error(
      `faucet: ${address} was not funded after ${(FUND_POLLS * FUND_POLL_MS) / 1000} s`,
    );
  }

  async accountInfo(address: string): Promise<AccountInfo | null> {
    const state = await getAccountState(this.client, address, "current");
    if (state === undefined) return null;
    const flag = this.defs.raw.LEDGER_ENTRY_FLAGS?.["AccountRoot"]?.["lsfDisableMaster"];
    if (flag === undefined) {
      throw new Error(
        "server_definitions: LEDGER_ENTRY_FLAGS.AccountRoot.lsfDisableMaster is missing",
      );
    }
    return {
      address,
      balanceDrops: Number(state.balanceDrops),
      sequence: state.sequence,
      ownerCount: state.ownerCount,
      regularKey: state.regularKey ?? null,
      masterDisabled: (state.flags & flag) !== 0,
    };
  }

  async accountObjects(address: string): Promise<AccountObjects> {
    try {
      return await this.readAccountObjects(address);
    } catch (error) {
      // Funded in the open ledger, not yet in a validated one: nothing to list yet.
      if (error instanceof RpcError && error.error === "actNotFound") {
        return { sessions: [], passkeys: [], signerList: null };
      }
      throw error;
    }
  }

  private async readAccountObjects(address: string): Promise<AccountObjects> {
    const [sessions, passkeys, signerLists] = await Promise.all([
      this.defs.hasSessions ? getAccountObjects(this.client, address, "signing_session") : [],
      this.safeObjects(address, "passkey_list"),
      this.safeObjects(address, "signer_list"),
    ]);
    const signerList = signerLists[0];
    return {
      sessions: sessions.map((entry) => this.sessionEntry(entry)),
      passkeys: passkeys.flatMap((list) =>
        Array.isArray(list["Passkeys"])
          ? list["Passkeys"].flatMap((item) =>
              isObject(item) &&
              isObject(item["Passkey"]) &&
              typeof item["Passkey"]["PublicKey"] === "string"
                ? [item["Passkey"]["PublicKey"]]
                : [],
            )
          : [],
      ),
      signerList:
        signerList === undefined
          ? null
          : {
              quorum: asNumber(signerList["SignerQuorum"]) ?? 0,
              entries: Array.isArray(signerList["SignerEntries"])
                ? signerList["SignerEntries"].flatMap((item) =>
                    isObject(item) && isObject(item["SignerEntry"])
                      ? [
                          {
                            account: String(item["SignerEntry"]["Account"]),
                            weight: asNumber(item["SignerEntry"]["SignerWeight"]) ?? 0,
                          },
                        ]
                      : [],
                  )
                : [],
            },
    };
  }

  /** A node may refuse a filter it has no entry type for (mainnet has no passkey list). */
  private async safeObjects(address: string, type: string): Promise<Json[]> {
    try {
      return await getAccountObjects(this.client, address, type);
    } catch {
      return [];
    }
  }

  private sessionEntry(entry: Json): SessionEntry {
    const flag = this.defs.raw.LEDGER_ENTRY_FLAGS?.["SigningSession"]?.[ALL_TRANSACTIONS_FLAG] ?? 0;
    const permissions = Array.isArray(entry["Permissions"])
      ? entry["Permissions"].flatMap((item) =>
          isObject(item) &&
          isObject(item["Permission"]) &&
          typeof item["Permission"]["PermissionValue"] === "string"
            ? [item["Permission"]["PermissionValue"]]
            : [],
        )
      : [];
    const capped = typeof entry["SessionCap"] === "string";
    const mode: SessionMode = capped
      ? "C"
      : permissions.length > 0
        ? "P"
        : ((asNumber(entry["Flags"]) ?? 0) & flag) !== 0
          ? "A"
          : "P";
    return {
      account: String(entry["Account"]),
      sessionKey: String(entry["SessionKey"]),
      expiration: asNumber(entry["Expiration"]) ?? 0,
      mode,
      permissions,
      capDrops: capped ? Number(entry["SessionCap"]) : null,
      spentDrops: typeof entry["SessionSpent"] === "string" ? Number(entry["SessionSpent"]) : null,
    };
  }

  async accountTx(address: string): Promise<AccountTxPage> {
    const answer = await this.client.request("account_tx", {
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: 200,
    });
    const result = isObject(answer) ? answer : {};
    const transactions = Array.isArray(result["transactions"]) ? result["transactions"] : [];
    const entries: HistoryEntry[] = transactions.flatMap((item) => {
      if (!isObject(item) || !isObject(item["tx_json"]) || !isObject(item["meta"])) return [];
      const tx = item["tx_json"];
      if (typeof tx["TransactionType"] !== "string" || typeof tx["Account"] !== "string") return [];
      return [
        {
          hash: String(item["hash"]),
          ledgerIndex: asNumber(item["ledger_index"]) ?? 0,
          tx: {
            ...tx,
            TransactionType: tx["TransactionType"],
            Account: tx["Account"],
            Fee: String(tx["Fee"] ?? "0"),
          },
          result: String(item["meta"]["TransactionResult"]),
        },
      ];
    });
    return {
      transactions: entries,
      ledgerIndexMin: asNumber(result["ledger_index_min"]) ?? 0,
      createdLedger: null,
      truncated: result["marker"] !== undefined,
    };
  }

  async commonFields(account: string, options: CommonFieldsOptions = {}): Promise<CommonFields> {
    const fields = await fetchCommonFields(this.client, account, {
      ...(options.fee === undefined ? {} : { feeDrops: BigInt(options.fee) }),
    });
    const common: CommonFields = {
      Fee: fields.Fee,
      Sequence: fields.Sequence,
    };
    if (options.omitLastLedger !== true) common.LastLedgerSequence = fields.LastLedgerSequence;
    if (fields.NetworkID !== undefined) common.NetworkID = fields.NetworkID;
    return common;
  }

  async submit(tx: TxJson): Promise<NodeResult> {
    const blob = encodeTx(tx, this.defs);
    const hash = transactionHash(blob);
    // A transaction without LastLedgerSequence (an attack) is refused at once; the bound only
    // ends the wait for one that was queued and never validated.
    const last =
      typeof tx.LastLedgerSequence === "number" ? tx.LastLedgerSequence : Number.MAX_SAFE_INTEGER;
    return toNodeResult(await submitAndWait(this.client, blob, hash, last));
  }

  transactionHash(tx: TxJson): string {
    return transactionHash(encodeTx(tx, this.defs));
  }

  explorerNetwork(): AppNetwork {
    return this.network();
  }
}
