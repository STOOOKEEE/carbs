import { describe, expect, it } from "vitest";
import { flushPromises, mountScreen } from "../screens/test-utils";
import NetworkSelector from "./NetworkSelector.vue";

describe("Network selector", () => {
  it("offers AlphaNet and Local node, defaults to AlphaNet and shows its node", () => {
    const { wrapper } = mountScreen(NetworkSelector);
    const options = wrapper.findAll("option").map((o) => o.text());
    expect(options).toEqual(["AlphaNet", "Local node"]);
    expect(wrapper.get("[data-testid='network-wss']").text()).toBe("wss://alphanet.xrpl.org");
  });

  it("shows the local node URL form and explains the https rule", async () => {
    const { wrapper, ctx } = mountScreen(NetworkSelector);
    await wrapper.get("[data-testid='network-select']").setValue("local");
    expect(ctx.network.selected().id).toBe("local");
    expect(wrapper.get("[data-testid='local-node-form']").text()).toContain("wss:// and https://");
  });

  it("refuses a ws:// URL on an https page and says why", async () => {
    const { wrapper } = mountScreen(NetworkSelector, { network: { pageProtocol: "https:" } });
    await wrapper.get("[data-testid='network-select']").setValue("local");
    await wrapper.get("[data-testid='local-url']").setValue("ws://node.example.org:6006");
    await wrapper.get("[data-testid='local-node-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[data-testid='url-error']").text()).toContain("mixed content");
    await wrapper.get("[data-testid='local-url']").setValue("wss://node.example.org:6006");
    await wrapper.get("[data-testid='local-node-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[data-testid='url-error']").exists()).toBe(false);
  });
});
