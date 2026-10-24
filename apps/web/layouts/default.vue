<script setup lang="ts">
import { computed } from "vue";
import { useBackend, useDemo } from "~/lib/context";

const backend = useBackend();
const demo = useDemo();

const SCREENS = [
  { to: "/account", label: "Account" },
  { to: "/session", label: "Session" },
  { to: "/actions", label: "Actions" },
  { to: "/attack", label: "Attack" },
  { to: "/quantum", label: "Quantum" },
] as const;

const ledger = computed(() => demo.state.server?.ledgerIndex ?? null);
</script>

<template>
  <div class="flex min-h-screen flex-col bg-background">
    <header class="border-b">
      <div
        class="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
      >
        <NuxtLink to="/" class="font-display text-xl font-semibold tracking-tight">carbs</NuxtLink>
        <nav aria-label="Screens" class="flex flex-wrap gap-1">
          <NuxtLink
            v-for="screen in SCREENS"
            :key="screen.to"
            :to="screen.to"
            class="rounded-md px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
            active-class="bg-muted text-foreground"
          >
            {{ screen.label }}
          </NuxtLink>
        </nav>
        <div class="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span v-if="ledger !== null" class="mono">ledger {{ ledger }}</span>
          <SimBadge v-if="backend.mode === 'simulated'" />
        </div>
      </div>
    </header>
    <main class="mx-auto w-full max-w-content flex-1 px-5 py-8">
      <slot />
    </main>
    <footer class="border-t">
      <div
        class="mx-auto flex w-full max-w-content flex-wrap justify-between gap-3 px-5 py-4 text-xs text-muted-foreground"
      >
        <span>
          Modes A and P bound when a session key can sign, not what the signed transactions leave
          behind. Only mode C bounds the XRP that leaves the account.
        </span>
        <NuxtLink to="/payment" class="underline">Template payment form</NuxtLink>
      </div>
    </footer>
    <DeviceModal />
  </div>
</template>
