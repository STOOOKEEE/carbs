import { describe, expect, it } from "vitest";
import type { Backend, NodeResult } from "~/lib/ports";
import { mountScreen } from "../screens/test-utils";
import ResultView from "./ResultView.vue";

const result = (overrides: Partial<NodeResult> = {}): NodeResult => ({
  code: "tesSUCCESS",
  family: "tes",
  success: true,
  feeClaimed: true,
  final: true,
  hash: "AB".repeat(32),
  ledgerIndex: 12,
  ...overrides,
});

describe("Result view", () => {
  it("says when an answer is preliminary", () => {
    const { wrapper } = mountScreen(ResultView, {
      props: {
        result: result({ success: false, feeClaimed: false, final: false }),
        simulated: false,
      },
    });
    expect(wrapper.get("[data-testid='not-final']").text()).toContain("not validated");
  });

  it("is silent about validation for a final answer", () => {
    const { wrapper } = mountScreen(ResultView, { props: { result: result(), simulated: false } });
    expect(wrapper.find("[data-testid='not-final']").exists()).toBe(false);
  });

  it("links a live transaction to the explorer of the node it was sent to, not of the header's network", () => {
    const { ctx } = mountScreen(ResultView, { props: { result: result(), simulated: false } });
    ctx.network.select("alphanet"); // the header says AlphaNet...
    const live = {
      ...ctx.backend,
      mode: "live",
      node: {
        ...ctx.backend.node,
        explorerUrl: (hash: string) => `https://explorer.local.example/tx/${hash}`,
      },
    } as Backend;
    const { wrapper } = mountScreen(ResultView, {
      props: { result: result(), simulated: false },
      backend: live,
    });
    // ... and the link still points at the node's own explorer.
    expect(wrapper.get("[data-testid='explorer-link']").attributes("href")).toBe(
      `https://explorer.local.example/tx/${"AB".repeat(32)}`,
    );
  });
});
