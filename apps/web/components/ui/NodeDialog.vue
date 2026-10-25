<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useNetwork } from "~/lib/context";
import { checkNodeUrl, isLoopbackHost } from "~/lib/networks";
import type { LiveNodeChoice } from "~/lib/node-choice";
import { probeNode, type ProbeResult } from "~/lib/node-probe";
import { BUILDING_DOC_URL, demoCommand } from "~/lib/node-setup";

const props = withDefaults(
  defineProps<{
    choice: LiveNodeChoice;
    /** Asks the node; a test passes a double. */
    probe?: (url: string) => Promise<ProbeResult>;
  }>(),
  { probe: (url: string) => probeNode(url) },
);

const emit = defineEmits<{
  close: [];
  /** The node answered: the page can switch to it. */
  connected: [url: string];
}>();

const network = useNetwork();
const dialog = ref<HTMLElement | null>(null);

const isLocal = computed(() => props.choice === "local");
const title = computed(() => (isLocal.value ? "Local node" : "Team node"));
const where = computed(() => (isLocal.value ? "on your machine" : "the team's server"));

// The custom URL starts with what was saved, if anything differs from the default.
const savedCustom =
  network.state.localWss !== network.defaultLocalWss ? network.state.localWss : "";
const draft = ref(savedCustom);
const urlError = ref<string | null>(null);

const nodeUrl = computed(() =>
  isLocal.value ? draft.value.trim() || network.defaultLocalWss : network.nodeNetwork("team").wss,
);
const faucetUrl = computed(() => network.nodeNetwork(props.choice).faucet ?? "none");

const location = globalThis.location as Location | undefined;
const command = demoCommand(location?.origin ?? null);
// A page on another site asking for this machine: Chrome asks the person first.
const remotePage = location !== undefined && !isLoopbackHost(location.hostname);

type Phase = "idle" | "connecting" | "connected" | "failed";
const phase = ref<Phase>("idle");
const ledgerIndex = ref<number | null>(null);
const reason = ref<string | null>(null);
const copied = ref(false);

async function connect(): Promise<void> {
  urlError.value = null;
  const url = nodeUrl.value;
  if (isLocal.value) {
    const check = checkNodeUrl(url, network.pageProtocol);
    if (!check.ok) {
      urlError.value = check.reason;
      return;
    }
  }
  phase.value = "connecting";
  reason.value = null;
  const result = await props.probe(url);
  if (result.ok) {
    ledgerIndex.value = result.ledgerIndex;
    phase.value = "connected";
    emit("connected", url);
  } else {
    reason.value = result.reason;
    phase.value = "failed";
  }
}

async function copy(): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(command);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

onMounted(async () => {
  await nextTick();
  dialog.value?.querySelector<HTMLElement>("[data-testid='node-connect']")?.focus();
});

/** Esc closes; Tab stays inside the dialog. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [
    ...(dialog.value?.querySelectorAll<HTMLElement>("a, button, input, summary") ?? []),
  ].filter((element) => !element.hasAttribute("disabled"));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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
    class="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    data-testid="node-dialog"
    @keydown="onKeydown"
    @click.self="emit('close')"
  >
    <div ref="dialog" class="panel mt-12 w-full max-w-xl space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="eyebrow">Node</p>
          <h2 class="panel-title">{{ title }}</h2>
          <p class="text-sm text-muted-foreground">{{ where }}</p>
        </div>
        <button class="btn !min-h-8" data-testid="node-close" @click="emit('close')">Close</button>
      </div>

      <template v-if="isLocal">
        <div class="space-y-2 text-sm" data-testid="node-run">
          <p>
            Start the node with the amendment, its ledger closer and a dev faucet, from the
            repository (build <code>xrpld</code> first:
            <a
              class="explorer-link"
              :href="BUILDING_DOC_URL"
              target="_blank"
              rel="noopener noreferrer"
              >docs/BUILDING.md</a
            >):
          </p>
          <div class="node-command">
            <pre class="mono" data-testid="node-command">{{ command }}</pre>
            <button class="btn !min-h-8" type="button" data-testid="node-copy" @click="copy">
              {{ copied ? "Copied" : "Copy" }}
            </button>
          </div>
          <p class="text-muted-foreground">
            Everything stays on this machine. <code>GENESIS_SEED</code> is the seed of the node's
            genesis account; the faucet funds fresh accounts from it and the page never sees it.
          </p>
        </div>
      </template>

      <dl class="kv" data-testid="node-urls">
        <dt>Node</dt>
        <dd class="mono" data-testid="node-url">{{ nodeUrl }}</dd>
        <dt>Faucet</dt>
        <dd class="mono" data-testid="node-faucet">{{ faucetUrl }}</dd>
      </dl>

      <template v-if="isLocal">
        <p class="text-sm text-muted-foreground">
          With the defaults there is nothing to type.
          <template v-if="remotePage">
            Your browser may ask to let this site reach your local network: allow it.
          </template>
        </p>
        <details class="text-sm" :open="savedCustom !== ''" data-testid="node-advanced">
          <summary class="cursor-pointer text-muted-foreground">Custom URL (advanced)</summary>
          <label class="field mt-2">
            <span>Node WebSocket URL</span>
            <input
              v-model="draft"
              class="input mono"
              :placeholder="network.defaultLocalWss"
              autocomplete="off"
              spellcheck="false"
              data-testid="node-custom-url"
            />
          </label>
          <p class="mt-1 text-muted-foreground">
            From an https page: wss://, or ws:// on localhost. The hosted page's security policy
            allows the default URLs only; for another one, run the app yourself.
          </p>
          <p v-if="urlError" class="mt-1 text-danger" role="alert" data-testid="url-error">
            {{ urlError }}
          </p>
        </details>
      </template>

      <p v-else class="text-sm text-muted-foreground" data-testid="team-note">
        Reachable from the team's private network (tailnet) only. If it does not answer and your
        browser uses its own secure DNS, it cannot resolve *.ts.net names: turn secure DNS off or
        use the system resolver.
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <button
          class="btn btn-primary"
          :disabled="phase === 'connecting' || phase === 'connected'"
          data-testid="node-connect"
          @click="connect"
        >
          {{ phase === "failed" ? "Retry" : "Connect" }}
        </button>
        <p class="text-sm" role="status" aria-live="polite" data-testid="node-status">
          <span v-if="phase === 'connecting'" class="text-muted-foreground">
            Connecting to {{ nodeUrl }}…
          </span>
          <span v-else-if="phase === 'connected'" class="text-ok">
            Connected · ledger {{ ledgerIndex }}. Switching to this node…
          </span>
          <span v-else-if="phase === 'failed'" class="text-danger">
            Could not connect: {{ reason }}
          </span>
        </p>
        <p
          v-if="phase === 'failed' && isLocal"
          class="w-full text-sm text-muted-foreground"
          data-testid="node-hint"
        >
          Is the command above still running?
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-command {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.node-command pre {
  flex: 1;
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--color-surface-sunken);
  white-space: pre-wrap;
}
</style>
