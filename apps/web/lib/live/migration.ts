/**
 * The live post-quantum migration of the Quantum screen (spec 8.7) on the AlphaNet, with a
 * fresh faucet account, signed client-side, submitted to the real node, explorer links for
 * every transaction. Built on `buildPqMigration`, `disableMasterRefusals` and the node
 * helpers of `@carbs/sessions`, and on the device contract of `@carbs/ledger`.
 *
 * **SIMULATED:** the device. It is the contract-following software device of
 * `@carbs/ledger` (a test double of the XRP app, with a random seed made in this page), not
 * a Stax; the review is shown by the page's simulated Stax screen. Everything the node
 * answers is real. The account is fresh and has no value.
 *
 * Step 3 (`asfDisableMaster`) is refused by `disableMasterRefusals` unless the proof was
 * validated, the ML-DSA key is recoverable (here: the person saved the simulated device's
 * seed, a post-quantum backup, since a software device cannot be reinstalled) and the
 * surviving authorities were reviewed. The node's own answers are shown as the node's.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  fetchCommonFields,
  generateClassicSeed,
  getAccountState,
  isIncluded,
  resultCategory,
  signTransaction,
  submitAndWait,
  type BytesSigner,
  type FinalResult,
} from "@carbs/sessions";
import {
  buildPqMigration,
  disableMasterRefusals,
  type MigrationPlan,
} from "@carbs/sessions/quantum";
import {
  DeviceError,
  SimulatedDevice,
  deviceClassicSigner,
  deviceMlDsaSigner,
  kSw,
  type Review,
} from "@carbs/ledger";
import { reactive } from "vue";
import type { DeviceApprover, DeviceReview, NodeResult, ResultFamily } from "../ports";
import { DeviceRejectedError } from "../ports";
import type { MigrationController, MigrationState } from "../migration";
import type { AppNetwork } from "../networks";
import type { LiveClients } from "./clients";
import type { LiveExposure } from "./exposure";

const FAUCET_POLL_MS = 2000;
const FAUCET_POLLS = 30;
const DEVICE_SEED_BYTES = 64;
const MASTER_PATH = "44'/144'/0'/0/0";
const STEP_TITLES = [
  {
    id: 1,
    title: "SetRegularKey to the ML-DSA-44 key",
    signedBy: "master key, on the SIMULATED device",
  },
  { id: 2, title: "Proof transaction", signedBy: "ML-DSA-44 key, on the SIMULATED device" },
  { id: 3, title: "AccountSet asfDisableMaster", signedBy: "master key, on the SIMULATED device" },
] as const;

export interface LiveMigrationDeps {
  clients: LiveClients;
  exposure: LiveExposure;
  network: () => AppNetwork;
  /** The page's simulated Stax screen. */
  approver: DeviceApprover;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** A node answer in the shape of the port. */
export function toNodeResult(final: FinalResult): NodeResult {
  const family = (resultCategory(final.result) ?? "tef") as ResultFamily;
  return {
    code: final.result,
    family,
    success: final.result === "tesSUCCESS",
    feeClaimed: isIncluded(final.result),
    hash: final.hash,
    ledgerIndex: final.ledgerIndex ?? 0,
  };
}

function asDeviceReview(review: Review): DeviceReview {
  return {
    title: review.kind === "blind" ? "Blind signing required" : "Review transaction",
    lines: review.lines.map((line) => ({ label: line.label, value: line.value })),
    simulated: true,
  };
}

/** The device contract reports a refusal on the screen as status word 0x6985. */
function isDenied(error: unknown): boolean {
  return error instanceof DeviceError && error.statusWord === kSw.denied;
}

export function createLiveMigration(deps: LiveMigrationDeps): MigrationController {
  const fetcher = deps.fetcher ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const state: MigrationState = reactive({
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

  let plan: MigrationPlan | null = null;
  let master: BytesSigner | null = null;
  let mlDsa: BytesSigner | null = null;
  let proof: FinalResult | null = null;
  let backupDescription: string | null = null;

  async function guarded(work: () => Promise<void>): Promise<void> {
    state.busy = true;
    state.error = null;
    try {
      await work();
    } catch (error) {
      state.error =
        error instanceof DeviceRejectedError || isDenied(error)
          ? "Rejected on the device. Nothing was sent."
          : error instanceof Error
            ? error.message
            : String(error);
    } finally {
      state.busy = false;
    }
  }

  async function fundFresh(address: string): Promise<void> {
    const network = deps.network();
    if (network.faucet === null) throw new Error(`${network.name} has no faucet`);
    const response = await fetcher(network.faucet, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: address, userAgent: "carbs-web" }),
    });
    if (!response.ok) throw new Error(`faucet: HTTP ${response.status}`);
    const client = deps.clients.client("alphanet");
    for (let i = 0; i < FAUCET_POLLS; i += 1) {
      if (await getAccountState(client, address, "validated")) return;
      await sleep(FAUCET_POLL_MS);
    }
    throw new Error(
      `faucet: ${address} was not funded after ${(FAUCET_POLLS * FAUCET_POLL_MS) / 1000} s`,
    );
  }

  async function start(): Promise<void> {
    await guarded(async () => {
      if (deps.network().readOnly) throw new Error("This network is read-only");
      const defs = await deps.clients.definitions("alphanet");
      // The simulated device: the contract, a software key, a seed made here and shown later.
      const seed = crypto.getRandomValues(new Uint8Array(DEVICE_SEED_BYTES));
      const device = new SimulatedDevice({
        defs,
        bip39Seed: seed,
        classicSeeds: {
          secp256k1: generateClassicSeed("ecdsa-secp256k1"),
          ed25519: generateClassicSeed("ed25519"),
        },
        approve: (review) => deps.approver(asDeviceReview(review)),
      });
      master = await deviceClassicSigner(device, MASTER_PATH, "secp256k1");
      mlDsa = await deviceMlDsaSigner(device);
      const address = addressFromPublicKey(master.publicKey);
      await fundFresh(address);
      plan = buildPqMigration(address, mlDsa.publicKey, defs);
      proof = null;
      backupDescription = null;
      state.address = address;
      state.steps = STEP_TITLES.map((t) => ({ ...t, status: "todo", result: null, refusal: null }));
      state.recoverableProven = false;
      state.authoritiesReviewed = false;
      state.recoverySeed = null;
      state.recoveryConfirmed = false;
      state.after = null;
      state.before = await deps.exposure.check(address, "alphanet");
      // Kept in a closure, shown only when the person asks for the backup.
      pendingSeed = bytesToHex(seed);
    });
  }

  let pendingSeed: string | null = null;

  async function proveRecoverable(): Promise<void> {
    await guarded(async () => {
      if (pendingSeed === null) throw new Error("Start with a fresh account");
      // A software device cannot be reinstalled, so the evidence is a backup the person saves.
      state.recoverySeed = pendingSeed;
      backupDescription =
        "The seed of the SIMULATED device was shown to the person, who confirmed saving it";
    });
  }

  async function sign(
    step: MigrationPlan["steps"][number],
    signer: BytesSigner,
  ): Promise<FinalResult> {
    const defs = await deps.clients.definitions("alphanet");
    const client = deps.clients.client("alphanet");
    const account = plan?.account ?? "";
    const common = await fetchCommonFields(client, account);
    const signed = await signTransaction({ ...step.tx, ...common }, signer, defs);
    return submitAndWait(client, signed.blob, signed.hash, common.LastLedgerSequence);
  }

  async function runStep(id: 1 | 2 | 3): Promise<void> {
    await guarded(async () => {
      if (plan === null || master === null || mlDsa === null) {
        throw new Error("Start with a fresh account");
      }
      const view = state.steps.find((s) => s.id === id);
      const step = plan.steps[id - 1];
      if (view === undefined || step === undefined) throw new Error(`No step ${id}`);
      view.refusal = null;

      if (id === 2 && state.steps[0]?.status !== "ok") {
        view.status = "refused";
        view.refusal =
          "Step 1 must be accepted first: the ML-DSA-44 key cannot sign before it is the regular key.";
        return;
      }
      if (id === 3) {
        const report = await deps.exposure.checkRaw(plan.account, "alphanet");
        const refusals = disableMasterRefusals(plan, {
          proofResult: proof ?? undefined,
          recoverability:
            state.recoverySeed !== null && state.recoveryConfirmed && backupDescription !== null
              ? { kind: "pq-backup", description: backupDescription }
              : undefined,
          reviewedReport: report,
          authoritiesAcknowledged: state.authoritiesReviewed,
        });
        if (refusals.length > 0) {
          view.status = "refused";
          view.refusal = `Refused by this app: ${refusals.join("; ")}. Losing the key after this step locks the account for good.`;
          return;
        }
      }

      const final = await sign(step, id === 2 ? mlDsa : master);
      if (id === 2) proof = final;
      view.result = toNodeResult(final);
      view.status = view.result.success && final.validated ? "ok" : "failed";
      if (id === 3 && view.status === "ok") {
        state.after = await deps.exposure.check(plan.account, "alphanet");
      }
    });
  }

  return { kind: "live", state, start, proveRecoverable, runStep };
}
