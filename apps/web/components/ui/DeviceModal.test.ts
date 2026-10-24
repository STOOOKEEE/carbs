import { describe, expect, it } from "vitest";
import { flushPromises, mountScreen } from "../screens/test-utils";
import DeviceModal from "./DeviceModal.vue";

describe("Device modal", () => {
  it("shows the review lines of the simulated device and resolves on Approve", async () => {
    const { wrapper, ctx } = mountScreen(DeviceModal, { autoApprove: false });
    ctx.sim.simDevice.setApprover(ctx.prompt.approver);
    const signing = ctx.backend.device.signTransaction("secp256k1", {
      TransactionType: "SigningSessionDelete",
      Account: "rSimAccount",
      SessionKey: "rSimKey",
      Fee: "12",
    });
    await flushPromises();
    expect(wrapper.get("[data-testid='device-modal']").text()).toContain("Close session");
    expect(wrapper.find("[data-testid='device-modal'] [data-testid='sim-badge']").exists()).toBe(
      true,
    );
    await wrapper.get("[data-testid='device-approve']").trigger("click");
    const signed = await signing;
    expect(signed.TxnSignature).toBeDefined();
    await flushPromises();
    expect(wrapper.find("[data-testid='device-modal']").exists()).toBe(false);
  });

  it("rejects without signing", async () => {
    const { wrapper, ctx } = mountScreen(DeviceModal, { autoApprove: false });
    ctx.sim.simDevice.setApprover(ctx.prompt.approver);
    const signing = ctx.backend.device.signTransaction("secp256k1", {
      TransactionType: "Payment",
      Account: "rSimAccount",
      Destination: "rSimDest",
      Amount: "1000000",
      Fee: "12",
    });
    await flushPromises();
    await wrapper.get("[data-testid='device-reject']").trigger("click");
    await expect(signing).rejects.toThrow("Rejected on the device");
  });
});
