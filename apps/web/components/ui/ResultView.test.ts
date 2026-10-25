import { describe, expect, it } from "vitest";
import { NETWORKS, type AppNetwork } from "~/lib/networks";
import type { Backend, NodeResult } from "~/lib/ports";
import { mountScreen } from "../screens/test-utils";
import ResultView from "./ResultView.vue";

const HASH = "AB".repeat(32);

const result = (overrides: Partial<NodeResult> = {}): NodeResult => ({
  code: "tesSUCCESS",
  family: "tes",
  success: true,
  feeClaimed: true,
  final: true,
  hash: HASH,
  ledgerIndex: 12,
  ...overrides,
});

/** The simulated backend with a node that says it is on `network`, as a live node would. */
function liveOn(network: AppNetwork | null): Backend {
  const { ctx } = mountScreen(ResultView, { props: { result: result(), simulated: false } });
  return {
    ...ctx.backend,
    mode: "live",
    node: { ...ctx.backend.node, explorerNetwork: () => network },
  } as Backend;
}

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
    const own: AppNetwork = { ...NETWORKS.local, explorer: "https://explorer.local.example" };
    const { wrapper } = mountScreen(ResultView, {
      props: { result: result(), simulated: false },
      backend: liveOn(own),
    });
    // ... and the link still points at the node's own explorer.
    expect(wrapper.get("[data-testid='explorer-link']").attributes("href")).toBe(
      `https://explorer.local.example/transactions/${HASH}`,
    );
  });

  it("links a real AlphaNet transaction in a new tab, keeping the short hash", () => {
    const { wrapper } = mountScreen(ResultView, {
      props: { result: result(), simulated: false, network: NETWORKS.alphanet },
    });
    const link = wrapper.get("[data-testid='explorer-link']");
    expect(link.attributes("href")).toBe(
      `https://custom.xrpl.org/alphanet.xrpl.org/transactions/${HASH}`,
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    expect(link.text()).toBe(`${HASH.slice(0, 10)}…${HASH.slice(-10)}`);
  });

  it("leaves a SIMULATED hash, a refusal and the local node's hash as plain text", () => {
    const cases = [
      { props: { result: result(), simulated: true, network: NETWORKS.alphanet } },
      {
        props: {
          result: result({
            code: "tefSESSION_LIMIT",
            family: "tef",
            success: false,
            feeClaimed: false,
          }),
          simulated: false,
          network: NETWORKS.alphanet,
        },
      },
      { props: { result: result(), simulated: false }, backend: liveOn(NETWORKS.local) },
    ];
    for (const options of cases) {
      const { wrapper } = mountScreen(ResultView, options);
      expect(wrapper.find("[data-testid='explorer-link']").exists()).toBe(false);
      expect(wrapper.find("a").exists()).toBe(false);
      expect(wrapper.text()).toContain(HASH.slice(0, 10));
    }
  });
});
