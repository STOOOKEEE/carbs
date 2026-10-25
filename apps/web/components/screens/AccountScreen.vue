<script setup lang="ts">
import BusyNote from "~/components/ui/BusyNote.vue";
import { computed, ref } from "vue";
import LedgerDevicePicker from "~/components/ui/LedgerDevicePicker.vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { WEBHID_MESSAGE, hasWebHid } from "~/lib/browser-support";
import { useBackend, useDemo } from "~/lib/context";
import { formatXrp, shortAddress } from "~/lib/format";
import { PROFILE_LABELS, type Profile } from "~/lib/demo";

const backend = useBackend();
const demo = useDemo();
const state = demo.state;
const passkeyOnly = ref(false);
const webHid = hasWebHid();
// The simulated Stax needs no browser support; the real one does.
const ledgerBlocked = computed(() => backend.device.mode === "live" && !webHid);

const PROFILES: readonly { id: Profile; title: string; body: string; note: string }[] = [
  {
    id: "mac",
    title: "Mac account",
    body: "Keeps its master key and has a passkey. The passkey opens sessions; the session key is a non-extractible P-256 key.",
    note: "Not post-quantum: a passkey has full authority and cannot be replaced or removed.",
  },
  {
    id: "ledger",
    title: "Ledger account",
    body: "Master key disabled, the device's ML-DSA-44 key as regular key, never a passkey. Every own-authority transaction is signed on the device.",
    note: "Post-quantum root. Each transaction carries a 1 312-byte key and a 2 420-byte signature.",
  },
];

const masterLabel = computed(() => (state.info?.masterDisabled ? "disabled" : "enabled"));

async function create(profile: Profile): Promise<void> {
  await demo.createAccount(profile, { passkeyOnly: profile === "mac" && passkeyOnly.value });
}
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Account" title="Two kinds of account">
      Pick a profile and create a fresh account. Everything below is read back from the node.
    </ScreenHeader>

    <div class="grid gap-5 md:grid-cols-2">
      <article
        v-for="profile in PROFILES"
        :key="profile.id"
        class="panel panel-stack space-y-3"
        :data-testid="`profile-${profile.id}`"
      >
        <h2 class="panel-title">{{ profile.title }}</h2>
        <p>{{ profile.body }}</p>
        <p class="text-sm text-muted-foreground">{{ profile.note }}</p>
        <label v-if="profile.id === 'mac'" class="flex items-center gap-2 text-sm">
          <input v-model="passkeyOnly" type="checkbox" data-testid="passkey-only" />
          Passkey-only recipe: regular key to the blackhole address, master key disabled
        </label>
        <p
          v-if="profile.id === 'ledger' && !webHid"
          class="text-sm text-warn"
          role="note"
          data-testid="hid-warning"
        >
          {{ WEBHID_MESSAGE }}
          <template v-if="backend.device.mode === 'simulated'">
            The simulated Stax below works in any browser; the real one needs Chrome.
          </template>
        </p>
        <LedgerDevicePicker v-if="profile.id === 'ledger' && backend.mode === 'live'" />
        <button
          class="btn btn-primary"
          :disabled="state.busy || (profile.id === 'ledger' && ledgerBlocked)"
          :data-testid="`create-${profile.id}`"
          @click="create(profile.id)"
        >
          Create a fresh {{ profile.id === "mac" ? "Mac" : "Ledger" }} account
        </button>
      </article>
    </div>

    <BusyNote :busy="state.busy" class="mt-4" />
    <p v-if="state.error" class="mt-4 text-danger" role="alert" data-testid="error">
      {{ state.error }}
    </p>

    <template v-if="state.address">
      <div class="mt-8 grid gap-5 lg:grid-cols-2">
        <section class="panel" data-testid="account-state">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="panel-title">State from the node</h2>
            <SimBadge v-if="backend.mode === 'simulated'" />
          </div>
          <dl v-if="state.info" class="kv">
            <dt>Address</dt>
            <dd class="mono" data-testid="address">{{ state.address }}</dd>
            <dt>Profile</dt>
            <dd>
              {{ state.profile ? PROFILE_LABELS[state.profile] : ""
              }}{{ state.passkeyOnly ? " (passkey-only)" : "" }}
            </dd>
            <dt>Balance</dt>
            <dd data-testid="balance">{{ formatXrp(state.info.balanceDrops) }}</dd>
            <dt>Sequence</dt>
            <dd>{{ state.info.sequence }}</dd>
            <dt>Owner count</dt>
            <dd>{{ state.info.ownerCount }}</dd>
            <dt>Master key</dt>
            <dd data-testid="master">{{ masterLabel }}</dd>
            <dt>Regular key</dt>
            <dd class="mono">
              {{ state.info.regularKey ? shortAddress(state.info.regularKey) : "none" }}
            </dd>
            <dt>Passkeys</dt>
            <dd>{{ state.objects?.passkeys.length ?? 0 }}</dd>
            <dt>Sessions</dt>
            <dd>{{ state.objects?.sessions.length ?? 0 }}</dd>
          </dl>
        </section>

        <section class="panel" data-testid="setup-steps">
          <h2 class="panel-title mb-3">Setup steps</h2>
          <ol class="space-y-4">
            <li v-for="step in state.steps" :key="step.id" class="space-y-1">
              <p class="text-sm">
                <span
                  :class="
                    step.status === 'ok'
                      ? 'text-ok'
                      : step.status === 'failed'
                        ? 'text-danger'
                        : 'text-muted-foreground'
                  "
                >
                  {{ step.status === "ok" ? "✓" : step.status === "failed" ? "✕" : "…" }}
                </span>
                {{ step.label }}
                <SimBadge
                  v-if="step.simulatedDevice"
                  title="Signed on the simulated device; the node's answer below is real"
                />
              </p>
              <ResultView
                v-if="step.result"
                :result="step.result"
                :simulated="backend.mode === 'simulated'"
              />
            </li>
          </ol>
        </section>
      </div>
    </template>
  </section>
</template>
