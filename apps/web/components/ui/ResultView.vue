<script setup lang="ts">
import { computed } from "vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend } from "~/lib/context";
import { describeResult } from "~/lib/result-codes";
import type { NodeResult } from "~/lib/ports";
import { shortHex } from "~/lib/format";

const props = defineProps<{
  result: NodeResult;
  simulated: boolean;
  /** Overrides the link: a real transaction on a given explorer (`null`: none). */
  explorerUrl?: string | null;
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
// A simulated hash exists on no explorer; a real one is linked on the selected network's.
const explorerLink = computed(() => {
  if (props.explorerUrl !== undefined) return props.explorerUrl;
  // The link of the node the transaction was sent to, not of the network selected in the header.
  return backend.mode === "live" && props.result.feeClaimed
    ? backend.node.explorerUrl(props.result.hash)
    : null;
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
      <a
        v-if="explorerLink"
        :href="explorerLink"
        target="_blank"
        rel="noreferrer"
        class="underline"
        data-testid="explorer-link"
        >{{ shortHex(result.hash) }}</a
      >
      <template v-else>{{ shortHex(result.hash) }}</template>
    </p>
  </div>
</template>
