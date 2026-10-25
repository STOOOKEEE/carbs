// The elements of stream.html.

import { element } from "../../dom.ts";

export const ui = {
  connection: element("st-connection", HTMLElement),
  ownerLine: element("st-owner-line", HTMLElement),
  player: element("st-player", HTMLElement),
  playerOverlay: element("st-player-overlay", HTMLElement),
  play: element("st-play", HTMLButtonElement),
  pause: element("st-pause", HTMLButtonElement),
  watched: element("st-watched", HTMLElement),
  paid: element("st-paid", HTMLElement),
  payments: element("st-payments", HTMLElement),
  provider: element("st-provider", HTMLElement),
  agentId: element("st-agent-id", HTMLElement),
  spent: element("st-spent", HTMLElement),
  cap: element("st-cap", HTMLElement),
  gaugeFill: element("st-gauge-fill", HTMLElement),
  count: element("st-count", HTMLElement),
  countdown: element("st-countdown", HTMLElement),
  maxPerTx: element("st-max-per-tx", HTMLElement),
  sessionState: element("st-session-state", HTMLElement),
  refusals: element("st-refusals", HTMLOListElement),
  ownerStatus: element("st-owner-status", HTMLElement),
  connectStax: element("st-connect-stax", HTMLButtonElement),
  usePasskey: element("st-use-passkey", HTMLButtonElement),
  open: element("st-open", HTMLButtonElement),
  abuseBig: element("st-abuse-big", HTMLButtonElement),
  abuseBinge: element("st-abuse-binge", HTMLButtonElement),
  abuseDevice: element("st-abuse-device", HTMLButtonElement),
  close: element("st-close", HTMLButtonElement),
  message: element("st-message", HTMLElement),
  layers: {
    device: {
      box: element("st-layer-device", HTMLElement),
      count: element("st-layer-device-count", HTMLElement),
    },
    ledger: {
      box: element("st-layer-ledger", HTMLElement),
      count: element("st-layer-ledger-count", HTMLElement),
    },
  },
};
