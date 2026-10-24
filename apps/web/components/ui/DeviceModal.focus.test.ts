import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mountScreen } from "../screens/test-utils";
import DeviceModal from "./DeviceModal.vue";

const review = {
  title: "Close session?",
  lines: [{ label: "Fee", value: "12 drops" }],
  simulated: true,
};

describe("Device modal, keyboard", () => {
  async function shown() {
    const mounted = mountScreen(DeviceModal, { autoApprove: false });
    const outcome = mounted.ctx.prompt.approver(review);
    await flushPromises();
    await nextTick();
    return { ...mounted, outcome };
  }

  it("moves the focus to Approve when it opens", async () => {
    const { wrapper } = await shown();
    expect(wrapper.find("[data-testid='device-modal']").exists()).toBe(true);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("device-approve");
    wrapper.unmount();
  });

  it("rejects on Escape", async () => {
    const { wrapper, outcome } = await shown();
    await wrapper.get("[data-testid='device-modal']").trigger("keydown", { key: "Escape" });
    await expect(outcome).resolves.toBe(false);
    wrapper.unmount();
  });
});
