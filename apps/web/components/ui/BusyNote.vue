<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ThoughtLine from "~/components/ui/ThoughtLine.vue";
import { useBackend, useDemo } from "~/lib/context";

/** How long the settled line ("Done in 3.2s") stays after the work ends. */
const SETTLED_VISIBLE_MS = 8000;

const props = defineProps<{ busy: boolean }>();
const backend = useBackend();
const demo = useDemo();

const label = computed(() =>
  backend.mode === "live" ? "Waiting for the node: a ledger closes every few seconds…" : "Working…",
);

// The steps taken since this run began: the setup transactions of an account, one by one.
const firstStep = ref(0);
const steps = computed(() => demo.state.steps.slice(firstStep.value).map((step) => step.label));
const shown = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.busy,
  (busy) => {
    clearTimeout(hideTimer);
    if (busy) {
      firstStep.value = demo.state.steps.length;
      shown.value = true;
    } else {
      hideTimer = setTimeout(() => {
        shown.value = false;
      }, SETTLED_VISIBLE_MS);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => clearTimeout(hideTimer));
</script>

<template>
  <div v-if="shown" :data-testid="busy ? 'busy' : 'busy-done'" role="status">
    <ThoughtLine
      :working="busy"
      :label="label"
      done-label="Done in"
      :steps="steps"
      color="var(--color-ink)"
      :font-size="14"
      glyph="sparkle"
      collapse-on-settle
    />
  </div>
</template>
