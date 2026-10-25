<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDevicePrompt } from "~/lib/context";
import { useLedgerMode } from "~/lib/ledger-mode";

const prompt = useDevicePrompt();
const route = useRoute();
const router = useRouter();
const ledgerMode = useLedgerMode();

const SCREENS = [
  { value: "account", label: "Account" },
  { value: "session", label: "Session" },
  { value: "actions", label: "Actions" },
  { value: "attack", label: "Attack" },
  { value: "apps", label: "Apps" },
  { value: "quantum", label: "Quantum" },
] as const;

// "" on the landing page: no screen is selected and the thumb stays hidden.
const screen = computed(
  () => SCREENS.find((entry) => route.path === `/${entry.value}`)?.value ?? "",
);
function go(value: string): void {
  void router.push(`/${value}`);
}

// The theme is a colour switch on <html> (assets/tokens.css); nothing else changes with it.
useHead({ htmlAttrs: { "data-theme": computed(() => (ledgerMode.value ? "ledger" : "commons")) } });
</script>

<template>
  <div class="relative flex min-h-screen flex-col bg-background">
    <!-- Ledger mode only: violet silk behind the whole app. -->
    <Transition name="backdrop">
      <div
        v-if="ledgerMode"
        class="ledger-backdrop"
        aria-hidden="true"
        data-testid="ledger-backdrop"
      >
        <Silk
          color="#6a4cf0"
          sheen-color="#bbb0ff"
          :speed="3"
          :scale="1.1"
          :sheen="0.55"
          :depth="0.55"
          :glow="0.35"
          :noise-intensity="1.2"
        />
      </div>
    </Transition>
    <!-- While the (simulated) device asks, nothing behind it can be reached. -->
    <div class="relative z-10 flex flex-1 flex-col" :inert="prompt.review !== null">
      <header class="top-bar">
        <div
          class="mx-auto flex w-full max-w-content flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4"
        >
          <NuxtLink
            to="/"
            class="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight"
          >
            carbs
          </NuxtLink>
          <nav aria-label="Screens" class="order-last w-full sm:order-none sm:w-auto">
            <RubberSegment
              :items="SCREENS"
              :model-value="screen"
              aria-label="Screens"
              size="md"
              @change="go"
            />
          </nav>
          <div class="ml-auto"><WalletConnector /></div>
        </div>
        <div class="status-strip"><HeaderStatus /></div>
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
        </div>
      </footer>
    </div>
    <DeviceModal />
  </div>
</template>

<style>
.top-bar {
  /* Above the page, so that the dialogs opened from the bar cover it. */
  position: relative;
  z-index: 20;
  border-bottom: var(--border-width) solid var(--color-line-strong);
  transition: border-color var(--motion-slow) var(--ease-out);
}

/* The blur sits on a layer behind the bar, not on the bar: a backdrop filter on the bar would
   make the fixed dialogs it holds (wallet, node) as small as the bar. */
.top-bar::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--color-surface);
  -webkit-backdrop-filter: blur(var(--panel-blur));
  backdrop-filter: blur(var(--panel-blur));
  transition: background-color var(--motion-slow) var(--ease-out);
}

:root[data-theme="ledger"] .top-bar {
  border-bottom-color: var(--color-line);
}

:root[data-theme="ledger"] .top-bar::before {
  background: rgb(10 7 20 / 55%);
}

/* Below Tailwind's sm breakpoint the screens take the whole width: six fit a phone in small type. */
@media (max-width: 639px) {
  .top-bar .rubber-segment__item {
    font-size: var(--text-xs);
  }
}

.ledger-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

/* A veil keeps text readable over the folds. */
.ledger-backdrop::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(10 7 20 / 18%), rgb(10 7 20 / 48%));
}

.status-strip {
  border-top: var(--border-width-fine) solid var(--color-line);
}

.backdrop-enter-active,
.backdrop-leave-active {
  transition: opacity var(--motion-slow) var(--ease-out);
}

.backdrop-enter-from,
.backdrop-leave-to {
  opacity: 0;
}
</style>
