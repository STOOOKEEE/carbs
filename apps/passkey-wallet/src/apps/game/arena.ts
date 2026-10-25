// The arena: ducks fly across, a click shoots one. A shot shows each step the ledger takes:
// locked (signed and submitted, pending), validated (in a closed ledger), then hit or miss, or
// refused in red with the ledger's code. Auto-clicker shots that find no free duck land as
// bullet marks with the same steps.

import { DUCK, GOLDEN_DUCK, type Target } from "./rules.ts";
import { ui } from "./ui.ts";

const DUCK_COUNT = 7;
const GOLDEN_SHARE = 0.2;
const DUCK_GLYPH = "🦆";
/** Vertical band the ducks fly in, in % of the arena's height. */
const TOP_MIN = 4;
const TOP_SPAN = 72;
const FLIGHT_MIN_S = 7;
const FLIGHT_SPAN_S = 7;
/** How long a settled shot stays on screen before a new duck takes its place. */
const SETTLED_MS = 1_300;
const REFUSED_MS = 2_000;
const BANNER_MS = 4_000;
/** Bullet marks land inside this band of the arena, in %. */
const MARK_INSET = 6;
const MARK_SPAN = 88;

export interface ShotVisual {
  validated: () => void;
  hit: (label: string) => void;
  miss: (label: string) => void;
  refused: (code: string) => void;
}

export interface Aimed {
  target: Target;
  visual: ShotVisual;
}

interface Duck {
  element: HTMLButtonElement;
  label: HTMLElement;
  target: Target;
}

export type Shoot = (aimed: Aimed) => void;

const flying = new Set<Duck>();
let shoot: Shoot | undefined;
let playable = false;
/** Only the last banner's timer hides it. */
let bannerGeneration = 0;

function percent(min: number, span: number): string {
  return `${min + Math.random() * span}%`;
}

/** The steps of one shot on an element that carries a label; `done` runs once it settled. */
function visualOf(element: HTMLElement, label: HTMLElement, done: () => void): ShotVisual {
  const settle = (state: string, text: string, ms: number): void => {
    element.classList.remove("locked", "validated");
    element.classList.add(state);
    label.textContent = text;
    setTimeout(done, ms);
  };
  element.classList.add("locked");
  label.textContent = "pending";
  return {
    validated: () => {
      element.classList.add("validated");
      label.textContent = "validated";
    },
    hit: (text) => settle("hit", text, SETTLED_MS),
    miss: (text) => settle("miss", text, SETTLED_MS),
    refused: (code) => settle("refused", code, REFUSED_MS),
  };
}

/** Locks a flying duck for a shot; a new duck replaces it once the shot settled. */
function lock(duck: Duck): Aimed {
  flying.delete(duck);
  return {
    target: duck.target,
    visual: visualOf(duck.element, duck.label, () => {
      duck.element.remove();
      spawnDuck();
    }),
  };
}

function spawnDuck(): void {
  const target = Math.random() < GOLDEN_SHARE ? GOLDEN_DUCK : DUCK;
  const element = document.createElement("button");
  element.type = "button";
  element.className = `duck duck-${target.kind}`;
  element.title = `${target.label}: ${target.priceXrp} XRP a shot`;
  const flight = FLIGHT_MIN_S + Math.random() * FLIGHT_SPAN_S;
  element.style.setProperty("--top", percent(TOP_MIN, TOP_SPAN));
  element.style.setProperty("--flight", `${flight}s`);
  element.style.setProperty("--delay", `${-Math.random() * flight}s`);
  const glyph = document.createElement("span");
  glyph.className = "duck-glyph";
  glyph.textContent = DUCK_GLYPH;
  const label = document.createElement("span");
  label.className = "shot-label";
  element.append(glyph, label);
  const duck: Duck = { element, label, target };
  element.addEventListener("click", () => {
    if (playable && shoot !== undefined && flying.has(duck)) shoot(lock(duck));
  });
  flying.add(duck);
  ui.arena.append(element);
}

/** Fills the arena with ducks; a click on a free duck calls `onShoot` while the arena is active. */
export function setupArena(onShoot: Shoot): void {
  shoot = onShoot;
  for (let i = 0; i < DUCK_COUNT; i++) spawnDuck();
}

/** The arena is playable only while a session is open. */
export function setArenaActive(active: boolean): void {
  playable = active;
  ui.arena.classList.toggle("active", active);
  ui.arenaHint.hidden = active;
}

/** A shot without a duck: a bullet mark somewhere in the arena. */
export function bulletMark(): ShotVisual {
  const mark = document.createElement("span");
  mark.className = "bullet";
  mark.style.setProperty("--x", percent(MARK_INSET, MARK_SPAN));
  mark.style.setProperty("--y", percent(MARK_INSET, MARK_SPAN));
  const label = document.createElement("span");
  label.className = "shot-label";
  mark.append(label);
  ui.arena.append(mark);
  return visualOf(mark, label, () => mark.remove());
}

/** An automatic shot at the duck price: a free plain duck, or a bullet mark when none is free. */
export function autoAim(): Aimed {
  for (const duck of flying) if (duck.target === DUCK) return lock(duck);
  return { target: DUCK, visual: bulletMark() };
}

export function showBanner(text: string, tone: "ledger" | "device" | "info"): void {
  bannerGeneration += 1;
  const generation = bannerGeneration;
  ui.arenaBanner.textContent = text;
  ui.arenaBanner.className = `arena-banner banner-${tone}`;
  ui.arenaBanner.hidden = false;
  setTimeout(() => {
    if (generation === bannerGeneration) ui.arenaBanner.hidden = true;
  }, BANNER_MS);
}
