<script setup lang="ts">
import { computed } from "vue";
import NodePicker from "~/components/ui/NodePicker.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend, useDemo } from "~/lib/context";
import type { ProbeResult } from "~/lib/node-probe";

defineProps<{
  reload?: () => void;
  probe?: (url: string) => Promise<ProbeResult>;
}>();

const backend = useBackend();
const demo = useDemo();
const ledger = computed(() => demo.state.server?.ledgerIndex ?? null);
</script>

<template>
  <div
    class="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2 text-xs text-muted-foreground"
    data-testid="header-status"
  >
    <span v-if="ledger !== null" class="mono">ledger {{ ledger }}</span>
    <!-- Only while the simulation is in effect: a live node's answers are real. -->
    <SimBadge
      v-if="backend.mode === 'simulated'"
      title="The node and the device are simulated: pick a live node under Node"
    />
    <span class="ml-auto">
      <NodePicker
        v-bind="{
          ...(reload === undefined ? {} : { reload }),
          ...(probe === undefined ? {} : { probe }),
        }"
      />
    </span>
  </div>
</template>
