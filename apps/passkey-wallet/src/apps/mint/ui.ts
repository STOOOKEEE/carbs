// The elements of mint.html.

import { element } from "../../dom.ts";

export const ui = {
  connection: element("mint-connection", HTMLElement),
  ruleCount: element("mint-rule-count", HTMLElement),
  ruleDuration: element("mint-rule-duration", HTMLElement),
  openStax: element("mint-open-stax", HTMLButtonElement),
  openMac: element("mint-open-mac", HTMLButtonElement),
  ownerMessage: element("mint-owner-message", HTMLElement),
  agentId: element("mint-agent-id", HTMLElement),
  txCount: element("mint-tx-count", HTMLElement),
  txMax: element("mint-tx-max", HTMLElement),
  gaugeFill: element("mint-gauge-fill", HTMLElement),
  countdown: element("mint-countdown", HTMLElement),
  spent: element("mint-spent", HTMLElement),
  sessionState: element("mint-session-state", HTMLElement),
  close: element("mint-close", HTMLButtonElement),
  balance: element("mint-balance", HTMLElement),
  fees: element("mint-fees", HTMLElement),
  reserve: element("mint-reserve", HTMLElement),
  reserveDelta: element("mint-reserve-delta", HTMLElement),
  mintOne: element("mint-one", HTMLButtonElement),
  mintBurst: element("mint-burst", HTMLButtonElement),
  deskMessage: element("mint-desk-message", HTMLElement),
  taxon: element("mint-taxon", HTMLElement),
  galleryCount: element("mint-gallery-count", HTMLElement),
  gallery: element("mint-gallery", HTMLOListElement),
  abusePay: element("mint-abuse-pay", HTMLButtonElement),
  abuseBurn: element("mint-abuse-burn", HTMLButtonElement),
  abuseCount: element("mint-abuse-count", HTMLButtonElement),
  abuseDevice: element("mint-abuse-device", HTMLButtonElement),
  deviceCount: element("mint-device-count", HTMLElement),
  activity: element("mint-activity", HTMLOListElement),
  layers: {
    device: {
      box: element("mint-layer-device", HTMLElement),
      count: element("mint-layer-device-count", HTMLElement),
    },
    ledger: {
      box: element("mint-layer-ledger", HTMLElement),
      count: element("mint-layer-ledger-count", HTMLElement),
    },
  },
};

export type MessageTone = "info" | "ok" | "error";

export function showMessage(target: HTMLElement, text: string, tone: MessageTone): void {
  target.textContent = text;
  target.className = `message message-${tone}`;
}
