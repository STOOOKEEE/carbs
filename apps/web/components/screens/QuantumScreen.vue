<script setup lang="ts">
import { computed, ref } from "vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend, useLiveExposure, useMigration, useNetwork } from "~/lib/context";
import { shortHex } from "~/lib/format";
import type { ExposureReport, NetworkName } from "~/lib/ports";

const backend = useBackend();
const migration = useMigration();
const liveExposure = useLiveExposure();
/** Live reads of the real nodes, or the simulated histories (fixtures below). */
const source = ref<"live" | "simulated">("live");
const networkStore = useNetwork();
const quantumNetworks = computed(() => {
  const all = networkStore.networks();
  return [all.alphanet, all.mainnet];
});
const mstate = migration.state;

const address = ref("");
const network = ref<NetworkName>("alphanet");
const report = ref<ExposureReport | null>(null);
const checking = ref(false);
const checkError = ref<string | null>(null);

const readOnly = computed(() => network.value === "mainnet");
const simulated = computed(() => backend.mode === "simulated");
const exposurePort = computed(() => (source.value === "live" ? liveExposure : backend.exposure));

const STATUS_TEXT: Record<ExposureReport["status"], string> = {
  exposed: "Exposed",
  "no-exposure-found": "No exposure found",
  unknown: "Unknown",
};

async function check(): Promise<void> {
  checking.value = true;
  checkError.value = null;
  try {
    report.value = await exposurePort.value.check(address.value.trim(), network.value);
  } catch (error) {
    checkError.value = error instanceof Error ? error.message : String(error);
  } finally {
    checking.value = false;
  }
}

async function useFixture(value: string): Promise<void> {
  address.value = value;
  await check();
}
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Quantum" title="Is this account exposed?">
      A public key is visible on the ledger once something has signed with it. Paste an address to
      see where it stands; mainnet is read-only.
    </ScreenHeader>

    <form class="panel space-y-4" data-testid="exposure-form" @submit.prevent="check">
      <div class="grid gap-4 md:grid-cols-[1fr_14rem]">
        <label class="field">
          <span>XRPL address</span>
          <input
            v-model="address"
            class="input mono"
            placeholder="r…"
            data-testid="address-input"
            autocomplete="off"
          />
        </label>
        <label class="field">
          <span>Network</span>
          <select v-model="network" class="input" data-testid="network">
            <option v-for="option in quantumNetworks" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </label>
      </div>
      <fieldset class="flex flex-wrap items-center gap-4 text-sm">
        <legend class="eyebrow mb-1">Data</legend>
        <label class="flex items-center gap-2">
          <input
            v-model="source"
            type="radio"
            name="source"
            value="live"
            data-testid="source-live"
          />
          Live: read the real node (read-only)
        </label>
        <label class="flex items-center gap-2">
          <input
            v-model="source"
            type="radio"
            name="source"
            value="simulated"
            data-testid="source-simulated"
          />
          Simulated histories <SimBadge />
        </label>
      </fieldset>
      <div class="flex flex-wrap items-center gap-2">
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="checking || address.trim() === ''"
          data-testid="check"
        >
          Check exposure
        </button>
        <template v-if="source === 'simulated'">
          <span class="text-sm text-muted-foreground">Try:</span>
          <button
            v-for="fixture in backend.fixtures"
            :key="fixture.id"
            type="button"
            class="btn"
            :data-testid="`fixture-${fixture.id}`"
            @click="useFixture(fixture.address)"
          >
            {{ fixture.label }}
          </button>
        </template>
      </div>
      <p v-if="checkError" class="text-danger" role="alert">{{ checkError }}</p>
    </form>

    <section v-if="report" class="panel mt-6 space-y-4" data-testid="report">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="panel-title">Report</h2>
        <span
          class="chip"
          :class="
            report.status === 'exposed'
              ? 'chip-danger'
              : report.status === 'unknown'
                ? 'chip-warn'
                : 'chip-ok'
          "
          data-testid="status"
        >
          {{ STATUS_TEXT[report.status] }}
        </span>
        <SimBadge v-if="report.simulated" />
      </div>
      <p class="text-sm text-muted-foreground" data-testid="coverage">{{ report.coverage }}</p>
      <ul class="space-y-3">
        <li
          v-for="(reason, index) in report.reasons"
          :key="index"
          class="text-sm"
          :data-testid="`reason-${reason.source}`"
        >
          <span class="chip" :class="reason.exposed ? 'chip-danger' : 'chip-ok'">{{
            reason.source
          }}</span>
          {{ reason.text }}
          <span v-if="reason.firstTxHash" class="mono block text-muted-foreground">
            first revealed in {{ shortHex(reason.firstTxHash) }} at ledger {{ reason.firstLedger }}
          </span>
        </li>
      </ul>
      <div v-if="report.survivingAuthorities.length" data-testid="surviving">
        <p class="eyebrow mb-1">Survive disabling the master key</p>
        <ul class="list-inside list-disc text-sm">
          <li v-for="item in report.survivingAuthorities" :key="item">{{ item }}</li>
        </ul>
      </div>
    </section>

    <section class="panel mt-6 space-y-4" data-testid="migration">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="panel-title">Migrate with the Ledger</h2>
        <SimBadge v-if="simulated" title="The device and the node are simulated" />
      </div>
      <p v-if="readOnly" class="text-muted-foreground" data-testid="read-only">
        Mainnet is read-only here: the migration runs on the AlphaNet, on a fresh account.
      </p>
      <template v-else>
        <p class="text-sm text-muted-foreground">
          Three steps, in this order, each confirmed on the device: SetRegularKey to the ML-DSA-44
          key, a proof transaction signed by that key, then asfDisableMaster.
        </p>
        <button
          class="btn btn-primary"
          :disabled="mstate.busy"
          data-testid="migration-start"
          @click="migration.start()"
        >
          Start with a fresh AlphaNet account
        </button>
        <template v-if="mstate.address">
          <p class="mono" data-testid="migration-address">{{ mstate.address }}</p>
          <p v-if="mstate.before" class="text-sm">
            Before:
            <span
              class="chip"
              :class="mstate.before.status === 'exposed' ? 'chip-danger' : 'chip-ok'"
              >{{ STATUS_TEXT[mstate.before.status] }}</span
            >
          </p>
          <ol class="space-y-4">
            <li
              v-for="step in mstate.steps"
              :key="step.id"
              class="space-y-2"
              :data-testid="`step-${step.id}`"
            >
              <p class="text-sm">
                <strong>{{ step.id }}. {{ step.title }}</strong>
                <span class="text-muted-foreground"> · {{ step.signedBy }}</span>
              </p>
              <div v-if="step.id === 3" class="space-y-2 rounded-md border p-3 text-sm">
                <button
                  class="btn"
                  :disabled="mstate.busy"
                  data-testid="prove-recoverable"
                  @click="migration.proveRecoverable()"
                >
                  Derive the key twice to prove it is recoverable
                </button>
                <span v-if="mstate.recoverableProven" class="ml-2 text-ok" data-testid="recoverable"
                  >proven</span
                >
                <label class="flex items-center gap-2">
                  <input
                    v-model="mstate.authoritiesReviewed"
                    type="checkbox"
                    data-testid="reviewed"
                  />
                  I reviewed the authorities that survive disabling the master key
                </label>
              </div>
              <button
                class="btn"
                :disabled="mstate.busy || step.status === 'ok'"
                :data-testid="`run-step-${step.id}`"
                @click="migration.runStep(step.id)"
              >
                {{ step.status === "ok" ? "Done" : "Sign on the device" }}
              </button>
              <p
                v-if="step.refusal"
                class="text-sm text-warn"
                role="alert"
                :data-testid="`refusal-${step.id}`"
              >
                {{ step.refusal }}
              </p>
              <ResultView v-if="step.result" :result="step.result" :simulated="simulated" />
            </li>
          </ol>
          <p v-if="mstate.after" class="text-sm" data-testid="after">
            After:
            <span
              class="chip"
              :class="mstate.after.status === 'exposed' ? 'chip-danger' : 'chip-ok'"
              >{{ STATUS_TEXT[mstate.after.status] }}</span
            >
          </p>
        </template>
        <p v-if="mstate.error" class="text-danger" role="alert" data-testid="migration-error">
          {{ mstate.error }}
        </p>
      </template>
    </section>
  </section>
</template>
