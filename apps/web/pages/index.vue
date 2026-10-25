<script setup lang="ts">
import SimBadge from "~/components/ui/SimBadge.vue";
import { useBackend } from "~/lib/context";

const backend = useBackend();

const SCREENS = [
  {
    to: "/account",
    title: "Account",
    body: "A Mac account with a passkey, or a Ledger account with a post-quantum root.",
  },
  {
    to: "/session",
    title: "Session",
    body: "Open a short-lived key in mode A, P or C, watch it count down and spend.",
  },
  {
    to: "/actions",
    title: "Actions",
    body: "Six transaction types signed by the session key with no prompt.",
  },
  {
    to: "/attack",
    title: "Attack",
    body: "Replay what a stolen key could try. The refusals are the node's own codes.",
  },
  {
    to: "/apps",
    title: "Apps",
    body: "Six live apps on the team's node, each opening one session with its own limits.",
  },
  {
    to: "/quantum",
    title: "Quantum",
    body: "Is an account's public key already on the ledger? Then migrate with the Ledger.",
  },
] as const;
</script>

<template>
  <section>
    <p class="eyebrow mb-2">carbs</p>
    <h1 class="text-3xl md:text-4xl">Quantum-safe and delegable, enforced by the ledger</h1>
    <p class="mt-4 max-w-2xl text-lg text-muted-foreground">
      A post-quantum root key on a Ledger device, and signing sessions that the ledger itself
      confines in time, in transaction types and in XRP spent.
    </p>
    <p
      v-if="backend.mode === 'simulated'"
      class="panel sim-frame mt-6 max-w-2xl text-sm"
      data-testid="sim-note"
    >
      <SimBadge /> Every node answer and every device screen in this app is simulated until the real
      ones are wired in. The badge stays visible wherever a result comes from the simulation.
    </p>
    <div class="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="screen in SCREENS"
        :key="screen.to"
        :to="screen.to"
        class="panel block transition-transform duration-base hover:-translate-y-0.5"
      >
        <h2 class="panel-title">{{ screen.title }}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{{ screen.body }}</p>
      </NuxtLink>
    </div>
  </section>
</template>
