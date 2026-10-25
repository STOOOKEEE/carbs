<script setup lang="ts">
import BusyNote from "~/components/ui/BusyNote.vue";
import ExplorerLink from "~/components/ui/ExplorerLink.vue";
import LedgerDevicePicker from "~/components/ui/LedgerDevicePicker.vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import NeedAccount from "~/components/ui/NeedAccount.vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { kDefaultSessionDuration, kPermissionMaxSize } from "@carbs/sessions";
import { DEFAULT_CAP_XRP, SESSION_DURATION_CHOICES_SEC } from "~/lib/constants";
import { useBackend, useDemo } from "~/lib/context";
import { formatCountdown, formatDuration, formatXrp, shortAddress, xrpToDrops } from "~/lib/format";
import type { NodeResult, SessionMode } from "~/lib/ports";
import { ACTIONS } from "~/lib/scenarios";
import { sessionPermissionChoices } from "~/lib/sim/types";

const backend = useBackend();
const demo = useDemo();
const state = demo.state;

const MODES: readonly { id: SessionMode; title: string; body: string }[] = [
  { id: "P", title: "P · Listed types", body: "Only the transaction types you tick." },
  { id: "C", title: "C · Spend cap", body: "XRP payments only, with a total cap, fees included." },
  {
    id: "A",
    title: "A · All transactions",
    body: "Everything delegable except what changes who controls the account. Never the default.",
  },
];

const form = reactive({
  mode: "P" as SessionMode,
  durationSec: kDefaultSessionDuration as number,
  permissions: ACTIONS.map((a) => a.type).filter((t) => sessionPermissionChoices().includes(t)),
  capXrp: DEFAULT_CAP_XRP,
});
const lastResult = ref<NodeResult | null>(null);
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 250);
});
onBeforeUnmount(() => clearInterval(timer));

const choices = sessionPermissionChoices();
const entry = computed(() => state.session);
const secondsLeft = computed(() => {
  const session = entry.value;
  const server = state.server;
  if (session === null || server === null) return 0;
  const elapsed = (now.value - state.serverAt) / 1000;
  return session.expiration - (server.closeTime + elapsed);
});
const capPercent = computed(() => {
  const session = entry.value;
  if (session === null || session.capDrops === null || session.capDrops === 0) return 0;
  return Math.min(100, ((session.spentDrops ?? 0) / session.capDrops) * 100);
});
const tooMany = computed(() => form.permissions.length > kPermissionMaxSize);
const canOpen = computed(
  () =>
    !state.busy &&
    state.sessionKey === null &&
    (form.mode !== "P" || (form.permissions.length > 0 && !tooMany.value)),
);
/** The open button signs on the simulated Stax for a Ledger account, whatever the node is. */
const openSimulated = computed(
  () =>
    backend.mode === "simulated" ||
    (state.profile === "ledger" && backend.device.mode === "simulated"),
);
const openHint = computed(() => {
  if (state.sessionKey !== null) return null;
  if (form.mode === "P" && form.permissions.length === 0)
    return "Tick at least one transaction type.";
  if (form.mode === "P" && tooMany.value) return `Tick at most ${kPermissionMaxSize} types.`;
  return null;
});
const openLabel = computed(() =>
  state.profile === "ledger"
    ? "Open on the Ledger"
    : state.profile === "demo"
      ? "Open with the demo master key"
      : "Open with the passkey",
);

async function open(): Promise<void> {
  lastResult.value = await demo.openSession({
    mode: form.mode,
    durationSec: form.durationSec,
    permissions: form.mode === "P" ? form.permissions : [],
    capDrops: form.mode === "C" ? xrpToDrops(form.capXrp) : 0,
  });
}

async function close(): Promise<void> {
  lastResult.value = await demo.closeSession();
}
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Session" title="Open a session">
      A short-lived key that signs without prompting. The ledger, not this page, confines it.
    </ScreenHeader>

    <NeedAccount v-if="!state.ready" />
    <template v-else>
      <div class="grid gap-5 lg:grid-cols-2">
        <form class="panel space-y-4" data-testid="session-form" @submit.prevent="open">
          <fieldset class="space-y-2">
            <legend class="eyebrow mb-2">Mode</legend>
            <label v-for="mode in MODES" :key="mode.id" class="flex gap-3 text-sm">
              <input
                v-model="form.mode"
                type="radio"
                name="mode"
                :value="mode.id"
                :data-testid="`mode-${mode.id}`"
              />
              <span
                ><strong>{{ mode.title }}</strong
                ><br /><span class="text-muted-foreground">{{ mode.body }}</span></span
              >
            </label>
          </fieldset>

          <label class="field">
            <span>Duration</span>
            <select v-model.number="form.durationSec" class="input" data-testid="duration">
              <option v-for="d in SESSION_DURATION_CHOICES_SEC" :key="d" :value="d">
                {{ formatDuration(d) }}
              </option>
            </select>
          </label>

          <fieldset v-if="form.mode === 'P'" class="space-y-1">
            <legend class="eyebrow mb-1">Allowed types (at most {{ kPermissionMaxSize }})</legend>
            <div class="grid grid-cols-2 gap-1 text-sm">
              <label v-for="type in choices" :key="type" class="flex items-center gap-2">
                <input v-model="form.permissions" type="checkbox" :value="type" /> {{ type }}
              </label>
            </div>
          </fieldset>

          <label v-if="form.mode === 'C'" class="field">
            <span>Cap in XRP, fees included</span>
            <input
              v-model.number="form.capXrp"
              type="number"
              min="1"
              step="1"
              class="input"
              data-testid="cap"
            />
          </label>

          <template v-if="backend.mode === 'live' && state.profile === 'ledger'">
            <LedgerDevicePicker />
            <p class="text-sm text-muted-foreground" data-testid="device-same-note">
              Sign with the device this Ledger account was created on: another one holds other keys.
            </p>
          </template>
          <button
            class="btn btn-primary"
            type="submit"
            :disabled="!canOpen"
            data-testid="open-session"
          >
            {{ openLabel }}
            <SimBadge v-if="openSimulated" />
          </button>
          <p v-if="openHint" class="text-sm text-muted-foreground" data-testid="open-hint">
            {{ openHint }}
          </p>
          <p v-if="state.sessionKey" class="text-sm text-muted-foreground">
            A session is already open. Close it to open another.
          </p>
        </form>

        <section class="panel space-y-3" data-testid="session-card">
          <h2 class="panel-title">Active session</h2>
          <template v-if="entry">
            <p class="text-4xl font-display tabular-nums" data-testid="countdown">
              {{ formatCountdown(secondsLeft) }}
            </p>
            <p v-if="secondsLeft <= 0" class="text-danger" data-testid="expired">
              Expired: only its own close still works.
            </p>
            <dl class="kv">
              <dt>Mode</dt>
              <dd data-testid="entry-mode">{{ entry.mode }}</dd>
              <dt>Session key</dt>
              <dd class="mono">
                <ExplorerLink
                  kind="account"
                  :value="entry.sessionKey"
                  :network="backend.node.explorerNetwork()"
                  :simulated="backend.mode === 'simulated'"
                  :text="shortAddress(entry.sessionKey)"
                />
              </dd>
              <dt v-if="entry.permissions.length">Allows</dt>
              <dd v-if="entry.permissions.length">{{ entry.permissions.join(", ") }}</dd>
            </dl>
            <div v-if="entry.capDrops !== null" data-testid="cap-bar">
              <div class="flex justify-between text-sm">
                <span>Spent</span>
                <span data-testid="spent"
                  >{{ formatXrp(entry.spentDrops ?? 0) }} of {{ formatXrp(entry.capDrops) }}</span
                >
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full bg-accent transition-all duration-base"
                  :style="{ width: `${capPercent}%` }"
                />
              </div>
            </div>
            <button
              class="btn btn-danger"
              :disabled="state.busy"
              data-testid="close-session"
              @click="close"
            >
              Close the session
            </button>
          </template>
          <p v-else class="text-muted-foreground">No session open.</p>
          <div v-if="backend.clock" class="flex items-center gap-2 border-t pt-3 text-sm">
            <SimBadge />
            <button class="btn" data-testid="advance" @click="demo.advance(60)">
              Let 60 s pass
            </button>
          </div>
        </section>
      </div>

      <BusyNote :busy="state.busy" class="mt-4" />
      <p v-if="state.error" class="mt-4 text-danger" role="alert" data-testid="error">
        {{ state.error }}
      </p>
      <div v-if="lastResult" class="panel mt-5" data-testid="session-result">
        <ResultView :result="lastResult" :simulated="backend.mode === 'simulated'" />
      </div>
    </template>
  </section>
</template>
