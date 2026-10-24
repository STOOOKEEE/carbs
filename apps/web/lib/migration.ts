/**
 * The guided post-quantum migration of the Quantum screen (spec 8.7). The order is not
 * negotiable: (1) SetRegularKey to the ML-DSA-44 key, signed by the master key;
 * (2) a proof transaction signed by the ML-DSA-44 key; (3) asfDisableMaster, signed by
 * the master key, refused by this app unless step 2 was accepted, the key is proven
 * recoverable and the surviving authorities were reviewed. Those refusals are OUR safety
 * rules and are labelled as such; the node's own answers are shown as the node's.
 * Signing stays on the device (SIMULATED until the device track's real flow exists).
 * Fresh accounts only.
 */
import { reactive } from "vue";
import { TF_FULLY_CANONICAL_SIG } from "./constants";
import {
  DeviceRejectedError,
  type Backend,
  type ExposureReport,
  type NodeResult,
  type TxJson,
  type UnsignedTx,
} from "./ports";

export type StepStatus = "todo" | "ok" | "failed" | "refused";

export interface MigrationStep {
  id: 1 | 2 | 3;
  title: string;
  signedBy: string;
  status: StepStatus;
  result: NodeResult | null;
  /** Our own safety-rule message when the app refused to send the step. */
  refusal: string | null;
}

/** What the Quantum screen needs from a migration, simulated or live. */
export interface MigrationController {
  kind: "simulated" | "live";
  state: MigrationState;
  start(): Promise<void>;
  proveRecoverable(): Promise<void>;
  runStep(id: 1 | 2 | 3): Promise<void>;
}

export interface MigrationState {
  address: string | null;
  steps: MigrationStep[];
  recoverableProven: boolean;
  authoritiesReviewed: boolean;
  /** Live run only: the seed of the SIMULATED device, shown so the person can save it. */
  recoverySeed: string | null;
  /** Live run only: the person confirmed saving that seed. */
  recoveryConfirmed: boolean;
  before: ExposureReport | null;
  after: ExposureReport | null;
  busy: boolean;
  error: string | null;
}

const STEP_TEMPLATES: readonly Pick<MigrationStep, "id" | "title" | "signedBy">[] = [
  { id: 1, title: "SetRegularKey to the ML-DSA-44 key", signedBy: "master key, on the device" },
  { id: 2, title: "Proof transaction", signedBy: "ML-DSA-44 key, on the device" },
  { id: 3, title: "AccountSet asfDisableMaster", signedBy: "master key, on the device" },
];

export function createMigration(backend: Backend) {
  const build = backend.builders;
  const state = reactive<MigrationState>({
    address: null,
    steps: [],
    recoverableProven: false,
    authoritiesReviewed: false,
    recoverySeed: null,
    recoveryConfirmed: false,
    before: null,
    after: null,
    busy: false,
    error: null,
  });

  function freshSteps(): MigrationStep[] {
    return STEP_TEMPLATES.map((t) => ({ ...t, status: "todo", result: null, refusal: null }));
  }

  async function guarded(work: () => Promise<void>): Promise<void> {
    state.busy = true;
    state.error = null;
    try {
      await work();
    } catch (error) {
      state.error =
        error instanceof DeviceRejectedError
          ? "Rejected on the device. Nothing was sent."
          : error instanceof Error
            ? error.message
            : String(error);
    } finally {
      state.busy = false;
    }
  }

  /** A fresh account whose master key is the device's classical key. */
  async function start(): Promise<void> {
    await guarded(async () => {
      const classical = await backend.device.getPublicKey("secp256k1");
      await backend.node.fundAccount(classical.address);
      state.address = classical.address;
      state.steps = freshSteps();
      state.recoverableProven = false;
      state.authoritiesReviewed = false;
      state.after = null;
      state.before = await backend.exposure.check(classical.address, "alphanet");
    });
  }

  async function envelope(tx: UnsignedTx): Promise<TxJson> {
    const common = await backend.node.commonFields(tx.Account);
    const out: TxJson = {
      ...tx,
      ...common,
      Flags: ((tx.Flags ?? 0) | TF_FULLY_CANONICAL_SIG) >>> 0,
    };
    return out;
  }

  /** Derive the ML-DSA-44 key twice and compare (spec 8.7 safety rule b). */
  async function proveRecoverable(): Promise<void> {
    await guarded(async () => {
      const first = await backend.device.getPublicKey("mldsa44");
      const second = await backend.device.getPublicKey("mldsa44");
      state.recoverableProven = first.publicKey === second.publicKey;
      if (!state.recoverableProven) state.error = "The two derivations differ: do not continue.";
    });
  }

  async function runStep(id: 1 | 2 | 3): Promise<void> {
    await guarded(async () => {
      const address = state.address;
      const step = state.steps.find((s) => s.id === id);
      if (address === null || step === undefined) throw new Error("Start with a fresh account");
      step.refusal = null;

      if (id === 2 && state.steps[0]?.status !== "ok") {
        step.status = "refused";
        step.refusal =
          "Step 1 must be accepted first: the ML-DSA-44 key cannot sign before it is the regular key.";
        return;
      }
      if (id === 3) {
        const reasons: string[] = [];
        if (state.steps[1]?.status !== "ok") reasons.push("the proof transaction was not accepted");
        if (!state.recoverableProven) reasons.push("the ML-DSA-44 key is not proven recoverable");
        if (!state.authoritiesReviewed) reasons.push("the surviving authorities were not reviewed");
        if (reasons.length > 0) {
          step.status = "refused";
          step.refusal = `Refused by this app: ${reasons.join("; ")}. Losing the key after this step locks the account for good.`;
          return;
        }
      }

      const pq = await backend.device.getPublicKey("mldsa44");
      const unsigned: UnsignedTx =
        id === 1
          ? build.setRegularKey(address, pq.address)
          : id === 2
            ? build.accountSetNoop(address)
            : build.accountSetDisableMaster(address);
      const signed = await backend.device.signTransaction(
        id === 2 ? "mldsa44" : "secp256k1",
        await envelope(unsigned),
      );
      const result = await backend.node.submit(signed);
      step.result = result;
      step.status = result.success ? "ok" : "failed";
      if (id === 3 && result.success) {
        state.after = await backend.exposure.check(address, "alphanet");
      }
    });
  }

  const controller: MigrationController = {
    kind: "simulated",
    state,
    start,
    proveRecoverable,
    runStep,
  };
  return controller;
}

export type Migration = MigrationController;
