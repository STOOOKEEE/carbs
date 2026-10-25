// The elements of dex.html.

import { element } from "../../dom.ts";

export const ui = {
  connection: element("dex-connection", HTMLElement),
  ownerLabel: element("dex-owner-label", HTMLElement),
  book: {
    asks: element("dex-asks", HTMLOListElement),
    bids: element("dex-bids", HTMLOListElement),
    reference: element("dex-reference", HTMLElement),
    takerBuy: element("dex-taker-buy", HTMLButtonElement),
    takerSell: element("dex-taker-sell", HTMLButtonElement),
  },
  session: {
    agentId: element("dex-agent-id", HTMLElement),
    txCount: element("dex-tx-count", HTMLElement),
    maxTxCount: element("dex-max-tx-count", HTMLElement),
    gaugeFill: element("dex-gauge-fill", HTMLElement),
    countdown: element("dex-countdown", HTMLElement),
    spent: element("dex-spent", HTMLElement),
    permissions: element("dex-permissions", HTMLElement),
    state: element("dex-session-state", HTMLElement),
    honestLimits: element("dex-honest-limits", HTMLElement),
  },
  controls: {
    ownerStatus: element("dex-owner-status", HTMLElement),
    useStax: element("dex-use-stax", HTMLButtonElement),
    usePasskey: element("dex-use-passkey", HTMLButtonElement),
    open: element("dex-open", HTMLButtonElement),
    abusePayment: element("dex-abuse-payment", HTMLButtonElement),
    abuseTrustSet: element("dex-abuse-trustset", HTMLButtonElement),
    abuseDevice: element("dex-abuse-device", HTMLButtonElement),
    close: element("dex-close", HTMLButtonElement),
    activity: element("dex-activity", HTMLOListElement),
  },
  layers: {
    device: {
      box: element("dex-layer-device", HTMLElement),
      count: element("dex-layer-device-count", HTMLElement),
    },
    ledger: {
      box: element("dex-layer-ledger", HTMLElement),
      count: element("dex-layer-ledger-count", HTMLElement),
    },
  },
};
