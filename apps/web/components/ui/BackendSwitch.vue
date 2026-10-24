<script setup lang="ts">
import { BACKEND_STORAGE_KEY, saveBackendChoice, type BackendChoice } from "~/lib/backend-choice";
import { useBackendStatus } from "~/lib/context";

const props = defineProps<{ reload?: () => void }>();
const status = useBackendStatus();

function choose(event: Event): void {
  const choice = (event.target as HTMLSelectElement).value as BackendChoice;
  saveBackendChoice(globalThis.localStorage ?? null, choice);
  (props.reload ?? (() => globalThis.location.reload()))();
}
</script>

<template>
  <div class="flex flex-col items-end gap-1 text-xs" data-testid="backend-switch">
    <label class="flex items-center gap-2">
      <span class="text-muted-foreground">Backend</span>
      <select
        class="input !min-h-8 !w-auto"
        :value="status.requested"
        aria-label="Backend"
        :data-storage-key="BACKEND_STORAGE_KEY"
        data-testid="backend-select"
        @change="choose"
      >
        <option value="simulated">Simulated</option>
        <option value="live">Live (local node)</option>
      </select>
    </label>
    <p
      v-if="status.active === 'live'"
      class="mono text-muted-foreground"
      data-testid="backend-live"
    >
      live · {{ status.target }}
    </p>
    <p
      v-else-if="status.requested === 'live'"
      class="max-w-xs text-right text-warn"
      role="alert"
      data-testid="backend-error"
    >
      Staying on the simulation: {{ status.error }}
    </p>
  </div>
</template>
