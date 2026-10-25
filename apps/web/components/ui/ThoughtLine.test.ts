import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ThoughtLine from "./ThoughtLine.vue";

describe("Thought line", () => {
  it("shows the working label with the steps taken, the last one current", () => {
    const wrapper = mount(ThoughtLine, {
      props: { working: true, label: "Waiting for the node…", steps: ["Fund", "Sign"] },
    });
    expect(wrapper.text()).toContain("Waiting for the node…");
    const steps = wrapper.findAll(".thought-line__step");
    expect(steps.map((el) => el.attributes("data-done") !== undefined)).toEqual([true, false]);
    wrapper.unmount();
  });

  it("settles into the done label and reports the time once", async () => {
    const wrapper = mount(ThoughtLine, {
      props: { working: true, doneLabel: "Done in", steps: ["Fund"] },
    });
    await wrapper.setProps({ working: false });
    await flushPromises();
    expect(wrapper.get(".thought-line__text--done").attributes("data-active")).toBeDefined();
    expect(wrapper.get("[role='status']").text()).toMatch(/^Done in \d+\.\d seconds$/);
    expect(wrapper.emitted("settle")).toHaveLength(1);
    expect(wrapper.findAll(".thought-line__step[data-done]")).toHaveLength(1);
    wrapper.unmount();
  });

  it("folds the trace when it settles and opens again on a new run", async () => {
    const wrapper = mount(ThoughtLine, { props: { working: true, steps: ["Fund"] } });
    expect(wrapper.get(".thought-line").attributes("data-open")).toBeDefined();
    await wrapper.setProps({ working: false });
    expect(wrapper.get(".thought-line").attributes("data-open")).toBeUndefined();
    await wrapper.setProps({ working: true });
    expect(wrapper.get(".thought-line").attributes("data-open")).toBeDefined();
    wrapper.unmount();
  });

  it("is a toggle only when there is a trace to show", async () => {
    const wrapper = mount(ThoughtLine, { props: { working: false, steps: ["Fund"] } });
    const head = wrapper.get(".thought-line__head");
    expect(head.attributes("aria-expanded")).toBe("false");
    await head.trigger("click");
    expect(head.attributes("aria-expanded")).toBe("true");
    await wrapper.setProps({ steps: [] });
    expect(wrapper.get(".thought-line__head").attributes("aria-expanded")).toBeUndefined();
    wrapper.unmount();
  });
});
