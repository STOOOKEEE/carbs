<script setup lang="ts">
import NeedAccount from "~/components/ui/NeedAccount.vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend, useDemo } from "~/lib/context";
import { ATTACKS, type Attack } from "~/lib/scenarios";

const backend = useBackend();
const demo = useDemo();
const state = demo.state;

function blocked(attack: Attack): string | null {
  if (!state.sessionKey) return "Open a session first.";
  if (attack.needsMode !== null && state.session?.mode !== attack.needsMode) {
    return `Needs a mode ${attack.needsMode} session.`;
  }
  if (attack.needsExpiry && backend.clock === null) {
    const session = state.session;
    const server = state.server;
    if (session !== null && server !== null && server.closeTime < session.expiration) {
      return `Wait for the session to expire (${session.expiration - server.closeTime} s left).`;
    }
  }
  return null;
}
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Attack" title="Steal the key, try everything">
      Each button replays what a stolen session key could try. The refusal is the node's code, never
      a message written here.
    </ScreenHeader>

    <NeedAccount v-if="!state.address" />
    <template v-else>
      <p v-if="!state.sessionKey" class="mb-4 text-muted-foreground" data-testid="no-session">
        No session is open.
        <NuxtLink to="/session" class="underline">Open one</NuxtLink>
        first.
      </p>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="attack in ATTACKS"
          :key="attack.id"
          class="panel flex flex-col gap-3"
          :data-testid="`attack-${attack.id}`"
        >
          <div>
            <p class="eyebrow">{{ attack.type }}</p>
            <h2 class="panel-title">{{ attack.title }}</h2>
          </div>
          <p class="flex-1 text-sm text-muted-foreground">{{ attack.story }}</p>
          <p v-if="blocked(attack)" class="text-xs text-muted-foreground">{{ blocked(attack) }}</p>
          <button
            class="btn btn-danger"
            :disabled="state.busy || blocked(attack) !== null"
            :data-testid="`run-${attack.id}`"
            @click="demo.runAttack(attack.id)"
          >
            Try it
          </button>
        </article>
      </div>
      <p v-if="state.error" class="mt-4 text-danger" role="alert" data-testid="error">
        {{ state.error }}
      </p>

      <section class="mt-8">
        <div class="mb-3 flex items-center gap-3">
          <h2 class="panel-title">Answers</h2>
          <SimBadge v-if="backend.mode === 'simulated'" />
        </div>
        <p v-if="state.attackLog.length === 0" class="text-muted-foreground">No attempt yet.</p>
        <ul class="space-y-3" data-testid="attack-log">
          <li v-for="entry in state.attackLog" :key="entry.id" class="panel">
            <p class="mb-2 text-sm">
              <strong>{{ entry.label }}</strong>
              <span class="text-muted-foreground">· {{ entry.txType }}</span>
            </p>
            <ResultView :result="entry.result" :simulated="backend.mode === 'simulated'" />
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
