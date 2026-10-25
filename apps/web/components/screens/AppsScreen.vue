<script setup lang="ts">
import ScreenHeader from "~/components/ui/ScreenHeader.vue";
import { LIVE_APPS, appPageUrl, modeText, staxRows, type LiveAppRefusal } from "~/lib/live-apps";

defineProps<{
  /** The team's wallet server (`NUXT_PUBLIC_APPS_URL`); null when that value cannot be used. */
  appsUrl: string | null;
}>();

const BY: Record<LiveAppRefusal["layer"], string> = {
  device: "by the Stax, before it signs",
  ledger: "by the ledger",
};
</script>

<template>
  <section>
    <ScreenHeader eyebrow="Apps" title="Six live apps, one session each">
      Pages of the team's wallet server. Each opens one signing session on the carbs node, with the
      limits below; beyond them the Stax refuses to sign, or the ledger refuses with its own code.
    </ScreenHeader>

    <div class="panel mb-6 max-w-3xl space-y-2 text-sm" data-testid="apps-note">
      <p v-if="appsUrl">
        They run on the team's own node and wallet server, at
        <span class="mono">{{ appsUrl }}</span
        >, not on this site's simulation, and open only where that host is reachable: by default it
        is on the team's private Tailscale network. This page does not check that it is up.
      </p>
      <p v-else class="text-warn" role="note" data-testid="apps-url-unusable">
        The apps' address of this build (NUXT_PUBLIC_APPS_URL) is not a plain http(s) URL, so no
        link is shown.
      </p>
      <p class="text-muted-foreground">
        Each app asks its owner to sign the opening once: on a Ledger Stax over WebHID (Chrome or
        Edge), or with the passkey account made on the wallet page in the same browser. The Stax
        refuses only while its session policy is on, in its settings. The Stax rows are those the
        carbs XRP app writes for these openings (its test vectors), not a photo of a device.
      </p>
    </div>

    <div class="grid gap-5 md:grid-cols-2">
      <article
        v-for="app in LIVE_APPS"
        :key="app.id"
        class="panel flex flex-col gap-4"
        :data-testid="`app-${app.id}`"
      >
        <div>
          <p class="eyebrow">{{ app.page }}</p>
          <h2 class="panel-title">{{ app.name }}</h2>
          <p class="mt-2 text-sm text-muted-foreground">{{ app.summary }}</p>
        </div>

        <div>
          <h3 class="eyebrow mb-2">Session it opens</h3>
          <p class="mb-3 text-sm" data-testid="mode">{{ modeText(app) }}</p>
          <dl
            class="device-rows"
            :aria-label="`What the Stax review lists for ${app.name}`"
            data-testid="stax-rows"
          >
            <div v-for="row in staxRows(app)" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd>{{ row.value }}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 class="eyebrow mb-2">Refused</h3>
          <ul class="space-y-2 text-sm" data-testid="refusals">
            <li
              v-for="refusal in app.refusals"
              :key="refusal.attempt"
              class="flex flex-wrap items-baseline gap-x-2 gap-y-1"
            >
              <span
                class="chip shrink-0"
                :class="refusal.layer === 'device' ? 'chip-device' : 'chip-danger'"
                data-testid="refusal-code"
                >{{ refusal.code }}</span
              >
              <span class="min-w-[12rem] flex-1">
                {{ refusal.attempt }}
                <span class="text-xs text-muted-foreground">· {{ BY[refusal.layer] }}</span>
              </span>
            </li>
          </ul>
        </div>

        <p v-if="app.note" class="text-xs text-muted-foreground" data-testid="app-note">
          {{ app.note }}
        </p>
        <p class="font-mono text-xs text-muted-foreground">
          Read from {{ app.source }} in apps/passkey-wallet
        </p>

        <a
          v-if="appsUrl"
          class="btn btn-primary mt-auto self-start"
          :href="appPageUrl(appsUrl, app)"
          target="_blank"
          rel="noopener noreferrer"
          :data-testid="`open-${app.id}`"
        >
          Open {{ app.page }}
        </a>
      </article>
    </div>
  </section>
</template>
