<script setup lang="ts">
/**
 * ThoughtLine (React Bits), ported to Vue on the framework-agnostic `motion` package.
 * A working line that breathes with a live clock and a trace of steps, then settles into
 * "Thought for 3.2s". Here it shows that the page waits for the node (a ledger closes every
 * few seconds) and which steps have been taken. Icons are inline SVG: no icon package.
 */
import { animate, type AnimationPlaybackControls } from "motion";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    label?: string;
    doneLabel?: string;
    glyph?: "sparkle" | "dot" | "none";
    steps?: readonly string[];
    collapsible?: boolean;
    collapseOnSettle?: boolean;
    color?: string;
    glyphColor?: string;
    fontSize?: number;
    breathPeriod?: number;
    breathDepth?: number;
    shimmer?: boolean;
    shimmerDuration?: number;
    settleDuration?: number;
    settleBlur?: number;
    working?: boolean;
    settleAfter?: number;
    elapsed?: number;
    showTimer?: boolean;
  }>(),
  {
    label: "Thinking…",
    doneLabel: "",
    glyph: "sparkle",
    steps: () => [],
    collapsible: true,
    collapseOnSettle: true,
    color: "var(--color-ink, currentColor)",
    glyphColor: "",
    fontSize: 16,
    breathPeriod: 1.6,
    breathDepth: 0.45,
    shimmer: true,
    shimmerDuration: 1.8,
    settleDuration: 350,
    settleBlur: 2,
    working: true,
    settleAfter: 0,
    elapsed: undefined,
    showTimer: true,
  },
);

const emit = defineEmits<{ settle: [seconds: number] }>();

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.77, 0, 0.175, 1];
const GLYPH_DONE = 0.55;

const fmt = (ds: number): string =>
  ds < 600
    ? `${(ds / 10).toFixed(1)}s`
    : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;
const spoken = (ds: number): string =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

const reducedMotion = ref(false);
const autoSettled = ref(false);
const open = ref(true);
const isWorking = computed(() => props.working && !autoSettled.value);
const doneText = computed(
  () => props.doneLabel || (props.showTimer ? "Thought for" : "Done thinking"),
);
const hasTrace = computed(() => props.steps.length > 0);
const toggle = computed(() => hasTrace.value && props.collapsible);
const announce = ref(props.label);
const sheenOn = computed(() => props.shimmer && !reducedMotion.value);

const glyphRef = ref<HTMLElement | null>(null);
const breathRef = ref<HTMLElement | null>(null);
const timerRef = ref<HTMLElement | null>(null);
const stackRef = ref<HTMLElement | null>(null);
const workRef = ref<HTMLElement | null>(null);
const doneRef = ref<HTMLElement | null>(null);
let ds = 0;
let prevWorking = isWorking.value;
let running: AnimationPlaybackControls[] = [];
let interval: ReturnType<typeof setInterval> | undefined;
let observer: ResizeObserver | null = null;

const rootStyle = computed(() => ({
  "--tl-font": `${props.fontSize}px`,
  "--tl-color": props.color,
  "--tl-glyph": props.glyphColor || props.color,
  "--tl-settle": `${props.settleDuration}ms`,
  "--tl-blur": `${props.settleBlur}px`,
  "--tl-shimmer": `${props.shimmerDuration}s`,
}));

watch(
  () => props.working,
  (value) => {
    if (value) autoSettled.value = false;
  },
);

watch(
  isWorking,
  (value) => {
    if (value) open.value = true;
    else if (props.collapseOnSettle) open.value = false;
  },
  { immediate: true },
);

function stopAnimations(): void {
  for (const controls of running) controls.stop();
  running = [];
}

let stopOnReplace: (() => void) | null = null;

function breathe(): void {
  stopOnReplace?.();
  stopAnimations();
  const glyphEl = glyphRef.value;
  const breathEl = breathRef.value;
  if (!breathEl) return;
  const depth = reducedMotion.value ? Math.min(props.breathDepth, 0.2) : props.breathDepth;
  const period = reducedMotion.value ? props.breathPeriod * 1.5 : props.breathPeriod;
  const trough = 1 - depth;
  const sheen = sheenOn.value;
  const s = props.settleDuration / 1000;
  const loop = (el: HTMLElement, delay: number): AnimationPlaybackControls =>
    animate(
      el,
      { opacity: [trough, 1, trough] },
      { duration: period, ease: EASE_IN_OUT, repeat: Infinity, delay },
    );
  let cancelled = false;
  if (isWorking.value) {
    if (depth > 0) {
      if (sheen) running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
      if (glyphEl) {
        const lead = animate(glyphEl, { opacity: trough }, { duration: 0.2, ease: EASE_OUT });
        running.push(lead);
        void lead.finished.then(() => {
          if (cancelled || !isWorking.value) return;
          running.push(loop(glyphEl, 0));
          if (!sheen) running.push(loop(breathEl, 0.14));
        });
      } else if (!sheen) {
        running.push(loop(breathEl, 0.14));
      }
    } else {
      if (glyphEl)
        running.push(animate(glyphEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
      running.push(animate(breathEl, { opacity: 1 }, { duration: 0.2, ease: EASE_OUT }));
    }
  } else {
    if (glyphEl)
      running.push(animate(glyphEl, { opacity: GLYPH_DONE }, { duration: s, ease: EASE_OUT }));
    running.push(animate(breathEl, { opacity: 1 }, { duration: s, ease: EASE_OUT }));
  }
  stopOnReplace = () => {
    cancelled = true;
  };
}

function paint(next: number): void {
  ds = next;
  if (timerRef.value) timerRef.value.textContent = fmt(next);
}

function startClock(): void {
  clearInterval(interval);
  if (props.elapsed != null) {
    paint(Math.round(props.elapsed * 10));
    return;
  }
  if (!isWorking.value) return;
  const startedAt = performance.now();
  paint(0);
  interval = setInterval(() => {
    const next = Math.floor((performance.now() - startedAt) / 100);
    paint(next);
    if (props.settleAfter > 0 && next >= Math.round(props.settleAfter * 10)) {
      autoSettled.value = true;
    }
  }, 100);
}

function place(glide: boolean): void {
  const timer = timerRef.value;
  const stack = stackRef.value;
  if (!timer || !stack) return;
  const active = isWorking.value ? workRef.value : doneRef.value;
  if (!active) return;
  const shift = active.offsetWidth - stack.offsetWidth;
  if (!glide) timer.style.transition = "none";
  timer.style.transform = `translateX(${shift}px)`;
  if (!glide) {
    void timer.offsetWidth;
    timer.style.transition = "";
  }
}

function settle(): void {
  announce.value = props.showTimer ? `${doneText.value} ${spoken(ds)}` : doneText.value;
  emit("settle", ds / 10);
}

watch(isWorking, async (value) => {
  await nextTick();
  breathe();
  startClock();
  place(prevWorking !== value);
  prevWorking = value;
  if (value) announce.value = props.label;
  else settle();
});

watch(
  () => [props.breathPeriod, props.breathDepth, props.settleDuration, props.glyph, props.shimmer],
  async () => {
    await nextTick();
    breathe();
  },
);

watch(
  () => [props.label, doneText.value, props.fontSize, props.showTimer],
  async () => {
    await nextTick();
    place(false);
  },
);

watch(
  () => props.elapsed,
  () => startClock(),
);

onMounted(() => {
  reducedMotion.value = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  breathe();
  startClock();
  place(false);
  observer = new ResizeObserver(() => place(false));
  if (workRef.value) observer.observe(workRef.value);
  if (doneRef.value) observer.observe(doneRef.value);
  if (!isWorking.value) settle();
});

onBeforeUnmount(() => {
  stopOnReplace?.();
  clearInterval(interval);
  observer?.disconnect();
  stopAnimations();
});

function onToggle(): void {
  if (toggle.value) open.value = !open.value;
}
</script>

<template>
  <div
    class="thought-line"
    :data-working="isWorking ? '' : undefined"
    :data-open="open && hasTrace ? '' : undefined"
    :style="rootStyle"
  >
    <component
      :is="collapsible ? 'button' : 'div'"
      :type="collapsible ? 'button' : undefined"
      class="thought-line__head"
      :data-toggle="toggle ? '' : undefined"
      :aria-expanded="toggle ? open : undefined"
      :tabindex="toggle ? 0 : -1"
      @click="onToggle"
    >
      <span v-if="glyph !== 'none'" ref="glyphRef" class="thought-line__glyph" aria-hidden="true">
        <svg
          v-if="glyph === 'sparkle'"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M9.5 3.5 11 8l4.5 1.5L11 11l-1.5 4.5L8 11 3.5 9.5 8 8z" />
          <path d="m17.5 13 .9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z" />
        </svg>
        <span v-else class="thought-line__dot" />
      </span>
      <span ref="stackRef" class="thought-line__label" aria-hidden="true">
        <span ref="workRef" class="thought-line__text" :data-active="isWorking ? '' : undefined">
          <span
            ref="breathRef"
            class="thought-line__breath"
            :data-shimmer="sheenOn ? '' : undefined"
          >
            {{ label }}
          </span>
        </span>
        <span
          ref="doneRef"
          class="thought-line__text thought-line__text--done"
          :data-active="isWorking ? undefined : ''"
        >
          {{ doneText }}
        </span>
      </span>
      <span
        v-if="showTimer"
        ref="timerRef"
        class="thought-line__timer"
        :data-done="isWorking ? undefined : ''"
        aria-hidden="true"
      >
        0.0s
      </span>
      <span
        v-if="collapsible"
        class="thought-line__chevron"
        :data-on="hasTrace ? '' : undefined"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="1em"
          height="1em"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      <span class="thought-line__sr" role="status">{{ announce }}</span>
    </component>
    <div
      v-if="hasTrace"
      class="thought-line__trace"
      :data-open="open ? '' : undefined"
      :aria-hidden="!open"
    >
      <div class="thought-line__fold">
        <div class="thought-line__steps">
          <div
            v-for="(text, i) in steps"
            :key="`${i}-${text}`"
            class="thought-line__step"
            :data-done="!isWorking || i < steps.length - 1 ? '' : undefined"
          >
            <span class="thought-line__mark" aria-hidden="true">
              <svg
                v-if="!isWorking || i < steps.length - 1"
                viewBox="0 0 24 24"
                width="1em"
                height="1em"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              <i v-else class="thought-line__pulse" />
            </span>
            <span class="thought-line__step-text">{{ text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.thought-line {
  --tl-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --tl-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --tl-font: 16px;
  --tl-color: currentColor;
  --tl-glyph: currentColor;
  --tl-settle: 350ms;
  --tl-blur: 2px;
  --tl-shimmer: 1.8s;
  --tl-done: 0.75;
  --tl-timer: 0.55;

  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  color: var(--tl-color);
  font-family: inherit;
  font-size: var(--tl-font);
  font-weight: 500;
  line-height: 1.2;
}

.thought-line__head {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  outline: none;
  cursor: default;
}

.thought-line__head[data-toggle] {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.thought-line__head:focus-visible {
  outline: 2px solid var(--color-accent, currentColor);
  outline-offset: 4px;
  border-radius: 0.25em;
}

.thought-line__glyph {
  display: inline-flex;
  flex: none;
  width: 1.1em;
  height: 1.1em;
  margin-right: 0.2em;
  color: var(--tl-glyph);
}

.thought-line__glyph svg {
  display: block;
  width: 100%;
  height: 100%;
}

.thought-line__dot {
  width: 0.5em;
  height: 0.5em;
  margin: auto;
  border-radius: 50%;
  background: currentColor;
}

.thought-line__label {
  display: inline-grid;
}

.thought-line__text {
  grid-area: 1 / 1;
  width: max-content;
  opacity: 0;
  filter: blur(var(--tl-blur));
  transition:
    opacity var(--tl-settle) var(--tl-ease-out),
    filter var(--tl-settle) var(--tl-ease-out);
}

.thought-line__text[data-active] {
  opacity: 1;
  filter: blur(0);
}

.thought-line__text--done[data-active] {
  opacity: var(--tl-done);
}

.thought-line__breath {
  display: inline-block;
}

.thought-line[data-working] .thought-line__breath[data-shimmer] {
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--tl-color) 50%, transparent) 30%,
    var(--tl-color) 50%,
    color-mix(in srgb, var(--tl-color) 50%, transparent) 70%
  );
  background-size: 250% 100%;
  background-position: 125% 0;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: thought-line-shimmer var(--tl-shimmer) linear infinite;
}

@keyframes thought-line-shimmer {
  to {
    background-position: -125% 0;
  }
}

.thought-line__timer {
  font-variant-numeric: tabular-nums;
  opacity: var(--tl-timer);
  transition:
    opacity var(--tl-settle) ease,
    transform var(--tl-settle) var(--tl-ease-in-out);
}

.thought-line__timer[data-done] {
  opacity: var(--tl-done);
}

.thought-line__chevron {
  display: inline-flex;
  margin-left: 0.1em;
  opacity: 0;
  transition:
    opacity 200ms ease,
    transform 200ms var(--tl-ease-out);
}

.thought-line__chevron[data-on] {
  opacity: 0.55;
}

.thought-line[data-open] .thought-line__chevron {
  transform: rotate(180deg);
}

.thought-line__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.thought-line__trace {
  display: grid;
  grid-template-rows: 0fr;
  width: 0;
  min-width: 100%;
  transition: grid-template-rows var(--tl-settle) var(--tl-ease-out);
}

.thought-line__trace[data-open] {
  grid-template-rows: 1fr;
}

.thought-line__fold {
  min-height: 0;
  overflow-x: visible;
  overflow-y: clip;
}

.thought-line__steps {
  display: flex;
  flex-direction: column;
  gap: 0.45em;
  width: max-content;
  padding: 0.6em 0 0.2em 1.6em;
  font-size: 0.875em;
  font-weight: 400;
  white-space: nowrap;
}

.thought-line__step {
  display: flex;
  align-items: center;
  gap: 0.5em;
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 200ms var(--tl-ease-out),
    transform 200ms var(--tl-ease-out);
}

@starting-style {
  .thought-line__step {
    opacity: 0;
    transform: translateY(-4px);
  }
}

.thought-line__mark {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 1em;
  height: 1em;
  opacity: 0.55;
}

.thought-line__pulse {
  display: block;
  width: 0.4em;
  height: 0.4em;
  border-radius: 50%;
  background: currentColor;
  animation: thought-line-pulse 1.6s var(--tl-ease-in-out) infinite;
}

@keyframes thought-line-pulse {
  0%,
  100% {
    opacity: 0.55;
  }

  50% {
    opacity: 1;
  }
}

.thought-line__step-text {
  transition: opacity var(--tl-settle) ease;
}

.thought-line__step[data-done] .thought-line__step-text {
  opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
  .thought-line__text {
    filter: none !important;
    transition: opacity var(--tl-settle) ease;
  }

  .thought-line__timer {
    transition: opacity var(--tl-settle) ease;
  }

  .thought-line__step {
    transform: none !important;
    transition: opacity 200ms ease;
  }

  .thought-line__pulse {
    animation-duration: 2.4s;
  }
}
</style>
