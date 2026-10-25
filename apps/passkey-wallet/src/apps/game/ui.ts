// The elements of game.html.

import { element } from "../../dom.ts";

export const ui = {
  connection: element("game-connection", HTMLElement),
  arena: element("game-arena", HTMLElement),
  arenaHint: element("game-arena-hint", HTMLElement),
  arenaBanner: element("game-arena-banner", HTMLElement),
  priceDuck: element("game-price-duck", HTMLElement),
  priceGolden: element("game-price-golden", HTMLElement),
  stats: {
    fired: element("game-fired", HTMLElement),
    pending: element("game-pending", HTMLElement),
    validated: element("game-validated", HTMLElement),
    hits: element("game-hits", HTMLElement),
    won: element("game-won", HTMLElement),
  },
  agentId: element("game-agent-id", HTMLElement),
  spent: element("game-spent", HTMLElement),
  cap: element("game-cap", HTMLElement),
  spentFill: element("game-spent-fill", HTMLElement),
  count: element("game-count", HTMLElement),
  maxCount: element("game-max-count", HTMLElement),
  countFill: element("game-count-fill", HTMLElement),
  maxPerTx: element("game-max-per-tx", HTMLElement),
  countdown: element("game-countdown", HTMLElement),
  sessionState: element("game-session-state", HTMLElement),
  txGrid: element("game-tx-grid", HTMLElement),
  owner: element("game-owner", HTMLElement),
  openStax: element("game-open-stax", HTMLButtonElement),
  openTouchId: element("game-open-touchid", HTMLButtonElement),
  openGreedy: element("game-open-greedy", HTMLButtonElement),
  abuseBet: element("game-abuse-bet", HTMLButtonElement),
  abuseAuto: element("game-abuse-auto", HTMLButtonElement),
  close: element("game-close", HTMLButtonElement),
  message: element("game-message", HTMLElement),
  refusals: element("game-refusals", HTMLOListElement),
  layers: {
    device: {
      box: element("game-layer-device", HTMLElement),
      count: element("game-layer-device-count", HTMLElement),
    },
    ledger: {
      box: element("game-layer-ledger", HTMLElement),
      count: element("game-layer-ledger-count", HTMLElement),
    },
  },
};
