import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import Silk from "./Silk.vue";

describe("Silk", () => {
  it("draws nothing, without failing, when WebGL2 is missing", () => {
    const wrapper = mount(Silk, { props: { color: "#6a4cf0" } });
    expect(wrapper.find("canvas").exists()).toBe(true);
    expect(wrapper.get(".silk-container").attributes("aria-hidden")).toBe("true");
    wrapper.unmount();
  });
});
