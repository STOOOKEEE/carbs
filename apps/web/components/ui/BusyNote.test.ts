import { describe, expect, it } from "vitest";
import { mountScreen } from "../screens/test-utils";
import BusyNote from "./BusyNote.vue";

describe("Busy note", () => {
  it("is silent when idle", () => {
    const { wrapper } = mountScreen(BusyNote, { props: { busy: false } });
    expect(wrapper.find("[data-testid='busy']").exists()).toBe(false);
  });

  it("says it is working on the simulation", () => {
    const { wrapper } = mountScreen(BusyNote, { props: { busy: true } });
    expect(wrapper.get("[data-testid='busy']").text()).toBe("Working…");
  });
});
