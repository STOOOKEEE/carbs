import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import RubberSegment from "./RubberSegment.vue";

const ITEMS = [
  { value: "account", label: "Account" },
  { value: "session", label: "Session" },
  { value: "actions", label: "Actions" },
];

function tap(wrapper: ReturnType<typeof mount>, testId: string): void {
  const button = wrapper.get(`[data-testid='${testId}']`);
  const init = { pointerId: 1, button: 0, clientX: 0, bubbles: true };
  button.element.dispatchEvent(new PointerEvent("pointerdown", init));
  button.element.dispatchEvent(new PointerEvent("pointerup", init));
}

describe("Rubber segment", () => {
  it("is a radio group with the selected slot checked", () => {
    const wrapper = mount(RubberSegment, {
      props: { items: ITEMS, modelValue: "session", ariaLabel: "Screens" },
    });
    expect(wrapper.get("[role='radiogroup']").attributes("aria-label")).toBe("Screens");
    const checked = wrapper.findAll("[role='radio']").map((el) => el.attributes("aria-checked"));
    expect(checked).toEqual(["false", "true", "false"]);
    wrapper.unmount();
  });

  it("selects nothing, and hides the thumb, when the value is not an item (the landing page)", () => {
    const wrapper = mount(RubberSegment, { props: { items: ITEMS, modelValue: "" } });
    const checked = wrapper.findAll("[role='radio']").map((el) => el.attributes("aria-checked"));
    expect(checked).toEqual(["false", "false", "false"]);
    expect(wrapper.get(".rubber-segment").attributes("data-empty")).toBeDefined();
    expect(wrapper.findAll("[tabindex='0']")).toHaveLength(1);
    wrapper.unmount();
  });

  it("emits the new value when another slot is tapped", () => {
    const wrapper = mount(RubberSegment, { props: { items: ITEMS, modelValue: "account" } });
    tap(wrapper, "segment-actions");
    expect(wrapper.emitted("update:modelValue")).toEqual([["actions"]]);
    expect(wrapper.emitted("change")).toEqual([["actions", 2]]);
    wrapper.unmount();
  });

  it("does not emit when the selected slot is tapped again", () => {
    const wrapper = mount(RubberSegment, { props: { items: ITEMS, modelValue: "account" } });
    tap(wrapper, "segment-account");
    expect(wrapper.emitted("change")).toBeUndefined();
    wrapper.unmount();
  });

  it("moves with the arrow keys and stops at the ends", async () => {
    const wrapper = mount(RubberSegment, { props: { items: ITEMS, modelValue: "account" } });
    const first = wrapper.get("[data-testid='segment-account']");
    await first.trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("change")).toEqual([["session", 1]]);
    await first.trigger("keydown", { key: "ArrowLeft" });
    expect(wrapper.emitted("change")).toHaveLength(1);
    wrapper.unmount();
  });

  it("ignores input when disabled", () => {
    const wrapper = mount(RubberSegment, {
      props: { items: ITEMS, modelValue: "account", disabled: true },
    });
    tap(wrapper, "segment-session");
    expect(wrapper.emitted("change")).toBeUndefined();
    wrapper.unmount();
  });
});
