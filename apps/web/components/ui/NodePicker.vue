<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import NodeDialog from "~/components/ui/NodeDialog.vue";
import { useBackendStatus, useNetwork } from "~/lib/context";
import {
  NODE_CHOICES,
  isLiveChoice,
  isNodeChoice,
  saveNodeChoice,
  type LiveNodeChoice,
} from "~/lib/node-choice";
import type { ProbeResult } from "~/lib/node-probe";

const props = withDefaults(
  defineProps<{
    reload?: () => void;
    probe?: (url: string) => Promise<ProbeResult>;
    /** How long "Connected" stays on screen before the page reloads on the node. */
    reloadDelayMs?: number;
    /** How long the reason of a refused node stays in the header. */
    noticeMs?: number;
  }>(),
  {
    reload: () => globalThis.location.reload(),
    probe: undefined,
    reloadDelayMs: 900,
    noticeMs: 12000,
  },
);

const status = useBackendStatus();
const network = useNetwork();
const select = ref<HTMLSelectElement | null>(null);
const dialog = ref<LiveNodeChoice | null>(null);

const label = (id: string): string => NODE_CHOICES.find((c) => c.id === id)?.label ?? id;

// The reason a chosen node was refused, shown once, for a while.
const notice = ref<string | null>(
  status.error !== null && status.active !== status.requested
    ? `${label(status.requested)} not reached, running on the simulation: ${status.error}`
    : null,
);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  if (notice.value !== null) noticeTimer = setTimeout(() => (notice.value = null), props.noticeMs);
});
onBeforeUnmount(() => clearTimeout(noticeTimer));

const activeUrl = computed(() =>
  isLiveChoice(status.active) ? network.nodeNetwork(status.active).wss : null,
);

function choose(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  const value = target.value;
  // The select shows the node in effect until the new one is reached.
  target.value = status.active;
  if (!isNodeChoice(value) || value === status.active) return;
  if (isLiveChoice(value)) {
    dialog.value = value;
    return;
  }
  saveNodeChoice(globalThis.localStorage ?? null, value);
  props.reload();
}

function connected(url: string): void {
  const choice = dialog.value;
  if (choice === null) return;
  if (choice === "local") network.setLocalWss(url);
  saveNodeChoice(globalThis.localStorage ?? null, choice);
  setTimeout(() => props.reload(), props.reloadDelayMs);
}

async function closeDialog(): Promise<void> {
  dialog.value = null;
  await nextTick();
  select.value?.focus();
}
</script>

<template>
  <div class="flex flex-col items-end gap-1 text-xs" data-testid="node-picker">
    <div class="flex flex-wrap items-center justify-end gap-2">
      <label class="flex items-center gap-2">
        <span class="text-muted-foreground">Node</span>
        <select
          ref="select"
          class="input !min-h-8 !w-auto"
          :value="status.active"
          aria-label="Node"
          data-testid="node-select"
          @change="choose"
        >
          <option v-for="option in NODE_CHOICES" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>
      <button
        v-if="isLiveChoice(status.active) && activeUrl"
        type="button"
        class="mono text-muted-foreground underline-offset-2 hover:underline"
        title="Node settings"
        data-testid="node-target"
        @click="dialog = isLiveChoice(status.active) ? status.active : null"
      >
        {{ activeUrl }}
      </button>
    </div>
    <p v-if="notice" class="max-w-sm text-right text-warn" role="alert" data-testid="node-notice">
      {{ notice }}
    </p>
    <NodeDialog
      v-if="dialog"
      :choice="dialog"
      v-bind="probe === undefined ? {} : { probe }"
      @close="closeDialog"
      @connected="connected"
    />
  </div>
</template>
