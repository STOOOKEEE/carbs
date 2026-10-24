<script setup lang="ts">
import { computed } from "vue";
import { useBackend } from "~/lib/context";

defineProps<{ busy: boolean }>();
const backend = useBackend();
const text = computed(() =>
  backend.mode === "live" ? "Waiting for the node: a ledger closes every few seconds…" : "Working…",
);
</script>

<template>
  <p v-if="busy" class="text-sm text-muted-foreground" role="status" data-testid="busy">
    {{ text }}
  </p>
</template>
