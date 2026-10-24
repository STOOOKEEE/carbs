<script setup lang="ts">
defineProps<{ eyebrow: string; title: string }>();
</script>

<template>
  <header class="mb-6 max-w-2xl">
    <p class="eyebrow mb-2">{{ eyebrow }}</p>
    <h1 class="text-3xl">{{ title }}</h1>
    <p class="mt-3 text-lg text-muted-foreground"><slot /></p>
  </header>
</template>
