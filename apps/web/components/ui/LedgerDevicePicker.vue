<script setup lang="ts">
import SimBadge from "~/components/ui/SimBadge.vue";
import { WEBHID_MESSAGE, hasWebHid } from "~/lib/browser-support";
import { useDeviceSelection } from "~/lib/context";

const selection = useDeviceSelection();
const webHid = hasWebHid();
</script>

<template>
  <fieldset class="space-y-2 text-sm" data-testid="device-picker">
    <legend class="eyebrow mb-1">Device</legend>
    <div class="flex flex-wrap items-center gap-4">
      <label class="flex items-center gap-2">
        <input
          type="radio"
          name="device-choice"
          :checked="selection.choice === 'simulated'"
          :disabled="selection.busy"
          data-testid="device-simulated"
          @change="selection.choose('simulated')"
        />
        Simulated <SimBadge title="A software double of the Stax, in this page" />
      </label>
      <label class="flex items-center gap-2">
        <input
          type="radio"
          name="device-choice"
          :checked="selection.choice === 'usb'"
          :disabled="selection.busy || !webHid"
          data-testid="device-usb"
          @change="selection.choose('usb')"
        />
        Ledger Stax (USB)
      </label>
      <template v-if="selection.choice === 'usb'">
        <button
          v-if="!selection.connected"
          type="button"
          class="btn"
          :disabled="selection.busy"
          data-testid="device-connect"
          @click="selection.connect()"
        >
          Connect the Ledger Stax
        </button>
        <template v-else>
          <span class="chip chip-ok" data-testid="device-connected">connected</span>
          <button
            type="button"
            class="btn"
            data-testid="device-disconnect"
            @click="selection.disconnect()"
          >
            Disconnect
          </button>
        </template>
      </template>
    </div>
    <p v-if="!webHid" class="text-warn" role="note">{{ WEBHID_MESSAGE }}</p>
    <p
      v-if="selection.choice === 'usb'"
      class="text-muted-foreground"
      data-testid="device-usb-note"
    >
      Open the XRP app on the Stax. Every review and confirmation happens on its screen, not in this
      page.
    </p>
    <p v-if="selection.error" class="text-danger" role="alert" data-testid="device-error">
      {{ selection.error }}
    </p>
  </fieldset>
</template>
