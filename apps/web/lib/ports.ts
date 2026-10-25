/**
 * The three ports of the web app and the exposure port of the Quantum screen.
 * Screens depend on these interfaces only. Two implementations exist: `sim/*`
 * (SIMULATED, labelled in the UI) and, from M2/M3, the live one built on
 * packages/core, packages/ledger and the real node.
 */

import type { AppNetwork } from "./networks";

export type BackendMode = "simulated" | "live";
export type KeyAlgorithm = "secp256k1" | "p256" | "mldsa44";
export type SessionMode = "A" | "P" | "C";
export type NetworkName = "alphanet" | "mainnet";

/** A transaction as JSON, in the shape the node takes. */
export interface TxJson {
  TransactionType: string;
  Account: string;
  Fee: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  Flags?: number;
  SigningPubKey?: string;
  TxnSignature?: string;
  [field: string]: unknown;
}

/** A transaction before the envelope (Sequence, Fee, LastLedgerSequence) and the signature. */
export interface UnsignedTx {
  TransactionType: string;
  Account: string;
  Fee?: string;
  Flags?: number;
  [field: string]: unknown;
}

/** A passkey as the account's passkey list holds it. */
export interface PasskeyRef {
  /** `0xF6 ‖ X ‖ Y` as hex. */
  publicKey: string;
  /** The WebAuthn credential id as hex (`PasskeyID`). */
  credentialId: string;
}

export interface SessionParams {
  mode: SessionMode;
  durationSec: number;
  permissions: readonly string[];
  capDrops: number;
}

/**
 * The only place that builds transaction JSON for the screens. The simulated backend builds
 * the simulated shapes (`lib/tx-builders.ts`); the live one builds the node's, with the
 * definitions of its `server_definitions`, through `@carbs/sessions`.
 */
export interface TxBuilders {
  sessionSet(account: string, sessionKey: string, params: SessionParams): UnsignedTx;
  sessionDelete(account: string, sessionKey: string): UnsignedTx;
  payment(account: string, destination: string, drops: number): UnsignedTx;
  offerCreate(account: string, issuer: string): UnsignedTx;
  trustSet(account: string, issuer: string): UnsignedTx;
  ticketCreate(account: string): UnsignedTx;
  nftMint(account: string): UnsignedTx;
  checkCreate(account: string, destination: string): UnsignedTx;
  setRegularKey(account: string, regularKey: string | null): UnsignedTx;
  passkeyListSet(account: string, passkeys: readonly PasskeyRef[]): UnsignedTx;
  accountSetDisableMaster(account: string): UnsignedTx;
  /** A harmless `AccountSet` with no change: the proof transaction of the migration (spec 8.7). */
  accountSetNoop(account: string): UnsignedTx;
}

export interface CommonFieldsOptions {
  fee?: string;
  /** Leave out `LastLedgerSequence` (the Attack screen does, to show the refusal). */
  omitLastLedger?: boolean;
}

/** What the node fills in around a transaction (spec 8.3). */
export interface CommonFields {
  Fee: string;
  Sequence?: number;
  LastLedgerSequence?: number;
  NetworkID?: number;
  /** Flags the backend adds to every transaction (the simulation sets tfFullyCanonicalSig; a live node needs none). */
  Flags?: number;
}

export type ResultFamily = "tes" | "tec" | "tef" | "tem" | "ter" | "tel";

/** The node's answer. `code` is the node's own result code, never a client message. */
export interface NodeResult {
  code: string;
  family: ResultFamily;
  /** `tesSUCCESS`: the transaction did what it says. */
  success: boolean;
  /** The fee was charged (a `tes` or a `tec`). */
  feeClaimed: boolean;
  hash: string;
  ledgerIndex: number;
  /**
   * The node's last word: a validated result, or a refusal that is never included (`tef`, `tem`,
   * `tel`). False for a preliminary `tes` or `tec` that never validated before its last ledger.
   */
  final: boolean;
}

export interface ServerInfo {
  ledgerIndex: number;
  /** Ripple-epoch seconds of the last closed ledger (`parentCloseTime` of the next). */
  closeTime: number;
  networkLabel: string;
  features: readonly string[];
}

export interface AccountInfo {
  address: string;
  balanceDrops: number;
  sequence: number;
  ownerCount: number;
  regularKey: string | null;
  masterDisabled: boolean;
}

export interface SessionEntry {
  account: string;
  sessionKey: string;
  expiration: number;
  mode: SessionMode;
  permissions: readonly string[];
  capDrops: number | null;
  spentDrops: number | null;
}

export interface AccountObjects {
  sessions: readonly SessionEntry[];
  passkeys: readonly string[];
  signerList: { quorum: number; entries: readonly { account: string; weight: number }[] } | null;
}

export interface HistoryEntry {
  hash: string;
  ledgerIndex: number;
  tx: TxJson;
  result: string;
}

export interface AccountTxPage {
  transactions: readonly HistoryEntry[];
  /** Oldest ledger the node can answer for; the history is complete if it is <= the account's first ledger. */
  ledgerIndexMin: number;
  /** The account was created at this ledger (null if unknown). */
  createdLedger: number | null;
  /** The search stopped before the end of the history. */
  truncated: boolean;
}

export interface NodePort {
  readonly mode: BackendMode;
  readonly networkLabel: string;
  serverInfo(): Promise<ServerInfo>;
  /** Faucet: fund a new address. */
  fundAccount(address: string): Promise<AccountInfo>;
  accountInfo(address: string): Promise<AccountInfo | null>;
  accountObjects(address: string): Promise<AccountObjects>;
  accountTx(address: string): Promise<AccountTxPage>;
  /** `Sequence`, `Fee`, `LastLedgerSequence` (and `NetworkID` where the network needs it). */
  commonFields(account: string, options?: CommonFieldsOptions): Promise<CommonFields>;
  submit(tx: TxJson): Promise<NodeResult>;
  /** The transaction id of a signed transaction. */
  transactionHash(tx: TxJson): string;
  /**
   * The network whose public explorer shows this node's accounts and transactions; null for the
   * simulation, whose values are on no explorer (`lib/explorer.ts` adds none for the local node).
   */
  explorerNetwork(): AppNetwork | null;
}

/** What the Stax shows before it signs: a list of labelled lines (spec 7.3). */
export interface DeviceReview {
  title: string;
  lines: readonly { label: string; value: string }[];
  /** Simulated device only: said on the screen frame. */
  simulated: boolean;
}

export type DeviceApprover = (review: DeviceReview) => Promise<boolean>;

export class DeviceRejectedError extends Error {
  constructor() {
    super("Rejected on the device");
    this.name = "DeviceRejectedError";
  }
}

export interface DeviceKey {
  algorithm: "secp256k1" | "mldsa44";
  publicKey: string;
  address: string;
  publicKeyBytes: number;
}

export interface DevicePort {
  readonly mode: BackendMode;
  readonly model: string;
  getPublicKey(algorithm: DeviceKey["algorithm"]): Promise<DeviceKey>;
  review(tx: TxJson): DeviceReview;
  /** A fresh device: new keys, as after a factory reset. The simulated device only pretends. */
  reset(): void;
  /** Shows the review, waits for the user, returns the transaction with `SigningPubKey` and `TxnSignature`. */
  signTransaction(algorithm: DeviceKey["algorithm"], tx: TxJson): Promise<TxJson>;
}

export interface KeyHandle {
  algorithm: KeyAlgorithm;
  /** Passkeys only: the credential id as hex. */
  credentialId?: string;
  publicKey: string;
  address: string;
  /** Returns the transaction with `SigningPubKey` and `TxnSignature` (and `PasskeySignature` for a passkey). */
  sign(tx: TxJson): Promise<TxJson>;
}

export interface WalletPort {
  readonly mode: BackendMode;
  /** The master key of a Mac account. */
  createMasterKey(): Promise<KeyHandle>;
  createPasskey(): Promise<KeyHandle>;
  /** A fresh key for one session; never reused. */
  createSessionKey(algorithm: "p256" | "mldsa44"): Promise<KeyHandle>;
}

export type ExposureStatus = "exposed" | "no-exposure-found" | "unknown";

export interface ExposureReason {
  /** Which key or authority: master, regular key, passkey, signer list. */
  source: "master" | "regular-key" | "passkey" | "signer-list" | "other";
  exposed: boolean;
  text: string;
  /** The transaction that first revealed the key, when there is one. */
  firstTxHash: string | null;
  firstLedger: number | null;
}

export interface ExposureReport {
  address: string;
  network: NetworkName;
  status: ExposureStatus;
  reasons: readonly ExposureReason[];
  /** Authorities that survive `asfDisableMaster` (spec 8.7 rule 3). */
  survivingAuthorities: readonly string[];
  /** Why the answer is `unknown`, or what the search covered. */
  coverage: string;
  /** The report was produced by the simulation. */
  simulated: boolean;
}

export interface ExposurePort {
  readonly mode: BackendMode;
  check(address: string, network: NetworkName): Promise<ExposureReport>;
}

/** A ready-made address for the Quantum screen to try (simulated backend only). */
export interface ExposureFixture {
  id: string;
  label: string;
  address: string;
}

export interface Backend {
  readonly mode: BackendMode;
  fixtures: readonly ExposureFixture[];
  node: NodePort;
  device: DevicePort;
  wallet: WalletPort;
  exposure: ExposurePort;
  builders: TxBuilders;
  /** Two other accounts the actions and attacks use: a payee and an account that never opened a session. */
  counterparties: { sink: string; victim: string };
  /** Simulated clock controls; absent on the live backend. */
  clock: SimClock | null;
}

export interface SimClock {
  /** Close one ledger now. */
  closeLedger(): void;
  /** Let `seconds` of ledger time pass (closes ledgers as needed). */
  advance(seconds: number): void;
}
