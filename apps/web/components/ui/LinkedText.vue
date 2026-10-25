<script setup lang="ts">
/** A sentence whose real addresses and transaction hashes link to the network's explorer. */
import { computed } from "vue";
import ExplorerLink from "~/components/ui/ExplorerLink.vue";
import { explorerSegments } from "~/lib/explorer";
import type { AppNetwork } from "~/lib/networks";

const props = withDefaults(
  defineProps<{
    text: string;
    /** The network the sentence speaks of; null when it has no public explorer. */
    network: AppNetwork | null;
    simulated?: boolean;
  }>(),
  { simulated: false },
);

const segments = computed(() => explorerSegments(props.text));
</script>

<template>
  <span
    ><template v-for="(segment, index) in segments" :key="index"
      ><ExplorerLink
        v-if="segment.kind"
        :kind="segment.kind"
        :value="segment.text"
        :network="network"
        :simulated="simulated"
      /><template v-else>{{ segment.text }}</template></template
    ></span
  >
</template>
