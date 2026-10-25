/**
 * The wallet adapters of the web app, written against the `WalletAdapter` interface of
 * xrpl-connect 1.0.0 (`apps/web/node_modules/xrpl-connect/index.d.ts:1928`, which declares
 * `id`, `name`, `capabilities`, `isAvailable`, `connect`, `disconnect`, `getAccount`,
 * `getNetwork`, `sign`, `signAndSubmit`, `signMessage`, `on`, `off`). Three adapters, and
 * only these: the Ledger Stax (Device Management Kit only: the legacy ledgerjs adapter of
 * xrpl-connect is never imported), a passkey on this Mac, and a throw-away demo account.
 * None of them needs an API key or loads a third-party script.
 */
import type {
  AccountInfo,
  NetworkInfo,
  SignedMessage,
  SignedTransaction,
  SubmittedTransaction,
  Transaction,
  WalletAdapter,
  WalletAdapterEvent,
  WalletCapabilities,
} from "xrpl-connect";
import { hasWebHid } from "../browser-support";
import { DEFAULT_FEE_DROPS } from "../constants";
import type { Demo, Profile } from "../demo";
import type { NetworkStore } from "../network-store";
import type { Backend, KeyHandle, TxJson } from "../ports";
import type { PasskeyMaterial } from "./passkey";
import {
  DEMO_ACCOUNT,
  LEDGER_STAX,
  PASSKEY_MAC,
  type WalletDescription,
  type WalletId,
} from "./catalog";

/** Everything an adapter needs from the app. */
export interface WalletHost {
  backend: Backend;
  demo: Demo;
  network: NetworkStore;
}

/** Where a passkey comes from: the browser's authenticator, or the software one in tests. */
export interface PasskeySource {
  /** True for the software authenticator (SIMULATED). */
  simulated: boolean;
  available(): boolean;
  create(): Promise<KeyHandle>;
  /** The passkey and its authenticator, for a live wallet that signs through `@carbs/sessions`. */
  material(): Promise<PasskeyMaterial>;
}

type Listener = (data: unknown) => void;

/** The network name a wallet reports while the screens run on the simulation. */
export const SIMULATED_NODE_NAME = "Simulated node (SIMULATED)";

const CAPABILITIES: WalletCapabilities = { sign: true, signAndSubmit: true, signMessage: false };

/** A transaction of the xrpl-connect shape as the JSON the node takes. */
function toTxJson(tx: Transaction): TxJson {
  const fields: Record<string, unknown> = { ...tx };
  return {
    ...fields,
    TransactionType: String(tx.TransactionType),
    Account: tx.Account,
    Fee: typeof tx.Fee === "string" ? tx.Fee : DEFAULT_FEE_DROPS,
  };
}

abstract class CarbsAdapter implements WalletAdapter {
  abstract readonly id: WalletId;
  abstract readonly name: string;
  abstract readonly description: WalletDescription;
  readonly capabilities = CAPABILITIES;
  private readonly listeners = new Map<WalletAdapterEvent, Set<Listener>>();
  private connected = false;

  constructor(protected readonly host: WalletHost) {}

  abstract isAvailable(): Promise<boolean>;
  /** Create the account for this wallet on the backend. */
  protected abstract open(): Promise<void>;

  async connect(): Promise<AccountInfo> {
    const { demo } = this.host;
    demo.disconnect();
    await this.open();
    if (demo.state.address === null) {
      throw new Error(demo.state.error ?? `${this.name} did not create an account`);
    }
    this.connected = true;
    const account = this.accountInfo();
    this.emit("connect", account);
    return account;
  }

  async disconnect(): Promise<void> {
    this.host.demo.disconnect();
    this.connected = false;
    this.emit("disconnect", undefined);
  }

  async getAccount(): Promise<AccountInfo | null> {
    return this.connected && this.host.demo.state.address !== null ? this.accountInfo() : null;
  }

  async getNetwork(): Promise<NetworkInfo> {
    return this.networkInfo();
  }

  async sign(transaction: Transaction): Promise<SignedTransaction> {
    const signed = await this.signJson(transaction);
    return {
      hash: this.host.backend.node.transactionHash(signed),
      signature: signed.TxnSignature ?? JSON.stringify(signed["PasskeySignature"] ?? ""),
      signerAddress: this.host.demo.accountSignerAddress() ?? "",
      tx: signed,
    };
  }

  async signAndSubmit(transaction: Transaction): Promise<SubmittedTransaction> {
    const signed = await this.signJson(transaction);
    const result = await this.host.backend.node.submit(signed);
    await this.host.demo.refresh();
    return {
      hash: result.hash,
      engine_result: result.code,
      applied: result.success,
      simulated: this.host.backend.mode === "simulated",
      tx: signed,
    };
  }

  async signMessage(_message: string | Uint8Array): Promise<SignedMessage> {
    throw new Error(`${this.name} does not sign messages`);
  }

  on(event: WalletAdapterEvent, callback: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(callback);
    this.listeners.set(event, set);
  }

  off(event: WalletAdapterEvent, callback: Listener): void {
    this.listeners.get(event)?.delete(callback);
  }

  protected emit(event: WalletAdapterEvent, data: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }

  private async signJson(transaction: Transaction): Promise<TxJson> {
    const { demo } = this.host;
    const json = toTxJson(transaction);
    if (json.Account !== demo.state.address) {
      throw new Error("The transaction is not for the connected account");
    }
    return demo.signAsAccount(await demo.prepare(json));
  }

  private networkInfo(): NetworkInfo {
    const network = this.host.network.selected();
    const simulated = this.host.backend.mode === "simulated";
    return {
      id: network.id,
      name: simulated ? SIMULATED_NODE_NAME : network.name,
      wss: network.wss,
      rpc: network.rpc,
    };
  }

  private accountInfo(): AccountInfo {
    const { demo } = this.host;
    const publicKey = demo.accountPublicKey();
    return {
      address: demo.state.address ?? "",
      ...(publicKey === null ? {} : { publicKey }),
      network: this.networkInfo(),
    };
  }
}

async function createFor(host: WalletHost, profile: Profile, adapterName: string): Promise<void> {
  const ok = await host.demo.createAccount(profile);
  if (!ok) throw new Error(host.demo.state.error ?? `${adapterName} could not set up the account`);
}

/** The Ledger Stax through the Device Management Kit: the simulated double or a real one (USB). */
export class LedgerStaxAdapter extends CarbsAdapter {
  readonly id = "ledger-stax";
  readonly name = LEDGER_STAX.name;
  readonly description = LEDGER_STAX;

  async isAvailable(): Promise<boolean> {
    // The simulated Stax needs no browser support; the real one needs WebHID.
    return this.host.backend.device.mode === "simulated" || hasWebHid();
  }

  protected async open(): Promise<void> {
    await createFor(this.host, "ledger", this.name);
  }
}

/** A passkey on this Mac: the browser's authenticator in the browser, the software one in tests. */
export class PasskeyMacAdapter extends CarbsAdapter {
  readonly id = "passkey-mac";
  readonly name = PASSKEY_MAC.name;
  readonly description = PASSKEY_MAC;

  constructor(
    host: WalletHost,
    readonly passkeys: PasskeySource,
  ) {
    super(host);
  }

  async isAvailable(): Promise<boolean> {
    return this.passkeys.available();
  }

  protected async open(): Promise<void> {
    const label = this.passkeys.simulated
      ? "Create a passkey (SIMULATED: software authenticator, no prompt)"
      : "Create a passkey with this browser's authenticator";
    // On the live backend the wallet signs the node's binary signing data itself, with the same
    // passkey source; on the simulation the passkey signs the simulated node's challenge.
    const ok = await this.host.demo.createAccount(
      "mac",
      this.host.backend.mode === "live"
        ? { passkeyLabel: label }
        : { passkey: () => this.passkeys.create(), passkeyLabel: label },
    );
    if (!ok)
      throw new Error(this.host.demo.state.error ?? `${this.name} could not set up the account`);
  }
}

/** A throw-away account: a master key in the page, on the node in effect (SIMULATED on the simulation). */
export class DemoAccountAdapter extends CarbsAdapter {
  readonly id = "demo-account";
  readonly name = DEMO_ACCOUNT.name;
  readonly description = DEMO_ACCOUNT;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  protected async open(): Promise<void> {
    await createFor(this.host, "demo", this.name);
  }
}

export type { CarbsAdapter };

/** The three adapters, in display order. */
export function createWalletAdapters(host: WalletHost, passkeys: PasskeySource): CarbsAdapter[] {
  return [
    new LedgerStaxAdapter(host),
    new PasskeyMacAdapter(host, passkeys),
    new DemoAccountAdapter(host),
  ];
}
