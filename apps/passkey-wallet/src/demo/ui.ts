// The elements of demo.html.

import { element } from "../dom.ts";

export const ui = {
  connection: element("demo-connection", HTMLElement),
  timeline: element("demo-timeline", HTMLOListElement),
  agentId: element("demo-agent-id", HTMLElement),
  spent: element("demo-spent", HTMLElement),
  cap: element("demo-cap", HTMLElement),
  gaugeFill: element("demo-gauge-fill", HTMLElement),
  maxPerTx: element("demo-max-per-tx", HTMLElement),
  countdown: element("demo-countdown", HTMLElement),
  sessionState: element("demo-session-state", HTMLElement),
  staxStatus: element("demo-stax-status", HTMLElement),
  staxConnect: element("demo-stax-connect", HTMLButtonElement),
  pending: element("demo-pending", HTMLElement),
  staxMessage: element("demo-stax-message", HTMLElement),
  rootKey: element("demo-root-key", HTMLElement),
  layers: {
    device: {
      box: element("demo-layer-device", HTMLElement),
      count: element("demo-layer-device-count", HTMLElement),
    },
    ledger: {
      box: element("demo-layer-ledger", HTMLElement),
      count: element("demo-layer-ledger-count", HTMLElement),
    },
  },
};
