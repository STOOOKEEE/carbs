import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendStatus } from "~/lib/boot";
import { BACKEND_STATUS_KEY } from "~/lib/context";
import BackendSwitch from "./BackendSwitch.vue";

function mountSwitch(status: BackendStatus, reload = vi.fn()) {
  const wrapper = mount(BackendSwitch, {
    props: { reload },
    global: { plugins: [(app) => app.provide(BACKEND_STATUS_KEY, status)] },
  });
  return { wrapper, reload };
}

afterEach(() => localStorage.clear());

describe("Backend switch", () => {
  it("offers the simulation and the live node", () => {
    const { wrapper } = mountSwitch({
      requested: "simulated",
      active: "simulated",
      error: null,
      target: "ws://localhost:6006",
    });
    expect(wrapper.findAll("option").map((o) => o.text())).toEqual([
      "Simulated",
      "Live (local node)",
    ]);
    expect(wrapper.find("[data-testid='backend-error']").exists()).toBe(false);
  });

  it("saves the choice and reloads the page", async () => {
    const { wrapper, reload } = mountSwitch({
      requested: "simulated",
      active: "simulated",
      error: null,
      target: "x",
    });
    await wrapper.get("[data-testid='backend-select']").setValue("live");
    expect(localStorage.getItem("carbs-backend")).toBe("live");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says which node is live", () => {
    const { wrapper } = mountSwitch({
      requested: "live",
      active: "live",
      error: null,
      target: "ws://localhost:6006",
    });
    expect(wrapper.get("[data-testid='backend-live']").text()).toContain("ws://localhost:6006");
  });

  it("says why it stays on the simulation", () => {
    const { wrapper } = mountSwitch({
      requested: "live",
      active: "simulated",
      error: "cannot connect",
      target: "x",
    });
    expect(wrapper.get("[data-testid='backend-error']").text()).toContain(
      "Staying on the simulation: cannot connect",
    );
  });
});
