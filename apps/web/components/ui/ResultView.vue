<script setup lang="ts">
import { computed } from "vue";
import ExplorerLink from "~/components/ui/ExplorerLink.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend } from "~/lib/context";
import { describeResult } from "~/lib/result-codes";
import type { AppNetwork } from "~/lib/networks";
import type { NodeResult } from "~/lib/ports";
import { shortHex } from "~/lib/format";

const props = defineProps<{
  result: NodeResult;
  simulated: boolean;
  /** The network the transaction was sent to, when it is not the backend's node (`null`: none). */
  network?: AppNetwork | null;
}>();

const backend = useBackend();

const description = computed(() => describeResult(props.result.code));
const tone = computed(() =>
  props.result.family === "tes"
    ? "chip-ok"
    : props.result.family === "tec"
      ? "chip-warn"
      : "chip-danger",
);
// A simulated hash exists on no explorer, nor does a transaction no validated ledger holds (a
// refusal, or an answer that never validated). A real one is linked on the explorer of the node
// it was sent to, not of the network selected in the header.
const network = computed(() => {
  if (props.simulated || !props.result.feeClaimed) return null;
  if (props.network !== undefined) return props.network;
  return backend.mode === "live" ? backend.node.explorerNetwork() : null;
});
</script>

<template>
  <div class="fade-in space-y-1 text-sm" data-testid="result">
    <div class="flex flex-wrap items-center gap-2">
      <span class="chip" :class="tone" data-testid="result-code">{{ result.code }}</span>
      <span class="text-muted-foreground">
        {{ result.feeClaimed ? "fee charged" : "no fee charged" }}
      </span>
      <span v-if="!result.final" class="chip chip-warn" data-testid="not-final">
        not validated: this is a preliminary answer
      </span>
      <SimBadge v-if="simulated" />
    </div>
    <p>{{ description.sentence }}</p>
    <p v-if="description.rule" class="text-muted-foreground">{{ description.rule }}</p>
    <p class="mono text-muted-foreground">
      <ExplorerLink
        kind="tx"
        :value="result.hash"
        :network="network"
        :simulated="simulated"
        :text="shortHex(result.hash)"
      />
    </p>
  </div>
</template>
