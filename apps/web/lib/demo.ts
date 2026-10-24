/**
 * The demo store behind the five screens. It owns no ledger state: account, balance,
 * sessions and results are read back from the node after every action (spec 8.5:
 * "account state comes from the node, not local state"). It only remembers which keys it
 * holds and what it logged.
 */
import { reactive } from "vue";
import { BLACKHOLE_ADDRESS, TF_FULLY_CANONICAL_SIG } from "./constants";
import { xrpToDrops } from "./format";
import {
  DeviceRejectedError,
  type AccountInfo,
  type AccountObjects,
  type Backend,
  type KeyHandle,
  type NodeResult,
  type SessionParams,
  type UnsignedTx,
  type ServerInfo,
  type SessionEntry,
  type TxJson,
} from "./ports";
import { ACTIONS, ATTACKS, type Attack, type ScenarioContext } from "./scenarios";

export type Profile = "mac" | "ledger" | "demo";

export const PROFILE_LABELS: Record<Profile, string> = {
  mac: "Mac account",
  ledger: "Ledger account",
  demo: "Demo account",
};

export interface CreateAccountOptions {
  passkeyOnly?: boolean;
  /** A passkey made elsewhere (the browser's authenticator); default: the wallet port's. */
  passkey?: () => Promise<KeyHandle>;
  /** Said in the setup step for that passkey. */
  passkeyLabel?: string;
}

/** Something that can sign for the account with full authority. */
export interface Signer {
  label: string;
  algorithm: string;
  publicKey: string;
  /** True when each signature is confirmed on the device. */
  onDevice: boolean;
  sign(tx: TxJson): Promise<TxJson>;
}

export interface StepLog {
  id: number;
  label: string;
  status: "pending" | "ok" | "failed";
  result: NodeResult | null;
  note: string | null;
}

export interface LogEntry {
  id: number;
  label: string;
  txType: string;
  signer: string;
  result: NodeResult;
}

export interface DemoState {
  profile: Profile | null;
  passkeyOnly: boolean;
  address: string | null;
  info: AccountInfo | null;
  objects: AccountObjects | null;
  server: ServerInfo | null;
  /** `Date.now()` when `server` was read, to interpolate the countdown. */
  serverAt: number;
  session: SessionEntry | null;
  sessionKey: KeyHandle | null;
  steps: StepLog[];
  actionLog: LogEntry[];
  attackLog: LogEntry[];
  busy: boolean;
  error: string | null;
}

export function createDemo(backend: Backend) {
  const state = reactive<DemoState>({
    profile: null,
    passkeyOnly: false,
    address: null,
    info: null,
    objects: null,
    server: null,
    serverAt: 0,
    session: null,
    sessionKey: null,
    steps: [],
    actionLog: [],
    attackLog: [],
    busy: false,
    error: null,
  });
  let counter = 0;
  let fullAuth: Signer | null = null;
  let master: Signer | null = null;
  const { sink, victim } = backend.counterparties;
  const build = backend.builders;

  /* ---- reading the node ---- */

  async function refresh(): Promise<void> {
    state.server = await backend.node.serverInfo();
    state.serverAt = Date.now();
    if (state.address === null) return;
    state.info = await backend.node.accountInfo(state.address);
    state.objects = await backend.node.accountObjects(state.address);
    const key = state.sessionKey?.address;
    state.session =
      key === undefined ? null : (state.objects.sessions.find((s) => s.sessionKey === key) ?? null);
  }

  /* ---- envelope: Sequence, Fee, LastLedgerSequence (spec 8.3) ---- */

  async function envelope(
    tx: UnsignedTx,
    options: { fee?: string; omitLastLedger?: boolean } = {},
  ): Promise<TxJson> {
    const common = await backend.node.commonFields(tx.Account, options);
    const out: TxJson = {
      ...tx,
      ...common,
      Fee: options.fee ?? tx.Fee ?? common.Fee,
      Flags: ((tx.Flags ?? 0) | TF_FULLY_CANONICAL_SIG) >>> 0,
    };
    return out;
  }

  async function submitWith(
    signer: Pick<Signer, "sign">,
    tx: UnsignedTx,
    options: { fee?: string; omitLastLedger?: boolean } = {},
  ): Promise<NodeResult> {
    const prepared = await envelope(tx, options);
    const signed = await signer.sign(prepared);
    const result = await backend.node.submit(signed);
    await refresh();
    return result;
  }

  function requireAddress(): string {
    if (state.address === null) throw new Error("Create an account first");
    return state.address;
  }

  /* ---- guarded runner ---- */

  async function guarded<T>(work: () => Promise<T>): Promise<T | null> {
    state.busy = true;
    state.error = null;
    try {
      return await work();
    } catch (error) {
      state.error =
        error instanceof DeviceRejectedError
          ? "Rejected on the device. Nothing was sent."
          : error instanceof Error
            ? error.message
            : String(error);
      return null;
    } finally {
      state.busy = false;
    }
  }

  /* ---- account setup ---- */

  function addStep(label: string): StepLog {
    counter += 1;
    const step = reactive<StepLog>({
      id: counter,
      label,
      status: "pending",
      result: null,
      note: null,
    });
    state.steps.push(step);
    return step;
  }

  async function stepTx(
    label: string,
    signer: Pick<Signer, "sign">,
    tx: UnsignedTx,
  ): Promise<void> {
    const step = addStep(label);
    const result = await submitWith(signer, tx);
    step.result = result;
    step.status = result.success ? "ok" : "failed";
    if (!result.success) throw new Error(`${label}: the node answered ${result.code}`);
  }

  function signerFrom(key: KeyHandle, label: string): Signer {
    return {
      label,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      onDevice: false,
      sign: (tx) => key.sign(tx),
    };
  }

  async function createAccount(
    profile: Profile,
    options: CreateAccountOptions = {},
  ): Promise<boolean> {
    const done = await guarded(async () => {
      reset();
      state.profile = profile;
      state.passkeyOnly = options.passkeyOnly === true;
      if (profile === "mac") await setupMac(state.passkeyOnly, options);
      else if (profile === "ledger") await setupLedger();
      else await setupDemo();
      await refresh();
      return true;
    });
    return done === true;
  }

  async function fund(address: string): Promise<void> {
    const step = addStep("Fund the account (SIMULATED faucet)");
    await backend.node.fundAccount(address);
    step.status = "ok";
  }

  async function setupDemo(): Promise<void> {
    const masterKey = await backend.wallet.createMasterKey();
    master = signerFrom(masterKey, "Demo master key");
    state.address = masterKey.address;
    await fund(masterKey.address);
    fullAuth = master;
  }

  async function setupMac(passkeyOnly: boolean, options: CreateAccountOptions): Promise<void> {
    const masterKey = await backend.wallet.createMasterKey();
    master = signerFrom(masterKey, "Master key");
    state.address = masterKey.address;
    await fund(masterKey.address);
    const passkey = options.passkey
      ? await options.passkey()
      : await backend.wallet.createPasskey();
    addStep(
      options.passkeyLabel ?? "Create a passkey (SIMULATED: software authenticator, no prompt)",
    ).status = "ok";
    await stepTx(
      "PasskeyListSet, signed by the master key",
      master,
      build.passkeyListSet(masterKey.address, [passkey.publicKey]),
    );
    if (passkeyOnly) {
      await stepTx(
        "SetRegularKey to the blackhole address, signed by the master key",
        master,
        build.setRegularKey(masterKey.address, BLACKHOLE_ADDRESS),
      );
      await stepTx(
        "AccountSet asfDisableMaster, signed by the master key",
        master,
        build.accountSetDisableMaster(masterKey.address),
      );
    }
    fullAuth = signerFrom(passkey, "Passkey");
  }

  async function setupLedger(): Promise<void> {
    const classical = await backend.device.getPublicKey("secp256k1");
    const pq = await backend.device.getPublicKey("mldsa44");
    const onDevice = (algorithm: "secp256k1" | "mldsa44", label: string): Signer => {
      const key = algorithm === "secp256k1" ? classical : pq;
      return {
        label,
        algorithm,
        publicKey: key.publicKey,
        onDevice: true,
        sign: (tx) => backend.device.signTransaction(algorithm, tx),
      };
    };
    master = onDevice("secp256k1", "Device master key");
    state.address = classical.address;
    addStep("Read the device keys (secp256k1 and ML-DSA-44)").status = "ok";
    await fund(classical.address);
    await stepTx(
      "SetRegularKey to the ML-DSA-44 key, signed by the master key on the device",
      master,
      build.setRegularKey(classical.address, pq.address),
    );
    fullAuth = onDevice("mldsa44", "Device ML-DSA-44 key");
    await stepTx(
      "Proof transaction, signed by the ML-DSA-44 key on the device",
      fullAuth,
      build.accountSetNoop(classical.address),
    );
    await stepTx(
      "AccountSet asfDisableMaster, signed by the master key on the device",
      master,
      build.accountSetDisableMaster(classical.address),
    );
  }

  function reset(): void {
    state.profile = null;
    state.address = null;
    state.info = null;
    state.objects = null;
    state.session = null;
    state.sessionKey = null;
    state.steps = [];
    state.actionLog = [];
    state.attackLog = [];
    state.error = null;
    fullAuth = null;
    master = null;
  }

  /* ---- sessions ---- */

  async function openSession(params: SessionParams): Promise<NodeResult | null> {
    return guarded(async () => {
      const address = requireAddress();
      if (fullAuth === null) throw new Error("No key with full authority");
      const key = await backend.wallet.createSessionKey(
        state.profile === "ledger" ? "mldsa44" : "p256",
      );
      const result = await submitWith(fullAuth, build.sessionSet(address, key.address, params));
      if (result.success) state.sessionKey = key;
      await refresh();
      return result;
    });
  }

  /** The own close: signed by the session key itself (spec 6.3). */
  async function closeSession(): Promise<NodeResult | null> {
    return guarded(async () => {
      const address = requireAddress();
      const key = state.sessionKey;
      if (key === null) throw new Error("No open session");
      const result = await submitWith(key, build.sessionDelete(address, key.address));
      if (result.success) state.sessionKey = null;
      await refresh();
      return result;
    });
  }

  function scenarioContext(): ScenarioContext {
    const entry = state.session;
    return {
      account: requireAddress(),
      builders: build,
      sink,
      victim,
      remainingCapDrops:
        entry !== null && entry.capDrops !== null ? entry.capDrops - (entry.spentDrops ?? 0) : null,
    };
  }

  async function runAction(id: string): Promise<LogEntry | null> {
    return guarded(async () => {
      const action = ACTIONS.find((a) => a.id === id);
      const key = state.sessionKey;
      if (action === undefined) throw new Error(`Unknown action ${id}`);
      if (key === null) throw new Error("Open a session first");
      const result = await submitWith(key, action.build(scenarioContext()));
      counter += 1;
      const entry: LogEntry = {
        id: counter,
        label: action.title,
        txType: action.type,
        signer: "session key",
        result,
      };
      state.actionLog.unshift(entry);
      return entry;
    });
  }

  async function ensureVictim(): Promise<void> {
    if ((await backend.node.accountInfo(victim)) === null) await backend.node.fundAccount(victim);
  }

  async function runAttack(id: string): Promise<LogEntry | null> {
    return guarded(async () => {
      const attack: Attack | undefined = ATTACKS.find((a) => a.id === id);
      const key = state.sessionKey;
      if (attack === undefined) throw new Error(`Unknown attack ${id}`);
      if (key === null) throw new Error("Open a session first");
      if (attack.needsExpiry) {
        const entry = state.session;
        if (backend.clock === null || entry === null) {
          throw new Error("Wait for the session to expire, then try again");
        }
        const server = await backend.node.serverInfo();
        backend.clock.advance(Math.max(1, entry.expiration - server.closeTime + 1));
      }
      await ensureVictim();
      const ctx = scenarioContext();
      const options: { fee?: string; omitLastLedger?: boolean } = {};
      if (attack.fee !== undefined) options.fee = attack.fee;
      if (attack.omitLastLedger === true) options.omitLastLedger = true;
      const result = await submitWith(key, attack.build(ctx), options);
      counter += 1;
      const entry: LogEntry = {
        id: counter,
        label: attack.title,
        txType: attack.type,
        signer: "session key",
        result,
      };
      state.attackLog.unshift(entry);
      return entry;
    });
  }

  /** For wallet adapters: fill the envelope of a transaction of the connected account. */
  async function prepare(tx: UnsignedTx): Promise<TxJson> {
    return envelope(tx);
  }

  /** For wallet adapters: sign as the account's own authority (passkey, device or master key). */
  async function signAsAccount(tx: TxJson): Promise<TxJson> {
    if (fullAuth === null) throw new Error("No account is connected");
    return fullAuth.sign(tx);
  }

  function accountPublicKey(): string | null {
    return fullAuth?.publicKey ?? null;
  }

  function disconnect(): void {
    reset();
  }

  /** Simulated clock only: let ledger time pass. */
  async function advance(seconds: number): Promise<void> {
    backend.clock?.advance(seconds);
    await refresh();
  }

  async function tick(): Promise<void> {
    backend.clock?.closeLedger();
    await refresh();
  }

  /* ---- Quantum screen: migration of an account the device controls ---- */

  return {
    state,
    refresh,
    createAccount,
    openSession,
    closeSession,
    runAction,
    runAttack,
    advance,
    tick,
    prepare,
    signAsAccount,
    accountPublicKey,
    disconnect,
    sink,
    victim,
    /** Drops for an amount of XRP, for the forms. */
    toDrops: xrpToDrops,
  };
}

export type Demo = ReturnType<typeof createDemo>;
