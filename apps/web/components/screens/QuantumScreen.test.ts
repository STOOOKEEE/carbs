import { describe, expect, it } from "vitest";
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
    await wrapper.get(`[data-testid='fixture-${fixture}']`).trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='status']").text()).toBe(status);
    expect(wrapper.find("[data-testid='report'] [data-testid='sim-badge']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='coverage']").text().length).toBeGreaterThan(0);
  });

  it("names the transaction that first revealed the master key", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='fixture-exposed-master']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='reason-master']").text()).toContain("first revealed in");
  });

  it("checks a pasted address", async () => {
    const { wrapper, ctx } = mountScreen(QuantumScreen);
    const address = ctx.backend.fixtures.find((f) => f.id === "never-signed")?.address ?? "";
    await wrapper.get("[data-testid='address-input']").setValue(address);
    await wrapper.get("[data-testid='exposure-form']").trigger("submit");
    await flushPromises();
    expect(wrapper.get("[data-testid='status']").text()).toBe("No exposure found");
  });

  it("is read-only on mainnet: no migration", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
    await wrapper.get("[data-testid='network']").setValue("mainnet");
    expect(wrapper.get("[data-testid='read-only']").text()).toContain("read-only");
    expect(wrapper.find("[data-testid='migration-start']").exists()).toBe(false);
  });

  it("migrates a fresh account in the required order and refuses step 3 until it is safe", async () => {
    const { wrapper } = mountScreen(QuantumScreen);
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
