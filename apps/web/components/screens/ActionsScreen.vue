<script setup lang="ts">
import NeedAccount from "~/components/ui/NeedAccount.vue";
import ResultView from "~/components/ui/ResultView.vue";
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend, useDemo } from "~/lib/context";
import { ACTIONS } from "~/lib/scenarios";

const backend = useBackend();
const demo = useDemo();
const state = demo.state;
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Actions" title="Six actions, no prompt">
      Each one is signed by the session key. The answer is the node's result code.
    </ScreenHeader>

    <NeedAccount v-if="!state.address" />
    <template v-else>
      <p v-if="!state.sessionKey" class="mb-4 text-muted-foreground" data-testid="no-session">
        No session is open.
        <NuxtLink to="/session" class="underline">Open one</NuxtLink>
        to enable the actions.
      </p>
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="action in ACTIONS"
          :key="action.id"
          class="panel flex flex-col gap-3"
          :data-testid="`action-${action.id}`"
        >
          <div>
            <p class="eyebrow">{{ action.type }}</p>
            <h2 class="panel-title">{{ action.title }}</h2>
          </div>
          <p class="flex-1 text-sm text-muted-foreground">{{ action.blurb }}</p>
          <button
            class="btn btn-primary"
            :disabled="state.busy || !state.sessionKey"
            :data-testid="`run-${action.id}`"
            @click="demo.runAction(action.id)"
          >
            Run
          </button>
        </article>
      </div>
      <p v-if="state.error" class="mt-4 text-danger" role="alert" data-testid="error">
        {{ state.error }}
      </p>

      <section class="mt-8">
        <div class="mb-3 flex items-center gap-3">
          <h2 class="panel-title">Log</h2>
          <SimBadge v-if="backend.mode === 'simulated'" />
        </div>
        <p v-if="state.actionLog.length === 0" class="text-muted-foreground">Nothing run yet.</p>
        <ul class="space-y-3" data-testid="action-log">
          <li v-for="entry in state.actionLog" :key="entry.id" class="panel">
            <p class="mb-2 text-sm">
              <strong>{{ entry.label }}</strong>
              <span class="text-muted-foreground"
                >· {{ entry.txType }} · signed by the {{ entry.signer }}</span
              >
            </p>
            <ResultView :result="entry.result" :simulated="backend.mode === 'simulated'" />
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
