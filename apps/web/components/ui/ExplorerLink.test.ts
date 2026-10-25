import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { NETWORKS, type AppNetwork } from "~/lib/networks";
import ExplorerLink from "./ExplorerLink.vue";
import LinkedText from "./LinkedText.vue";

/** The genesis account: a real classic address. */
const ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const HASH = "238EA325".padEnd(64, "0A");

describe("Explorer link", () => {
  it("links a real AlphaNet hash to its transaction page, in a new tab", () => {
    const wrapper = mount(ExplorerLink, {
      props: { kind: "tx", value: HASH, network: NETWORKS.alphanet, text: "238EA325…" },
    });
    const link = wrapper.get("a");
    expect(link.attributes("href")).toBe(
      `https://custom.xrpl.org/alphanet.xrpl.org/transactions/${HASH}`,
    );
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toBe("noopener noreferrer");
    expect(link.classes()).toContain("explorer-link");
    expect(link.attributes("data-testid")).toBe("explorer-link");
    expect(link.text()).toBe("238EA325…");
    expect(link.attributes("title")).toContain(HASH);
  });

  it("links a mainnet account to its page on livenet.xrpl.org", () => {
    const wrapper = mount(ExplorerLink, {
      props: { kind: "account", value: ACCOUNT, network: NETWORKS.mainnet },
    });
    expect(wrapper.get("[data-testid='account-link']").attributes("href")).toBe(
      `https://livenet.xrpl.org/accounts/${ACCOUNT}`,
    );
    expect(wrapper.text()).toBe(ACCOUNT);
  });

  it("leaves a SIMULATED value as plain text, even on a network with an explorer", () => {
    const wrapper = mount(ExplorerLink, {
      props: { kind: "tx", value: HASH, network: NETWORKS.alphanet, simulated: true },
    });
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toBe(HASH);
  });

  it("leaves plain the local node's values, and anything that is not a real address", () => {
    const cases: { value: string; network: AppNetwork | null }[] = [
      { value: ACCOUNT, network: NETWORKS.local },
      { value: ACCOUNT, network: null },
      { value: "rSimSimulatedAddress123456789", network: NETWORKS.alphanet },
    ];
    for (const props of cases) {
      const wrapper = mount(ExplorerLink, { props: { kind: "account", ...props } });
      expect(wrapper.find("a").exists()).toBe(false);
      expect(wrapper.text()).toBe(props.value);
    }
  });

  it("lets the caller name the link for its tests", () => {
    const wrapper = mount(ExplorerLink, {
      props: { kind: "account", value: ACCOUNT, network: NETWORKS.alphanet },
      attrs: { "data-testid": "report-account-link" },
    });
    expect(wrapper.get("a").attributes("data-testid")).toBe("report-account-link");
  });
});

describe("Linked text", () => {
  it("links the real addresses and hashes a sentence names, and keeps the rest as it is", () => {
    const text = `regular-key ${ACCOUNT} is exposed, first in ${HASH}.`;
    const wrapper = mount(LinkedText, { props: { text, network: NETWORKS.mainnet } });
    expect(wrapper.text()).toBe(text);
    const links = wrapper.findAll("a").map((link) => link.attributes("href"));
    expect(links).toEqual([
      `https://livenet.xrpl.org/accounts/${ACCOUNT}`,
      `https://livenet.xrpl.org/transactions/${HASH}`,
    ]);
  });

  it("links nothing in a SIMULATED sentence", () => {
    const text = `regular-key ${ACCOUNT} is exposed`;
    const wrapper = mount(LinkedText, {
      props: { text, network: NETWORKS.alphanet, simulated: true },
    });
    expect(wrapper.find("a").exists()).toBe(false);
    expect(wrapper.text()).toBe(text);
  });
});
