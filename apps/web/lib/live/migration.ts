/**
 * The live post-quantum migration of the Quantum screen (spec 8.7) on the AlphaNet, with a
 * fresh faucet account, signed client-side, submitted to the real node, explorer links for
 * every transaction. Built on `buildPqMigration`, `disableMasterRefusals` and the node
 * helpers of `@carbs/sessions`, and on the device contract of `@carbs/ledger`.
 *
 * The device is the one chosen when the run starts (`device-selection.ts`):
 * - a real Ledger Stax over USB: the master key and the ML-DSA-44 root key are the Stax's,
 *   every review and confirmation happens on its screen;
 * - by default the **SIMULATED** software device of `@carbs/ledger` (a test double of the XRP
 *   app, with a random seed made in this page), whose review is shown by the page's simulated
 *   Stax screen.
 * Everything the node answers is real. The account is fresh and has no value.
 *
 * Step 3 (`asfDisableMaster`) is refused by `disableMasterRefusals` unless the proof was
 * validated, the ML-DSA key is recoverable and the surviving authorities were reviewed. On a
 * Stax the evidence is the key read a second time, after reinstalling the XRP app, identical to
 * the first; a software device cannot be reinstalled, so there the person saves its seed (a
 * post-quantum backup). The node's own answers are shown as the node's.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  equalBytes,
  fetchCommonFields,
  generateClassicSeed,
  getAccountState,
  signTransaction,
  submitAndWait,
  type BytesSigner,
  type FinalResult,
} from "@carbs/sessions";
import {
  buildPqMigration,
  disableMasterRefusals,
  type MigrationPlan,
  type RecoverabilityEvidence,
} from "@carbs/sessions/quantum";
import {
  SimulatedDevice,
  describeLedgerError,
  deviceClassicSigner,
  deviceMlDsaSigner,
  getMlDsaPublicKey,
  kDefaultXrpPath,
  type ApduTransport,
} from "@carbs/ledger";
import { reactive } from "vue";
import type { DeviceApprover } from "../ports";
import type { MigrationController, MigrationState, MigrationStep } from "../migration";
import type { AppNetwork } from "../networks";
import type { LiveClients } from "./clients";
import { deviceReview, isDeviceRefusal } from "./contract-device";
import { createDeviceSelection, type DeviceSelection } from "./device-selection";
import { toNodeResult } from "./result";
import type { LiveExposure } from "./exposure";

const FAUCET_POLL_MS = 2000;
const FAUCET_POLLS = 30;
const DEVICE_SEED_BYTES = 64;
const SIMULATED_DEVICE_LABEL = "the SIMULATED device";
const STAX_LABEL = "the Ledger Stax (USB)";

function stepTitles(device: string): Pick<MigrationStep, "id" | "title" | "signedBy">[] {
  return [
    { id: 1, title: "SetRegularKey to the ML-DSA-44 key", signedBy: `master key, on ${device}` },
    { id: 2, title: "Proof transaction", signedBy: `ML-DSA-44 key, on ${device}` },
    { id: 3, title: "AccountSet asfDisableMaster", signedBy: `master key, on ${device}` },
  ];
}

export interface LiveMigrationDeps {
  clients: LiveClients;
  exposure: LiveExposure;
  network: () => AppNetwork;
  /** The page's simulated Stax screen. */
  approver: DeviceApprover;
  /** Simulated device or real Stax; without it, the simulated device. */
  device?: DeviceSelection;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createLiveMigration(deps: LiveMigrationDeps): MigrationController {
  const fetcher = deps.fetcher ?? globalThis.fetch.bind(globalThis);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const selection = deps.device ?? createDeviceSelection();

  const state: MigrationState = reactive({
    address: null,
    steps: [],
    recoverableProven: false,
    authoritiesReviewed: false,
    recoverySeed: null,
    recoveryConfirmed: false,
    realDevice: false,
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
  /** The seed of the device made by the latest `start()`; shown only when the person asks for the backup. */
  let pendingSeed: string | null = null;
  /** Real Stax only: the ML-DSA-44 key read a second time. */
  let secondRead: RecoverabilityEvidence | null = null;

  async function guarded(work: () => Promise<void>): Promise<void> {
    state.busy = true;
    state.error = null;
    try {
      await work();
    } catch (error) {
      state.error = isDeviceRefusal(error)
        ? "Rejected on the device. Nothing was sent."
        : describeLedgerError(error);
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
      // A previous run's seed must never be shown as the backup of this run's key.
      pendingSeed = null;
      state.recoverySeed = null;
      if (deps.network().readOnly) throw new Error("This network is read-only");
      const defs = await deps.clients.definitions("alphanet");
      const realDevice = selection.choice === "usb";
      let device: ApduTransport;
      let seed: Uint8Array | null = null;
      if (realDevice) {
        // Refuses at once when no Stax is connected. The transport looks the Stax up at each
        // APDU, so reconnecting it (after reinstalling the XRP app) keeps the run going.
        selection.ledger();
        device = selection.transport;
      } else {
        // The simulated device: the contract, a software key, a seed made here and shown later.
        seed = crypto.getRandomValues(new Uint8Array(DEVICE_SEED_BYTES));
        device = new SimulatedDevice({
          defs,
          bip39Seed: seed,
          classicSeeds: {
            secp256k1: generateClassicSeed("ecdsa-secp256k1"),
            ed25519: generateClassicSeed("ed25519"),
          },
          approve: (review) => deps.approver(deviceReview(review, true)),
        });
      }
      master = await deviceClassicSigner(device, kDefaultXrpPath, "secp256k1");
      mlDsa = await deviceMlDsaSigner(device);
      const address = addressFromPublicKey(master.publicKey);
      await fundFresh(address);
      plan = buildPqMigration(address, mlDsa.publicKey, defs);
      pendingSeed = seed === null ? null : bytesToHex(seed);
      proof = null;
      backupDescription = null;
      secondRead = null;
      state.address = address;
      state.realDevice = realDevice;
      state.steps = stepTitles(realDevice ? STAX_LABEL : SIMULATED_DEVICE_LABEL).map((t) => ({
        ...t,
        status: "todo",
        result: null,
        refusal: null,
      }));
      state.recoverableProven = false;
      state.authoritiesReviewed = false;
      state.recoverySeed = null;
      state.recoveryConfirmed = false;
      state.after = null;
      state.before = await deps.exposure.check(address, "alphanet");
    });
  }

  /** Reads the ML-DSA-44 key from the Stax again and keeps it as the evidence of step 3. */
  async function readKeyAgain(firstKey: Uint8Array): Promise<void> {
    const afterReinstall = state.recoveryConfirmed;
    const second = await getMlDsaPublicKey(selection.transport);
    secondRead = {
      kind: "derived-twice",
      first: firstKey,
      second,
      afterReinstall,
      source: "device",
    };
    const same = equalBytes(second, firstKey);
    state.recoverableProven = same && afterReinstall;
    if (!same) {
      throw new Error(
        "The Stax answered a different ML-DSA-44 key: it is not the device (or the seed) of this account.",
      );
    }
  }

  async function proveRecoverable(): Promise<void> {
    await guarded(async () => {
      if (state.realDevice) {
        if (mlDsa === null) throw new Error("Start with a fresh account");
        await readKeyAgain(mlDsa.publicKey);
        return;
      }
      if (pendingSeed === null) throw new Error("Start with a fresh account");
      // A software device cannot be reinstalled, so the evidence is a backup the person saves.
      state.recoverySeed = pendingSeed;
      backupDescription =
        "The seed of the SIMULATED device was shown to the person, who confirmed saving it";
    });
  }

  function recoverability(): RecoverabilityEvidence | undefined {
    if (state.realDevice) return secondRead ?? undefined;
    return state.recoverySeed !== null && state.recoveryConfirmed && backupDescription !== null
      ? { kind: "pq-backup", description: backupDescription }
      : undefined;
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
          recoverability: recoverability(),
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
