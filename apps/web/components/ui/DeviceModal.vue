<script setup lang="ts">
import SimBadge from "~/components/ui/SimBadge.vue";
import { nextTick, ref, watch } from "vue";
import { useDevicePrompt } from "~/lib/context";

const prompt = useDevicePrompt();
const dialog = ref<HTMLElement | null>(null);
let opener: Element | null = null;

// The review takes the focus when it opens and gives it back when it closes.
watch(
  () => prompt.review,
  async (review) => {
    if (review !== null) {
      opener = document.activeElement;
      await nextTick();
      dialog.value?.querySelector<HTMLElement>("[data-testid='device-approve']")?.focus();
    } else if (opener instanceof HTMLElement) {
      opener.focus();
      opener = null;
    }
  },
);

/** Esc rejects; Tab stays inside the two buttons. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    prompt.answer(false);
    return;
  }
  if (event.key !== "Tab") return;
  const buttons = [...(dialog.value?.querySelectorAll<HTMLElement>("button") ?? [])];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div
    v-if="prompt.review"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Simulated Ledger Stax"
    data-testid="device-modal"
    @keydown="onKeydown"
  >
    <div
      ref="dialog"
      class="sim-frame w-full max-w-sm space-y-4 p-5"
      style="
        background: var(--color-device);
        color: var(--color-device-ink);
        border-radius: var(--radius-lg);
      "
    >
      <div class="flex items-center justify-between">
        <span class="eyebrow" style="color: var(--color-device-ink)">Ledger Stax</span>
        <SimBadge title="This screen is a simulation of the device, not the device" />
      </div>
      <h2 class="text-xl">{{ prompt.review.title }}</h2>
      <dl class="space-y-2 text-sm" data-testid="device-lines">
        <div v-for="(line, index) in prompt.review.lines" :key="index">
          <dt class="eyebrow" style="color: var(--color-device-ink); opacity: 0.6">
            {{ line.label }}
          </dt>
          <dd class="mono" style="font-size: var(--text-sm)">{{ line.value }}</dd>
        </div>
      </dl>
      <div class="flex gap-3">
        <button
          class="btn btn-primary flex-1"
          data-testid="device-approve"
          @click="prompt.answer(true)"
        >
          Approve
        </button>
        <button class="btn flex-1" data-testid="device-reject" @click="prompt.answer(false)">
          Reject
        </button>
      </div>
    </div>
  </div>
</template>
