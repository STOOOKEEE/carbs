<script setup lang="ts">
/**
 * RubberSegment (React Bits), ported to Vue on the framework-agnostic `motion` package.
 * A segmented control whose thumb stretches when tapped, squashes when it lands, and can be
 * dragged and flicked. Colours default to the segment tokens of assets/tokens.css, so the
 * Commons and Ledger looks drive it without a prop.
 */
import { animate, motionValue, type AnimationPlaybackControls, type MotionValue } from "motion";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

export interface SegmentItem {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    items: readonly (string | SegmentItem)[];
    modelValue?: string;
    defaultValue?: string;
    trackColor?: string;
    thumbColor?: string;
    textColor?: string;
    activeTextColor?: string;
    size?: "sm" | "md" | "lg";
    radius?: number;
    inset?: number;
    equalSlots?: boolean;
    stretch?: number;
    squash?: number;
    speed?: number;
    glide?: number;
    draggable?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  }>(),
  {
    modelValue: undefined,
    defaultValue: undefined,
    trackColor: "var(--color-seg-track)",
    thumbColor: "var(--color-seg-thumb)",
    textColor: "var(--color-seg-ink)",
    activeTextColor: "var(--color-seg-ink-active)",
    size: "md",
    radius: 999,
    inset: 3,
    equalSlots: true,
    stretch: 100,
    squash: 3,
    speed: 1,
    glide: 75,
    draggable: true,
    disabled: false,
    ariaLabel: "Segmented control",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string, index: number];
}>();

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SPRING_UI = { type: "spring", duration: 0.3, bounce: 0 } as const;
const SPRING_MOMENTUM = { type: "spring", duration: 0.4, bounce: 0.2 } as const;
const SPRING_RELAX = { type: "spring", duration: 0.16, bounce: 0 } as const;
const DILATE = 0.19;
const HANDOFF = 0.15;
const FLICK = 110;
const MAX_VELOCITY = 2000;
const DEADZONE = 4;
const SLOP = 10;
const RUBBER = 0.55;
const SIZES = {
  sm: { height: 28, font: 12, pad: 10, min: 36 },
  md: { height: 36, font: 13, pad: 14, min: 44 },
  lg: { height: 44, font: 14, pad: 18, min: 48 },
} as const;

interface Slot {
  l: number;
  r: number;
}

interface DragState {
  id: number;
  x0: number;
  slot: number;
  onThumb: boolean;
  live: boolean;
  offset: number;
  w: number;
  hist: [number, number][];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const rubber = (over: number, dim: number): number =>
  (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));
const project = (v: number, glide: number): number => {
  const d = 1 - 0.1 * Math.pow(0.05, glide / 100);
  return ((v / 1000) * d) / (1 - d);
};
const velocityOf = (hist: [number, number][], now: number): number => {
  const recent = hist.filter(([t]) => now - t <= 100);
  if (recent.length < 2) return 0;
  const first = recent[0] as [number, number];
  const last = recent[recent.length - 1] as [number, number];
  return last[0] - first[0] >= 8 ? ((last[1] - first[1]) / (last[0] - first[0])) * 1000 : 0;
};
const nearestSlot = (slotList: Slot[], x: number): number => {
  let best = 0;
  const centre = (slot: Slot | undefined): number => (slot ? (slot.l + slot.r) / 2 : 0);
  for (let i = 1; i < slotList.length; i++) {
    if (Math.abs(centre(slotList[i]) - x) < Math.abs(centre(slotList[best]) - x)) best = i;
  }
  return best;
};

const list = computed<SegmentItem[]>(() =>
  props.items.map((item) => (typeof item === "string" ? { value: item, label: item } : item)),
);
const inner = ref(props.defaultValue ?? list.value[0]?.value);
const current = computed(() => (props.modelValue !== undefined ? props.modelValue : inner.value));
// -1 when nothing is selected (the landing page): the thumb is hidden until a slot is chosen.
const index = computed(() => list.value.findIndex((item) => item.value === current.value));
const preset = computed(() => SIZES[props.size] ?? SIZES.md);
const thumbRadius = computed(() => Math.max(0, props.radius - props.inset));
const rootStyle = computed(() => ({
  "--rs-track": props.trackColor,
  "--rs-thumb": props.thumbColor,
  "--rs-ink": props.textColor,
  "--rs-ink-active": props.activeTextColor,
  "--rs-radius": `${props.radius}px`,
  "--rs-inset": `${props.inset}px`,
  "--rs-thumb-radius": `${thumbRadius.value}px`,
  "--rs-h": `${preset.value.height}px`,
  "--rs-font": `${preset.value.font}px`,
  "--rs-pad": `${preset.value.pad}px`,
  "--rs-min": `${preset.value.min}px`,
}));

const trackRef = ref<HTMLElement | null>(null);
const thumbRef = ref<HTMLElement | null>(null);
const itemRefs: (HTMLElement | null)[] = [];
let slots: Slot[] = [];
let box: DOMRect | null = null;
let committed = Math.max(0, index.value);
let handoff: ReturnType<typeof setTimeout> | undefined;
let drag: DragState | null = null;
let gen = 0;
let reduce = false;
let observer: ResizeObserver | null = null;
const running = new Set<AnimationPlaybackControls>();

const edgeL = motionValue(0);
const edgeR = motionValue(0);
const innerW = motionValue(0);

function paintThumb(): void {
  const thumb = thumbRef.value;
  if (!thumb) return;
  const right = Math.max(0, innerW.get() - edgeR.get());
  const left = Math.max(0, edgeL.get());
  thumb.style.clipPath = `inset(0 ${right}px 0 ${left}px round ${thumbRadius.value}px)`;
}

const unsubscribe = [edgeL, edgeR, innerW].map((value) => value.on("change", paintThumb));

const t = (seconds: number): number => seconds / props.speed;

function run(
  value: MotionValue<number>,
  to: number,
  options: Record<string, unknown>,
): AnimationPlaybackControls {
  const controls = animate(value, to, options as never);
  running.add(controls);
  void controls.finished.then(() => running.delete(controls));
  return controls;
}

function jumpTo(i: number): void {
  const s = slots[i];
  if (!s) return;
  clearTimeout(handoff);
  gen += 1;
  edgeL.jump(s.l);
  edgeR.jump(s.r);
}

function measure(): void {
  const track = trackRef.value;
  if (!track) return;
  const rect = track.getBoundingClientRect();
  box = rect;
  slots = list.value.map((_, i) => {
    const el = itemRefs[i];
    if (!el) return { l: 0, r: 0 };
    const r = el.getBoundingClientRect();
    return { l: r.left - rect.left - props.inset, r: r.right - rect.left - props.inset };
  });
  innerW.set(rect.width - props.inset * 2);
  jumpTo(committed);
  paintThumb();
}

function commit(i: number): void {
  committed = i;
  if (i === index.value) return;
  const item = list.value[i];
  if (!item) return;
  if (props.modelValue === undefined) inner.value = item.value;
  emit("update:modelValue", item.value);
  emit("change", item.value, i);
}

function land(to: number, v: number | null, flick: boolean, withSquash: boolean): void {
  const b = slots[to];
  if (!b) return;
  gen += 1;
  const g = gen;
  const dir = Math.sign((b.l + b.r) / 2 - (edgeL.get() + edgeR.get()) / 2) || 1;
  const [lead, leadTo, trail, trailTo] =
    dir > 0 ? [edgeR, b.r, edgeL, b.l] : [edgeL, b.l, edgeR, b.r];
  const velocityFor = (mv: MotionValue<number>): number =>
    clamp(v === null ? mv.getVelocity() : v, -MAX_VELOCITY, MAX_VELOCITY);
  run(lead, leadTo, {
    ...(flick ? SPRING_MOMENTUM : SPRING_UI),
    duration: t(flick ? 0.4 : 0.3),
    velocity: velocityFor(lead),
  });
  const trailVelocity = velocityFor(trail);
  if (!withSquash || props.squash <= 0) {
    run(trail, trailTo, { ...SPRING_UI, duration: t(0.3), velocity: trailVelocity });
    return;
  }
  void run(trail, trailTo + dir * props.squash, {
    ...SPRING_UI,
    duration: t(0.3),
    velocity: trailVelocity,
  }).finished.then(() => {
    if (gen === g) run(trail, trailTo, { ...SPRING_RELAX, duration: t(0.16) });
  });
}

function travel(from: number, to: number): void {
  const a = slots[from];
  const b = slots[to];
  if (!b) return;
  if (!a) {
    jumpTo(to);
    return;
  }
  clearTimeout(handoff);
  gen += 1;
  if (reduce) {
    edgeL.jump(b.l);
    edgeR.jump(b.r);
    return;
  }
  const u = props.stretch / 100;
  const tween = { duration: t(DILATE), ease: EASE_OUT };
  run(edgeL, b.l + (Math.min(a.l, b.l) - b.l) * u, tween);
  run(edgeR, b.r + (Math.max(a.r, b.r) - b.r) * u, tween);
  handoff = setTimeout(() => land(to, null, false, true), t(HANDOFF) * 1000);
}

const localX = (e: PointerEvent): number => e.clientX - (box ? box.left : 0) - props.inset;

function stopEdges(): void {
  for (const controls of running) controls.stop();
  running.clear();
  edgeL.stop();
  edgeR.stop();
}

function onPointerDown(e: PointerEvent, i: number): void {
  const track = trackRef.value;
  if (props.disabled || drag || e.button !== 0 || !track) return;
  box = track.getBoundingClientRect();
  const target = e.currentTarget as HTMLElement;
  try {
    target.setPointerCapture(e.pointerId);
  } catch {
    // Capture is an enhancement: a drag that loses it still lands on a slot.
  }
  const x = localX(e);
  const onThumb = props.draggable && x >= edgeL.get() && x <= edgeR.get();
  drag = {
    id: e.pointerId,
    x0: x,
    slot: i,
    onThumb,
    live: false,
    offset: 0,
    w: 0,
    hist: [[e.timeStamp, x]],
  };
  if (onThumb) {
    clearTimeout(handoff);
    gen += 1;
    stopEdges();
  } else if (!reduce) {
    target.dataset["pressed"] = "";
  }
}

function onPointerMove(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id || !d.onThumb) return;
  const x = localX(e);
  d.hist.push([e.timeStamp, x]);
  if (d.hist.length > 8) d.hist.shift();
  if (!d.live) {
    if (Math.abs(x - d.x0) < DEADZONE) return;
    d.live = true;
    d.offset = x - edgeL.get();
    d.w = edgeR.get() - edgeL.get();
    if (trackRef.value) trackRef.value.dataset["held"] = "";
  }
  const width = innerW.get();
  const l = x - d.offset;
  const maxL = width - d.w;
  if (reduce) {
    const c = clamp(l, 0, maxL);
    edgeL.set(c);
    edgeR.set(c + d.w);
  } else if (l < 0) {
    edgeL.set(0);
    edgeR.set(d.w - rubber(-l, d.w));
  } else if (l > maxL) {
    edgeR.set(width);
    edgeL.set(maxL + rubber(l - maxL, d.w));
  } else {
    edgeL.set(l);
    edgeR.set(l + d.w);
  }
}

function release(): DragState | null {
  const d = drag;
  drag = null;
  if (trackRef.value) delete trackRef.value.dataset["held"];
  if (d) {
    const el = itemRefs[d.slot];
    if (el) delete el.dataset["pressed"];
  }
  return d;
}

function onPointerUp(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  release();
  const x = localX(e);
  if (!d.live) {
    if (Math.abs(x - d.x0) <= SLOP && d.slot !== committed) {
      const from = committed;
      commit(d.slot);
      travel(from, d.slot);
    }
    return;
  }
  const v = velocityOf(d.hist, e.timeStamp);
  const flick = Math.abs(v) > FLICK;
  let to = nearestSlot(slots, (edgeL.get() + edgeR.get()) / 2 + project(v, props.glide));
  if (flick && to === committed) to = clamp(to + Math.sign(v), 0, list.value.length - 1);
  commit(to);
  if (reduce) jumpTo(to);
  else land(to, v, flick, flick);
}

function onPointerCancel(e: PointerEvent): void {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  release();
  if (!d.live) return;
  if (reduce) jumpTo(committed);
  else land(committed, null, false, false);
}

function onKeyDown(e: KeyboardEvent): void {
  if (props.disabled) return;
  const last = list.value.length - 1;
  let next: number | null = null;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(last, index.value + 1);
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, index.value - 1);
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = last;
  if (next === null) return;
  e.preventDefault();
  if (next === index.value) return;
  commit(next);
  jumpTo(next);
  itemRefs[next]?.focus();
}

watch(index, (value, before) => {
  if (value < 0) return;
  if (before < 0) {
    committed = value;
    jumpTo(value);
  } else if (!drag && committed !== value) {
    committed = value;
    jumpTo(value);
  }
});

watch(
  () => [list.value.map((item) => item.value).join("|"), props.size, props.inset, props.equalSlots],
  async () => {
    await nextTick();
    measure();
  },
);

onMounted(() => {
  reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  measure();
  observer = new ResizeObserver(measure);
  if (trackRef.value) observer.observe(trackRef.value);
  void document.fonts?.ready.then(measure);
});

onBeforeUnmount(() => {
  clearTimeout(handoff);
  observer?.disconnect();
  stopEdges();
  for (const off of unsubscribe) off();
});
</script>

<template>
  <div
    ref="trackRef"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
    :data-equal="equalSlots ? '' : undefined"
    :data-empty="index < 0 ? '' : undefined"
    :data-draggable="draggable && !disabled ? '' : undefined"
    class="rubber-segment"
    :style="rootStyle"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onPointerCancel"
  >
    <button
      v-for="(item, i) in list"
      :key="item.value"
      :ref="(el) => (itemRefs[i] = el as HTMLElement | null)"
      type="button"
      role="radio"
      :aria-checked="i === index"
      :tabindex="i === Math.max(0, index) ? 0 : -1"
      :disabled="disabled"
      class="rubber-segment__item"
      :data-testid="`segment-${item.value}`"
      @pointerdown="onPointerDown($event, i)"
      @keydown="onKeyDown"
    >
      {{ item.label }}
    </button>
    <div ref="thumbRef" class="rubber-segment__thumb" aria-hidden="true">
      <span
        v-for="item in list"
        :key="item.value"
        class="rubber-segment__item rubber-segment__copy"
      >
        {{ item.label }}
      </span>
    </div>
  </div>
</template>

<style>
.rubber-segment {
  --rs-idle: 0.7;
  --rs-hover: 0.9;
  --rs-ease-out: cubic-bezier(0.23, 1, 0.32, 1);

  position: relative;
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: auto;
  vertical-align: middle;
  padding: var(--rs-inset);
  border-radius: var(--rs-radius);
  background: var(--rs-track);
  font-family: inherit;
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--motion-slow, 480ms) ease;
}

.rubber-segment[data-equal] {
  grid-auto-columns: minmax(0, 1fr);
}

.rubber-segment[aria-disabled="true"] {
  opacity: 0.5;
  pointer-events: none;
}

.rubber-segment__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: calc(var(--rs-h) - var(--rs-inset) * 2);
  min-width: var(--rs-min);
  margin: 0;
  padding: 0 var(--rs-pad);
  border: 0;
  border-radius: var(--rs-thumb-radius);
  background: none;
  color: var(--rs-ink);
  opacity: var(--rs-idle);
  font: inherit;
  font-family: var(--font-display, inherit);
  font-size: var(--rs-font);
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
  transition:
    opacity 160ms ease,
    transform 160ms var(--rs-ease-out);
}

.rubber-segment__item[aria-checked="true"] {
  cursor: default;
}

.rubber-segment[data-draggable] .rubber-segment__item[aria-checked="true"] {
  cursor: grab;
}

.rubber-segment[data-held],
.rubber-segment[data-held] .rubber-segment__item {
  cursor: grabbing;
}

.rubber-segment__item[data-pressed] {
  transform: scale(0.96);
}

.rubber-segment__item:focus-visible {
  outline: 2px solid var(--rs-thumb);
  outline-offset: 3px;
}

@media (hover: hover) and (pointer: fine) {
  .rubber-segment__item[aria-checked="false"]:hover {
    opacity: var(--rs-hover);
  }
}

.rubber-segment__thumb {
  position: absolute;
  inset: var(--rs-inset);
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: auto;
  background: var(--rs-thumb);
  color: var(--rs-ink-active);
  pointer-events: none;
  transition:
    background-color var(--motion-slow, 480ms) ease,
    opacity 160ms ease;
}

.rubber-segment[data-equal] .rubber-segment__thumb {
  grid-auto-columns: minmax(0, 1fr);
}

.rubber-segment[data-empty] .rubber-segment__thumb {
  opacity: 0;
}

.rubber-segment__copy {
  color: inherit;
  opacity: 1;
  cursor: default;
}

@media (prefers-reduced-motion: reduce) {
  .rubber-segment__item {
    transition: opacity 160ms ease;
  }
}
</style>
