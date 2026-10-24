<script setup lang="ts">
import { computed, ref } from "vue";
import { useNetwork } from "~/lib/context";
import { SELECTABLE_NETWORK_IDS, type NetworkId } from "~/lib/networks";

const network = useNetwork();
const state = network.state;

const draft = ref(state.localWss);
const error = ref<string | null>(network.check().reason);
const options = computed(() => SELECTABLE_NETWORK_IDS.map((id) => network.networks()[id]));
const selected = computed(() => network.selected());

function choose(event: Event): void {
  network.select((event.target as HTMLSelectElement).value as NetworkId);
}

function saveLocal(): void {
  error.value = network.setLocalWss(draft.value.trim()).reason;
}
</script>

<template>
  <div class="flex flex-col items-end gap-1 text-xs" data-testid="network-selector">
    <label class="flex items-center gap-2">
      <span class="text-muted-foreground">Network</span>
      <select
        class="input !min-h-8 !w-auto"
        :value="state.selectedId"
        aria-label="Network"
        data-testid="network-select"
        @change="choose"
      >
        <option v-for="option in options" :key="option.id" :value="option.id">
          {{ option.name }}
        </option>
      </select>
    </label>
    <form
      v-if="state.selectedId === 'local'"
      class="flex flex-col items-end gap-1"
      data-testid="local-node-form"
      @submit.prevent="saveLocal"
    >
      <div class="flex items-center gap-2">
        <input
          v-model="draft"
          class="input mono !min-h-8"
          aria-label="Local node WebSocket URL"
          data-testid="local-url"
          autocomplete="off"
        />
        <button class="btn !min-h-8" type="submit">Use</button>
      </div>
      <p class="max-w-xs text-right text-muted-foreground">
        Over https the browser only allows wss:// and https:// nodes.
      </p>
      <p v-if="error" class="max-w-xs text-right text-danger" role="alert" data-testid="url-error">
        {{ error }}
      </p>
    </form>
    <p v-else class="mono text-muted-foreground" data-testid="network-wss">{{ selected.wss }}</p>
  </div>
</template>
