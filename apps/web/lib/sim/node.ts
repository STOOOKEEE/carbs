/**
 * SIMULATED node. It answers like the specification, in the order of spec 6.5, with the
 * result matrix of 6.13, so the screens can be built and tested before the real node is
 * wired in. It is NOT the ledger: no consensus, no real signatures (see keys.ts), no
 * granular permissions, no tickets in use, no Batch, no Firewall. Every result it returns
 * is shown with the SIMULATED badge. Replaced by the live node in M3.
 */
import {
  ASF_DISABLE_MASTER,
  DEFAULT_FEE_DROPS,
  LAST_LEDGER_OFFSET,
  MAX_SESSION_DURATION_SEC,
  PERMISSION_MAX_SIZE,
  SESSION_FEE_MULTIPLE,
  SESSION_MAX_LEDGER_WINDOW,
  SIM_BASE_FEE_DROPS,
  SIM_FAUCET_DROPS,
  SIM_LEDGER_CLOSE_SEC,
  SIM_RESERVE_BASE_DROPS,
  SIM_RESERVE_OWNER_DROPS,
  SIM_START_CLOSE_TIME,
  SIM_START_LEDGER_INDEX,
  TF_ALL_TRANSACTIONS,
  TF_FULLY_CANONICAL_SIG,
} from "../constants";
import type {
  AccountInfo,
  AccountObjects,
  AccountTxPage,
  CommonFields,
  CommonFieldsOptions,
  HistoryEntry,
  NodePort,
  NodeResult,
  ResultFamily,
  ServerInfo,
  SessionEntry,
  SessionMode,
  SimClock,
  TxJson,
} from "../ports";
import { accountIdOf, algorithmOfPublicKey, simTxHash, verifySignature } from "./keys";
import { verifyPasskeyAssertion } from "./webauthn";
import {
  ALL_TYPES,
  DELEGABLE_TYPES,
  isDelegable,
  isSessionExcluded,
  ownerObjectsAdded,
} from "./types";

interface SimSession {
  account: string;
  sessionKey: string;
  expiration: number;
  mode: SessionMode;
  permissions: string[];
  capDrops: number | null;
  spentDrops: number | null;
}

interface SimAccount {
  address: string;
  balance: number;
  sequence: number;
  ownerCount: number;
  regularKey: string | null;
  masterDisabled: boolean;
  passkeys: string[];
  signerList: { quorum: number; entries: { account: string; weight: number }[] } | null;
  sessions: Map<string, SimSession>;
  history: HistoryEntry[];
  createdLedger: number;
  /** Oldest ledger the node can answer for this account; defaults to the node's. */
  historyMin: number | null;
}

export interface SeedAccount {
  address: string;
  balanceDrops?: number;
  regularKey?: string | null;
  masterDisabled?: boolean;
  passkeys?: string[];
  signerList?: SimAccount["signerList"];
  history?: HistoryEntry[];
  createdLedger?: number;
  historyMin?: number | null;
}

export interface SimulatedNodeOptions {
  startCloseTime?: number;
  startLedger?: number;
  /** `false` simulates a node without the amendment (case 7: `temDISABLED`). */
  amendmentEnabled?: boolean;
}

const COMMON_PAYMENT_FIELDS = new Set([
  "TransactionType",
  "Account",
  "Fee",
  "Sequence",
  "LastLedgerSequence",
  "SigningPubKey",
  "TxnSignature",
  "Flags",
  "NetworkID",
  "SourceTag",
  "Destination",
  "DestinationTag",
  "Amount",
]);
const SESSION_BLOCKING_FIELDS = [
  "Signers",
  "Delegate",
  "Sponsor",
  "SponsorSignature",
  "CounterpartySignature",
];
const OK = "tesSUCCESS";

function familyOf(code: string): ResultFamily {
  return code.slice(0, 3) as ResultFamily;
}

function isDropsString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

interface Applied {
  code: string;
  /** Run only on `tesSUCCESS`. */
  commit?: () => void;
  /** Drops that leave the account on success (for the cap accounting). */
  spend?: number;
}

interface Ctx {
  account: SimAccount;
  tx: TxJson;
  fee: number;
  signerPub: string;
  signerId: string;
}

export class SimulatedNode implements NodePort, SimClock {
  readonly mode = "simulated" as const;
  readonly networkLabel = "SIMULATED node";
  private ledgerIndex: number;
  private closeTime: number;
  private readonly accounts = new Map<string, SimAccount>();
  private readonly amendmentEnabled: boolean;

  constructor(options: SimulatedNodeOptions = {}) {
    this.ledgerIndex = options.startLedger ?? SIM_START_LEDGER_INDEX;
    this.closeTime = options.startCloseTime ?? SIM_START_CLOSE_TIME;
    this.amendmentEnabled = options.amendmentEnabled ?? true;
  }

  /* ---- clock ---- */

  closeLedger(): void {
    this.ledgerIndex += 1;
    this.closeTime += SIM_LEDGER_CLOSE_SEC;
  }

  advance(seconds: number): void {
    const ledgers = Math.max(1, Math.ceil(seconds / SIM_LEDGER_CLOSE_SEC));
    for (let i = 0; i < ledgers; i += 1) this.closeLedger();
  }

  async serverInfo(): Promise<ServerInfo> {
    return {
      ledgerIndex: this.ledgerIndex,
      closeTime: this.closeTime,
      networkLabel: this.networkLabel,
      features: this.amendmentEnabled ? ["SigningSessions", "Passkey", "Quantum"] : ["Passkey"],
    };
  }

  /* ---- accounts ---- */

  /** Fixture and test entry point: put an account in the state directly. */
  seed(spec: SeedAccount): void {
    this.accounts.set(spec.address, {
      address: spec.address,
      balance: spec.balanceDrops ?? SIM_FAUCET_DROPS,
      sequence: this.openLedger(),
      ownerCount: 0,
      regularKey: spec.regularKey ?? null,
      masterDisabled: spec.masterDisabled ?? false,
      passkeys: spec.passkeys ?? [],
      signerList: spec.signerList ?? null,
      sessions: new Map(),
      history: spec.history ?? [],
      createdLedger: spec.createdLedger ?? this.openLedger(),
      historyMin: spec.historyMin ?? null,
    });
  }

  async fundAccount(address: string): Promise<AccountInfo> {
    if (!this.accounts.has(address)) this.seed({ address });
    const info = await this.accountInfo(address);
    if (info === null) throw new Error("unreachable: the account was just created");
    return info;
  }

  async accountInfo(address: string): Promise<AccountInfo | null> {
    const account = this.accounts.get(address);
    if (account === undefined) return null;
    return {
      address,
      balanceDrops: account.balance,
      sequence: account.sequence,
      ownerCount: account.ownerCount,
      regularKey: account.regularKey,
      masterDisabled: account.masterDisabled,
    };
  }

  async accountObjects(address: string): Promise<AccountObjects> {
    const account = this.accounts.get(address);
    if (account === undefined) return { sessions: [], passkeys: [], signerList: null };
    const sessions: SessionEntry[] = [...account.sessions.values()].map((s) => ({
      account: s.account,
      sessionKey: s.sessionKey,
      expiration: s.expiration,
      mode: s.mode,
      permissions: [...s.permissions],
      capDrops: s.capDrops,
      spentDrops: s.spentDrops,
    }));
    return {
      sessions,
      passkeys: [...account.passkeys],
      signerList: account.signerList === null ? null : { ...account.signerList },
    };
  }

  async accountTx(address: string): Promise<AccountTxPage> {
    const account = this.accounts.get(address);
    if (account === undefined) {
      return { transactions: [], ledgerIndexMin: 0, createdLedger: null, truncated: false };
    }
    return {
      transactions: [...account.history],
      ledgerIndexMin: account.historyMin ?? 0,
      createdLedger: account.createdLedger,
      truncated: false,
    };
  }

  async commonFields(account: string, options: CommonFieldsOptions = {}): Promise<CommonFields> {
    const info = this.accounts.get(account);
    const common: CommonFields = { Fee: options.fee ?? DEFAULT_FEE_DROPS };
    if (info !== undefined) common.Sequence = info.sequence;
    if (options.omitLastLedger !== true) {
      common.LastLedgerSequence = this.openLedger() + LAST_LEDGER_OFFSET;
    }
    return common;
  }

  transactionHash(tx: TxJson): string {
    return simTxHash(tx);
  }

  explorerUrl(): string | null {
    return null;
  }

  /* ---- submit ---- */

  async submit(tx: TxJson): Promise<NodeResult> {
    return this.process(tx);
  }

  private openLedger(): number {
    return this.ledgerIndex + 1;
  }

  private reserve(ownerCount: number): number {
    return SIM_RESERVE_BASE_DROPS + ownerCount * SIM_RESERVE_OWNER_DROPS;
  }

  private reject(code: string, hash: string): NodeResult {
    return {
      code,
      family: familyOf(code),
      success: false,
      feeClaimed: false,
      final: true,
      hash,
      ledgerIndex: this.ledgerIndex,
    };
  }

  private process(tx: TxJson): NodeResult {
    const hash = simTxHash(tx);
    const reject = (code: string): NodeResult => this.reject(code, hash);

    // Stateless checks first (preflight), then the account (spec 6.5).
    const pre = this.preflight(tx);
    if (pre !== OK) return reject(pre);
    const signatureOk =
      tx.PasskeySignature !== undefined ? verifyPasskeyAssertion(tx) : verifySignature(tx);
    if (!signatureOk) return reject("temBAD_SIGNATURE");
    const account = this.accounts.get(tx.Account);
    if (account === undefined) return reject("terNO_ACCOUNT");

    // Sequence and LastLedgerSequence (before authorization, as upstream does).
    if (typeof tx.Sequence === "number") {
      if (tx.Sequence < account.sequence) return reject("tefPAST_SEQ");
      if (tx.Sequence > account.sequence) return reject("terPRE_SEQ");
    }
    if (typeof tx.LastLedgerSequence === "number" && tx.LastLedgerSequence < this.openLedger()) {
      return reject("tefMAX_LEDGER");
    }

    // Authorization: the session predicate decides which path (spec 6.4, 6.5).
    const signerPub = tx.SigningPubKey ?? "";
    const signerId = accountIdOf(signerPub);
    const session = account.sessions.get(signerId) ?? null;
    const sessionSigned = this.amendmentEnabled && session !== null && this.hasSessionShape(tx);
    if (sessionSigned && session !== null) {
      const verdict = this.checkSession(session, tx, signerId);
      if (verdict !== OK) return reject(verdict);
    } else {
      const verdict = this.checkFullAuthority(account, signerPub, signerId);
      if (verdict !== OK) return reject(verdict);
    }

    // The fee is checked after the signature (spec 6.5): a stranger's key is refused first.
    const fee = Number(tx.Fee);
    if (fee < SIM_BASE_FEE_DROPS) return reject("telINSUF_FEE_P");
    if (account.balance < fee) return reject("terINSUF_FEE_B");

    const applied = this.apply({ account, tx, fee, signerPub, signerId });
    const family = familyOf(applied.code);
    if (family !== "tes" && family !== "tec") return reject(applied.code);

    const success = applied.code === OK;
    if (success && applied.commit !== undefined) applied.commit();

    // The fee is claimed for tes and tec; the sequence is consumed.
    account.balance -= fee;
    account.sequence += 1;

    // Mode C accounting: one place, after the outcome is known (spec 6.6).
    if (
      sessionSigned &&
      session !== null &&
      session.mode === "C" &&
      !this.isOwnClose(tx, signerId)
    ) {
      session.spentDrops = (session.spentDrops ?? 0) + fee + (success ? (applied.spend ?? 0) : 0);
    }

    const entry: HistoryEntry = {
      hash,
      ledgerIndex: this.openLedger(),
      tx,
      result: applied.code,
    };
    account.history.push(entry);

    return {
      code: applied.code,
      family,
      success,
      feeClaimed: true,
      final: true,
      hash,
      ledgerIndex: this.openLedger(),
    };
  }

  /* ---- stateless checks (tem) ---- */

  private preflight(tx: TxJson): string {
    if (!ALL_TYPES.includes(tx.TransactionType)) return "temUNKNOWN";
    if (
      (tx.TransactionType === "SigningSessionSet" ||
        tx.TransactionType === "SigningSessionDelete") &&
      !this.amendmentEnabled
    ) {
      return "temDISABLED";
    }
    if (!isDropsString(tx.Fee)) return "temMALFORMED";
    if (typeof tx.SigningPubKey !== "string" || tx.SigningPubKey === "") return "temBAD_SIGNATURE";
    if (algorithmOfPublicKey(tx.SigningPubKey) === null) return "temBAD_SIGNATURE";

    switch (tx.TransactionType) {
      case "SigningSessionSet":
        return this.preflightSessionSet(tx);
      case "SigningSessionDelete":
        return this.preflightSessionDelete(tx);
      case "Payment":
        if (!isDropsString(tx.Amount) && typeof tx.Amount !== "object") return "temBAD_AMOUNT";
        if (isDropsString(tx.Amount) && Number(tx.Amount) <= 0) return "temBAD_AMOUNT";
        return typeof tx.Destination === "string" ? OK : "temMALFORMED";
      case "SetRegularKey":
        return tx.RegularKey === tx.Account ? "temBAD_REGKEY" : OK;
      default:
        return OK;
    }
  }

  private preflightSessionSet(tx: TxJson): string {
    const flags = (tx.Flags ?? 0) >>> 0;
    const known = (TF_FULLY_CANONICAL_SIG | TF_ALL_TRANSACTIONS) >>> 0;
    if ((flags & ~known) >>> 0 !== 0) return "temINVALID_FLAG";
    const permissionsPresent = Array.isArray(tx.Permissions);
    const capPresent = tx.SessionCap !== undefined;
    const allTransactions = (flags & TF_ALL_TRANSACTIONS) !== 0;
    const modes = Number(permissionsPresent) + Number(capPresent) + Number(allTransactions);
    if (modes !== 1) return "temMALFORMED";
    if (typeof tx.SessionKey !== "string" || tx.SessionKey === tx.Account) return "temMALFORMED";
    const duration = tx.SessionDuration;
    if (
      typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration < 1 ||
      duration > MAX_SESSION_DURATION_SEC
    ) {
      return "temBAD_EXPIRATION";
    }
    if (permissionsPresent) {
      const permissions = tx.Permissions as unknown[];
      if (permissions.length === 0) return "temARRAY_EMPTY";
      if (permissions.length > PERMISSION_MAX_SIZE) return "temARRAY_TOO_LARGE";
      const seen = new Set<unknown>();
      for (const value of permissions) {
        if (typeof value !== "string" || seen.has(value)) return "temMALFORMED";
        seen.add(value);
        if (!isDelegable(value) || isSessionExcluded(value)) return "temMALFORMED";
      }
    }
    if (capPresent && (!isDropsString(tx.SessionCap) || Number(tx.SessionCap) <= 0)) {
      return "temBAD_AMOUNT";
    }
    return OK;
  }

  private preflightSessionDelete(tx: TxJson): string {
    const flags = (tx.Flags ?? 0) >>> 0;
    if ((flags & ~TF_FULLY_CANONICAL_SIG) >>> 0 !== 0) return "temINVALID_FLAG";
    if (typeof tx.SessionKey !== "string") return "temMALFORMED";
    if (tx.Owner !== undefined && tx.Owner === tx.Account) return "temMALFORMED";
    return OK;
  }

  /* ---- authorization ---- */

  /** The structural half of the session-signed predicate (spec 6.4). */
  private hasSessionShape(tx: TxJson): boolean {
    return SESSION_BLOCKING_FIELDS.every((field) => tx[field] === undefined);
  }

  private isOwnClose(tx: TxJson, signerId: string): boolean {
    return (
      tx.TransactionType === "SigningSessionDelete" &&
      tx.Owner === undefined &&
      tx.SessionKey === signerId
    );
  }

  private checkFullAuthority(account: SimAccount, signerPub: string, signerId: string): string {
    if (signerId === account.address) {
      return account.masterDisabled ? "tefMASTER_DISABLED" : OK;
    }
    if (account.regularKey !== null && account.regularKey === signerId) return OK;
    if (account.passkeys.includes(signerPub)) return OK;
    return "tefBAD_AUTH";
  }

  /** `invokeCheckSession`: five rules, in order, every refusal a `tef` (spec 6.5). */
  private checkSession(session: SimSession, tx: TxJson, signerId: string): string {
    const ownClose = this.isOwnClose(tx, signerId);

    // 1. Eligibility.
    if (!ownClose && !this.isEligible(session, tx)) return "tefSESSION_TX_NOT_ALLOWED";

    // 2. LastLedgerSequence present and near.
    const last = tx.LastLedgerSequence;
    if (typeof last !== "number" || last > this.openLedger() + SESSION_MAX_LEDGER_WINDOW) {
      return "tefSESSION_TX_NOT_ALLOWED";
    }

    // 3. Expiry (not for the own close).
    if (!ownClose && !(this.closeTime < session.expiration)) return "tefSESSION_EXPIRED";

    // 4. Fee ceiling, every mode, the own close included.
    const ceiling = SIM_BASE_FEE_DROPS + SESSION_FEE_MULTIPLE * SIM_BASE_FEE_DROPS;
    const fee = Number(tx.Fee);
    if (fee > ceiling) return "tefSESSION_LIMIT";

    // 5. Cap, mode C, every session-signed transaction except the own close.
    if (session.mode === "C" && !ownClose) {
      const amount =
        tx.TransactionType === "Payment" && isDropsString(tx.Amount) ? Number(tx.Amount) : 0;
      const remaining = (session.capDrops ?? 0) - (session.spentDrops ?? 0);
      if (fee + amount > remaining) return "tefSESSION_LIMIT";
    }
    return OK;
  }

  private isEligible(session: SimSession, tx: TxJson): boolean {
    const type = tx.TransactionType;
    switch (session.mode) {
      case "A":
        return isDelegable(type) && !isSessionExcluded(type);
      case "P":
        return session.permissions.includes(type) && isDelegable(type) && !isSessionExcluded(type);
      case "C":
        return this.isModeCPayment(tx);
    }
  }

  /** Mode C is a closed whitelist: a plain XRP payment and nothing else (spec 6.5, rule 1). */
  private isModeCPayment(tx: TxJson): boolean {
    if (tx.TransactionType !== "Payment") return false;
    const flags = (tx.Flags ?? 0) >>> 0;
    if (flags !== 0 && flags !== TF_FULLY_CANONICAL_SIG) return false;
    if (!isDropsString(tx.Amount)) return false;
    return Object.keys(tx).every((field) => COMMON_PAYMENT_FIELDS.has(field));
  }

  /* ---- transactors ---- */

  private apply(ctx: Ctx): Applied {
    const { account, tx, fee } = ctx;
    const added = ownerObjectsAdded(tx);
    const short = account.balance - fee < this.reserve(account.ownerCount + added) && added > 0;

    switch (tx.TransactionType) {
      case "Payment":
        return this.applyPayment(ctx);
      case "AccountSet":
        return this.applyAccountSet(ctx);
      case "SetRegularKey":
        return {
          code: OK,
          commit: () => {
            account.regularKey = typeof tx.RegularKey === "string" ? tx.RegularKey : null;
          },
        };
      case "PasskeyListSet":
        return this.applyPasskeyListSet(ctx, short);
      case "SignerListSet":
        if (short) return { code: "tecINSUFFICIENT_RESERVE" };
        return {
          code: OK,
          commit: () => {
            const entries = Array.isArray(tx.SignerEntries)
              ? (tx.SignerEntries as { account: string; weight: number }[])
              : [];
            account.signerList = {
              quorum: typeof tx.SignerQuorum === "number" ? tx.SignerQuorum : 0,
              entries,
            };
            account.ownerCount += 1;
          },
        };
      case "SigningSessionSet":
        return this.applySessionSet(ctx, short);
      case "SigningSessionDelete":
        return this.applySessionDelete(ctx);
      default:
        if (short) return { code: "tecINSUFFICIENT_RESERVE" };
        return {
          code: OK,
          commit: () => {
            account.ownerCount += added;
          },
        };
    }
  }

  private applyPayment(ctx: Ctx): Applied {
    const { account, tx, fee } = ctx;
    if (!isDropsString(tx.Amount)) return { code: "tecPATH_DRY" };
    const amount = Number(tx.Amount);
    const destination = String(tx.Destination);
    const spendable = account.balance - fee - this.reserve(account.ownerCount);
    if (amount > spendable) return { code: "tecUNFUNDED_PAYMENT" };
    const target = this.accounts.get(destination);
    if (target === undefined && amount < SIM_RESERVE_BASE_DROPS) {
      return { code: "tecNO_DST_INSUF_XRP" };
    }
    return {
      code: OK,
      spend: amount,
      commit: () => {
        account.balance -= amount;
        if (target !== undefined) {
          target.balance += amount;
        } else {
          this.seed({ address: destination, balanceDrops: amount });
        }
      },
    };
  }

  private applyAccountSet(ctx: Ctx): Applied {
    const { account, tx, signerId } = ctx;
    if (tx.SetFlag === ASF_DISABLE_MASTER) {
      if (signerId !== account.address) return { code: "tecNEED_MASTER_KEY" };
      // A passkey list does not count as an alternative key (spec 6.14).
      if (account.regularKey === null && account.signerList === null) {
        return { code: "tecNO_ALTERNATIVE_KEY" };
      }
      return {
        code: OK,
        commit: () => {
          account.masterDisabled = true;
        },
      };
    }
    return { code: OK };
  }

  private applyPasskeyListSet(ctx: Ctx, short: boolean): Applied {
    const { account, tx } = ctx;
    const keys = Array.isArray(tx.Passkeys) ? (tx.Passkeys as string[]) : [];
    // P6 (verified on the public AlphaNet, spec 6.14): a second list raises an exception.
    if (account.passkeys.length > 0) return { code: "tefEXCEPTION" };
    if (keys.length === 0) return { code: "temMALFORMED" };
    if (short) return { code: "tecINSUFFICIENT_RESERVE" };
    return {
      code: OK,
      commit: () => {
        account.passkeys = [...keys];
        account.ownerCount += 1;
      },
    };
  }

  private applySessionSet(ctx: Ctx, short: boolean): Applied {
    const { account, tx } = ctx;
    const sessionKey = String(tx.SessionKey);
    const passkeyIds = account.passkeys.map(accountIdOf);
    if (sessionKey === account.regularKey || passkeyIds.includes(sessionKey)) {
      return { code: "tecNO_PERMISSION" };
    }
    if (account.sessions.has(sessionKey)) return { code: "tecDUPLICATE" };
    if (short || account.balance - ctx.fee < this.reserve(account.ownerCount + 1)) {
      return { code: "tecINSUFFICIENT_RESERVE" };
    }
    const flags = (tx.Flags ?? 0) >>> 0;
    const mode: SessionMode = Array.isArray(tx.Permissions)
      ? "P"
      : tx.SessionCap !== undefined
        ? "C"
        : (flags & TF_ALL_TRANSACTIONS) !== 0
          ? "A"
          : "A";
    return {
      code: OK,
      commit: () => {
        account.sessions.set(sessionKey, {
          account: account.address,
          sessionKey,
          expiration: this.closeTime + Number(tx.SessionDuration),
          mode,
          permissions: mode === "P" ? [...(tx.Permissions as string[])] : [],
          capDrops: mode === "C" ? Number(tx.SessionCap) : null,
          spentDrops: mode === "C" ? 0 : null,
        });
        account.ownerCount += 1;
      },
    };
  }

  private applySessionDelete(ctx: Ctx): Applied {
    const { account, tx } = ctx;
    const sessionKey = String(tx.SessionKey);
    const ownerAddress = typeof tx.Owner === "string" ? tx.Owner : account.address;
    const owner = this.accounts.get(ownerAddress);
    const target = owner?.sessions.get(sessionKey);
    if (owner === undefined || target === undefined) return { code: "tecNO_ENTRY" };
    if (ownerAddress !== account.address && this.closeTime < target.expiration) {
      // Anyone may delete an expired session; a live one belongs to its owner.
      return { code: "tecNO_PERMISSION" };
    }
    return {
      code: OK,
      commit: () => {
        owner.sessions.delete(sessionKey);
        owner.ownerCount -= 1;
      },
    };
  }

  /** The delegable table, exposed for the enumeration test (case 9b). */
  static delegableTypes(): readonly string[] {
    return DELEGABLE_TYPES;
  }
}
