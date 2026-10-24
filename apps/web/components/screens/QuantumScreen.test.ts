import {
  addressFromPublicKey,
  bytesToHex,
  classicSignerFromSeed,
  generateClassicSeed,
} from "@carbs/sessions";
import {
  RecordedNode,
  alphanetServerDefinitions,
  type RecordedCall,
} from "@carbs/sessions/testing";
import { describe, expect, it, vi } from "vitest";
import { FakeAlphaNet } from "~/lib/live/fake-alphanet";
import QuantumScreen from "./QuantumScreen.vue";
import { flushPromises, mountScreen } from "./test-utils";

describe("Quantum screen", () => {
  it.each([
    ["exposed-master", "Exposed"],
    ["never-signed", "No exposure found"],
    ["partial-history", "Unknown"],
    ["regular-key", "Exposed"],
    ["multisig", "Exposed"],
  ])("reports %s as %s, labelled SIMULATED", async (fixture, status) => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='source-simulated']").setValue(true);
    await wrapper.get(`[data-testid='fixture-${fixture}']`).trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='status']").text()).toBe(status);
    expect(wrapper.find("[data-testid='report'] [data-testid='sim-badge']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='coverage']").text().length).toBeGreaterThan(0);
  });

  it("names the transaction that first revealed the master key", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='source-simulated']").setValue(true);
    await wrapper.get("[data-testid='fixture-exposed-master']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='reason-master']").text()).toContain("first revealed in");
  });

  it("checks a pasted address", async () => {
    const { wrapper, ctx } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='source-simulated']").setValue(true);
    const address = ctx.backend.fixtures.find((f) => f.id === "never-signed")?.address ?? "";
    await wrapper.get("[data-testid='address-input']").setValue(address);
    await wrapper.get("[data-testid='exposure-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[data-testid='status']").text()).toBe("No exposure found");
  });

  it("is read-only on mainnet: no migration", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='source-simulated']").setValue(true);
    await wrapper.get("[data-testid='network']").setValue("mainnet");
    expect(wrapper.get("[data-testid='read-only']").text()).toContain("read-only");
    expect(wrapper.find("[data-testid='migration-start']").exists()).toBe(false);
  });

  it("migrates a fresh account in the required order and refuses step 3 until it is safe", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='source-simulated']").setValue(true);
    await wrapper.get("[data-testid='migration-start']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='migration-address']").text()).toMatch(/^rSim/);

    await wrapper.get("[data-testid='run-step-2']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='refusal-2']").text()).toContain(
      "Step 1 must be accepted first",
    );

    await wrapper.get("[data-testid='run-step-1']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='run-step-3']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='refusal-3']").text()).toContain(
      "the proof transaction was not accepted",
    );

    await wrapper.get("[data-testid='run-step-2']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='run-step-3']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='refusal-3']").text()).toContain("not proven recoverable");

    await wrapper.get("[data-testid='prove-recoverable']").trigger("click");
    await wrapper.get("[data-testid='reviewed']").setValue(true);
    await flushPromises();
    await wrapper.get("[data-testid='run-step-3']").trigger("click");
    await flushPromises();
    const codes = wrapper
      .findAll("[data-testid='migration'] [data-testid='result-code']")
      .map((n) => n.text());
    expect(codes).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
    expect(wrapper.get("[data-testid='after']").text()).toContain("No exposure found");
  });
});

/** A node that answers like the real one for one account, recorded by hand (no network). */
function nodeFor(address: string, txs: Record<string, unknown>[], created: boolean): RecordedNode {
  const calls: RecordedCall[] = [
    { method: "server_definitions", params: {}, result: alphanetServerDefinitions() },
    {
      method: "account_info",
      params: { account: address, ledger_index: "validated" },
      result: {
        account_data: {
          Account: address,
          Flags: 0,
          Sequence: 5,
          Balance: "100000000",
          OwnerCount: 0,
        },
      },
    },
    {
      method: "account_tx",
      params: {
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        forward: true,
        limit: 200,
      },
      result: {
        account: address,
        ledger_index_min: 1,
        ledger_index_max: 1000,
        validated: true,
        transactions: txs.map((tx, index) => ({
          hash: `${"AB".repeat(31)}${String(index).padStart(2, "0")}`,
          ledger_index: 10 + index,
          validated: true,
          tx_json: tx,
          meta: {
            TransactionResult: "tesSUCCESS",
            AffectedNodes:
              created && index === 0
                ? [
                    {
                      CreatedNode: {
                        LedgerEntryType: "AccountRoot",
                        NewFields: { Account: address },
                      },
                    },
                  ]
                : [],
          },
        })),
      },
    },
    ...["passkey_list", "beneficiary", "delegate", "signer_list"].map((type): RecordedCall => ({
      method: "account_objects",
      params: { account: address, ledger_index: "validated", type },
      result: { account: address, account_objects: [] },
    })),
  ];
  return new RecordedNode(calls);
}

describe("Quantum screen, live source", () => {
  const signer = classicSignerFromSeed(generateClassicSeed());
  const address = addressFromPublicKey(signer.publicKey);

  async function checkLive(txs: Record<string, unknown>[], created: boolean, network = "alphanet") {
    const urls: string[] = [];
    const node = nodeFor(address, txs, created);
    const mounted = mountScreen(QuantumScreen, {
      clientFactory: (url) => {
        urls.push(url);
        return node;
      },
    });
    await mounted.wrapper.get("[data-testid='network']").setValue(network);
    await mounted.wrapper.get("[data-testid='address-input']").setValue(address);
    await mounted.wrapper.get("[data-testid='exposure-form']").trigger("submit");
    await flushPromises();
    return { ...mounted, node, urls };
  }

  const creation = {
    TransactionType: "Payment",
    Account: "rFunderFunderFunderFunderFunder",
    Destination: address,
    Amount: "100000000",
    SigningPubKey: "02".padEnd(66, "1"),
  };
  const signedByMaster = {
    TransactionType: "AccountSet",
    Account: address,
    SigningPubKey: bytesToHex(signer.publicKey),
  };

  it("is the default source and reads the real node, not the fixtures", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    expect((wrapper.get("[data-testid='source-live']").element as HTMLInputElement).checked).toBe(
      true,
    );
    expect(wrapper.find("[data-testid='fixture-exposed-master']").exists()).toBe(false);
  });

  it("reports an account whose master key has signed as exposed, from the node's history, not SIMULATED", async () => {
    const { wrapper, node, urls } = await checkLive([creation, signedByMaster], true);
    expect(wrapper.get("[data-testid='status']").text()).toBe("Exposed");
    expect(wrapper.get("[data-testid='reason-master']").text()).toContain("first revealed in");
    expect(wrapper.find("[data-testid='report'] [data-testid='sim-badge']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='coverage']").text()).toContain("ledgers 1 to 1000");
    expect(urls).toEqual(["https://rpc.alphanet.xrpl.org"]);
    // Read-only: public query methods only, never submit or sign.
    const methods = new Set(node.requests.map((r) => r.split(" ")[0]));
    expect([...methods].sort()).toEqual([
      "account_info",
      "account_objects",
      "account_tx",
      "server_definitions",
    ]);
  });

  it("reports a funded account that never signed as no exposure found", async () => {
    const { wrapper } = await checkLive([creation], true);
    expect(wrapper.get("[data-testid='status']").text()).toBe("No exposure found");
  });

  it("says unknown, not safe, when the node's history does not reach the creation", async () => {
    const { wrapper } = await checkLive([signedByMaster].slice(1), false);
    expect(wrapper.get("[data-testid='status']").text()).toBe("Unknown");
    expect(wrapper.get("[data-testid='coverage']").text()).toContain("does not reach");
  });

  it("reads mainnet from its own node and offers no migration there", async () => {
    const { wrapper, urls } = await checkLive([creation, signedByMaster], true, "mainnet");
    expect(urls).toEqual(["https://xrplcluster.com"]);
    expect(wrapper.get("[data-testid='status']").text()).toBe("Exposed");
    expect(wrapper.find("[data-testid='migration-start']").exists()).toBe(false);
  });

  it("shows the error when the node cannot be reached", async () => {
    const mounted = mountScreen(QuantumScreen, {
      clientFactory: () => ({
        async request() {
          throw new Error("cannot connect");
        },
      }),
    });
    await mounted.wrapper.get("[data-testid='address-input']").setValue(address);
    await mounted.wrapper.get("[data-testid='exposure-form']").trigger("submit");
    await flushPromises();
    expect(mounted.wrapper.text()).toContain("cannot connect");
  });
});

describe("Quantum screen, live migration (AlphaNet double, SIMULATED device)", () => {
  function liveScreen() {
    const fake = new FakeAlphaNet();
    const mounted = mountScreen(QuantumScreen, { clientFactory: () => fake, fetcher: fake.faucet });
    return { ...mounted, fake };
  }

  it("says that the device is simulated and the node is real", () => {
    const { wrapper } = liveScreen();
    expect(wrapper.get("[data-testid='live-note']").text()).toContain("device simulated");
    expect(wrapper.get("[data-testid='live-note']").text()).toContain("node real");
  });

  it("migrates a fresh account on the node, with explorer links, the seed backup and the safety refusals", async () => {
    const { wrapper, fake, ctx } = liveScreen();
    const idle = () =>
      vi.waitFor(() => expect(ctx.liveMigration.state.busy).toBe(false), { timeout: 15000 });
    const click = async (id: string) => {
      await wrapper.get(`[data-testid='${id}']`).trigger("click");
      await flushPromises();
      await idle();
      await flushPromises();
    };
    await click("migration-start");
    const address = wrapper.get("[data-testid='migration-address']").text();
    expect(address).toMatch(/^r/);
    expect(wrapper.get("[data-testid='account-link']").attributes("href")).toBe(
      `https://alphanet.xrpl.org/accounts/${address}`,
    );

    await click("run-step-1");
    await click("run-step-2");
    await click("run-step-3");
    expect(wrapper.get("[data-testid='refusal-3']").text()).toContain("not proven recoverable");

    await click("prove-recoverable");
    expect(wrapper.get("[data-testid='recovery-seed']").text()).toMatch(/^[0-9A-F]{128}$/);
    await wrapper.get("[data-testid='seed-saved']").setValue(true);
    await wrapper.get("[data-testid='reviewed']").setValue(true);
    await click("run-step-3");

    const links = wrapper.findAll("[data-testid='migration'] [data-testid='explorer-link']");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.attributes("href")).toMatch(
        /^https:\/\/alphanet\.xrpl\.org\/transactions\/[0-9A-F]{64}$/,
      );
    }
    const codes = wrapper
      .findAll("[data-testid='migration'] [data-testid='result-code']")
      .map((n) => n.text());
    expect(codes).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
    expect(wrapper.get("[data-testid='after']").text()).toContain("No exposure found");
    expect(fake.accounts.get(address)?.masterDisabled).toBe(true);
    // The results are the node's: no SIMULATED badge on them, only on the device.
    expect(
      wrapper.findAll("[data-testid='migration'] [data-testid='result'] [data-testid='sim-badge']"),
    ).toHaveLength(0);
  });
});
