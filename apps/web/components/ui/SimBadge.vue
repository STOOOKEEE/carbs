<script setup lang="ts">
withDefaults(defineProps<{ title?: string }>(), {
  title: "This result comes from the simulation, not from a real node or device",
});
</script>

<template>
  <span class="sim-badge" data-testid="sim-badge" role="note" :title="title">SIMULATED</span>
</template>
