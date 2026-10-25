<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import ExplorerLink from "~/components/ui/ExplorerLink.vue";
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend, useWallets } from "~/lib/context";
import { shortAddress } from "~/lib/format";
import { PART_LABELS, type SimulatedPart, type WalletId } from "~/lib/wallets/catalog";

const wallets = useWallets();
const backend = useBackend();
const state = wallets.state;
const open = ref(false);
const dialog = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);

// Focus moves into the dialog when it opens (so Esc works) and back to the button when it closes.
watch(open, async (isOpen) => {
  // After the DOM update: the dialog exists (or no longer does) when the focus moves.
  await nextTick();
  if (isOpen) dialog.value?.focus();
  else trigger.value?.focus();
});

onMounted(() => {
  void wallets.refresh();
});

function partsText(parts: readonly SimulatedPart[]): string {
  return parts.map((part) => PART_LABELS[part]).join(", ");
}

async function connect(id: WalletId): Promise<void> {
  if (await wallets.connect(id)) open.value = false;
}
</script>

<template>
  <div class="relative" data-testid="wallet-connector">
    <template v-if="state.address">
      <div class="flex items-center gap-2 text-xs">
        <span class="mono" data-testid="connected-address">
          <ExplorerLink
            kind="account"
            :value="state.address"
            :network="backend.node.explorerNetwork()"
            :simulated="backend.mode === 'simulated'"
            :text="shortAddress(state.address)"
          />
        </span>
        <button class="btn !min-h-8" data-testid="wallet-disconnect" @click="wallets.disconnect()">
          Disconnect
        </button>
      </div>
    </template>
    <button
      v-else
      ref="trigger"
      class="btn btn-primary !min-h-8"
      data-testid="wallet-open"
      @click="open = true"
    >
      Connect wallet
    </button>

    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      data-testid="wallet-modal"
      ref="dialog"
      tabindex="-1"
      @keydown.esc="open = false"
      @click.self="open = false"
    >
      <div class="panel mt-12 w-full max-w-xl space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="panel-title">Connect a wallet</h2>
          <button
            class="btn !min-h-8"
            aria-label="Close"
            data-testid="wallet-close"
            @click="open = false"
          >
            Close
          </button>
        </div>
        <ul class="space-y-4">
          <li
            v-for="entry in state.entries"
            :key="entry.description.id"
            class="space-y-2 rounded-md border p-4"
            :data-testid="`wallet-${entry.description.id}`"
          >
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="text-lg">{{ entry.description.name }}</h3>
              <template v-if="entry.simulated.length">
                <SimBadge />
                <span class="text-xs text-muted-foreground" data-testid="simulated-parts">
                  {{ partsText(entry.simulated) }}
                </span>
              </template>
            </div>
            <p class="text-sm">{{ entry.description.summary }}</p>
            <dl class="kv">
              <dt>Key type</dt>
              <dd data-testid="key-type">{{ entry.description.keyType }}</dd>
              <dt>Who signs what</dt>
              <dd>
                <ul class="list-inside list-disc" data-testid="signs">
                  <li v-for="line in entry.description.signs" :key="line">{{ line }}</li>
                </ul>
              </dd>
            </dl>
            <p
              v-if="!entry.available"
              class="text-sm text-warn"
              role="note"
              data-testid="unavailable"
            >
              {{ entry.unavailableReason }}
            </p>
            <button
              class="btn btn-primary"
              :disabled="!entry.available || state.connecting !== null"
              :data-testid="`connect-${entry.description.id}`"
              @click="connect(entry.description.id)"
            >
              {{ state.connecting === entry.description.id ? "Connecting…" : "Connect" }}
            </button>
          </li>
        </ul>
        <p v-if="state.error" class="text-danger" role="alert" data-testid="wallet-error">
          {{ state.error }}
        </p>
      </div>
    </div>
  </div>
</template>
