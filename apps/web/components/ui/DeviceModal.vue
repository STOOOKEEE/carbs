<script setup lang="ts">
import SimBadge from "~/components/ui/SimBadge.vue";
import { useDevicePrompt } from "~/lib/context";

const prompt = useDevicePrompt();
</script>

<template>
  <div
    v-if="prompt.review"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Simulated Ledger Stax"
    data-testid="device-modal"
  >
    <div
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
