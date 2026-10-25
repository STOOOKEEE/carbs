<script setup lang="ts">
/**
 * An account address or a transaction hash, linked to the public explorer of the network it lives
 * on when there is one (`lib/explorer.ts`), in a new tab; plain text otherwise: a SIMULATED value,
 * a value on the local node, or anything that is not a real address or hash. The parent keeps the
 * font (`.mono`) and passes the shortened form, as before.
 */
import { computed } from "vue";
import { explorerLink, type ExplorerKind } from "~/lib/explorer";
import type { AppNetwork } from "~/lib/networks";

const props = withDefaults(
  defineProps<{
    kind: ExplorerKind;
    value: string;
    /** The network the value lives on; null when it lives on none with a public explorer. */
    network: AppNetwork | null;
    /** A simulated value is on no explorer: it stays plain text. */
    simulated?: boolean;
    /** What is shown, when not the value itself (a shortened form). */
    text?: string;
  }>(),
  { simulated: false, text: undefined },
);

const href = computed(() =>
  props.simulated ? null : explorerLink(props.network, props.kind, props.value),
);
const title = computed(() => {
  const what = props.kind === "tx" ? "Transaction" : "Account";
  return `${what} ${props.value} on the ${props.network?.name ?? ""} explorer, in a new tab`;
});
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    class="explorer-link"
    :title="title"
    :data-testid="kind === 'tx' ? 'explorer-link' : 'account-link'"
    >{{ text ?? value }}</a
  >
  <span v-else>{{ text ?? value }}</span>
</template>
