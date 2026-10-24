<script setup lang="ts">
import { computed } from "vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { describeResult } from "~/lib/result-codes";
import type { NodeResult } from "~/lib/ports";
import { shortHex } from "~/lib/format";

const props = defineProps<{
  result: NodeResult;
  simulated: boolean;
  explorerUrl?: string | null;
}>();

const description = computed(() => describeResult(props.result.code));
const tone = computed(() =>
  props.result.family === "tes"
    ? "chip-ok"
    : props.result.family === "tec"
      ? "chip-warn"
      : "chip-danger",
);
</script>

<template>
  <div class="fade-in space-y-1 text-sm" data-testid="result">
    <div class="flex flex-wrap items-center gap-2">
      <span class="chip" :class="tone" data-testid="result-code">{{ result.code }}</span>
      <span class="text-muted-foreground">
        {{ result.feeClaimed ? "fee charged" : "no fee charged" }}
      </span>
      <SimBadge v-if="simulated" />
    </div>
    <p>{{ description.sentence }}</p>
    <p v-if="description.rule" class="text-muted-foreground">{{ description.rule }}</p>
    <p class="mono text-muted-foreground">
      <template v-if="explorerUrl">
        <a :href="explorerUrl" target="_blank" rel="noreferrer" class="underline">{{
          shortHex(result.hash)
        }}</a>
      </template>
      <template v-else>{{ shortHex(result.hash) }}</template>
    </p>
  </div>
</template>
