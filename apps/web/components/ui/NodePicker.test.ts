import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackendStatus } from "~/lib/boot";
import type { ProbeResult } from "~/lib/node-probe";
import type { Backend } from "~/lib/ports";
import { flushPromises, mountScreen } from "../screens/test-utils";
import HeaderStatus from "./HeaderStatus.vue";
import NodeDialog from "./NodeDialog.vue";
import NodePicker from "./NodePicker.vue";

const SIMULATED: BackendStatus = {
  requested: "simulated",
  active: "simulated",
  error: null,
  target: "",
};

function mountPicker(
  options: {
    status?: BackendStatus;
    probe?: (url: string) => Promise<ProbeResult>;
    noticeMs?: number;
    network?: { pageProtocol?: string };
  } = {},
) {
  const reload = vi.fn();
  const probe = vi.fn(options.probe ?? (async () => ({ ok: true, ledgerIndex: 42 }) as const));
  const mounted = mountScreen(NodePicker, {
    status: options.status ?? SIMULATED,
    props: { reload, probe, reloadDelayMs: 0, noticeMs: options.noticeMs ?? 12000 },
    ...(options.network === undefined ? {} : { network: options.network }),
  });
  const dialog = () => mounted.wrapper.findComponent(NodeDialog);
  return { ...mounted, reload, probe, dialog };
}

async function pick(wrapper: ReturnType<typeof mountPicker>["wrapper"], value: string) {
  await wrapper.get("[data-testid='node-select']").setValue(value);
  await flushPromises();
}

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("Node picker", () => {
  it("is one choice: Simulated, Local node, Team node, on the simulation by default", () => {
    const { wrapper } = mountPicker();
    expect(wrapper.findAll("option").map((o) => o.text())).toEqual([
      "Simulated",
      "Local node",
      "Team node",
    ]);
    const select = wrapper.get("[data-testid='node-select']").element as HTMLSelectElement;
    expect(select.value).toBe("simulated");
    expect(wrapper.find("[data-testid='node-target']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='node-notice']").exists()).toBe(false);
    // No URL field and no Use button in the header.
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Use");
  });

  it("opens the Local node dialog with the command and the URLs, and keeps the simulation meanwhile", async () => {
    const { wrapper, dialog, reload } = mountPicker();
    await pick(wrapper, "local");
    const select = wrapper.get("[data-testid='node-select']").element as HTMLSelectElement;
    expect(select.value).toBe("simulated");
    expect(dialog().exists()).toBe(true);
    expect(dialog().get("[data-testid='node-command']").text()).toContain(
      "GENESIS_SEED=… pnpm demo --no-web",
    );
    expect(dialog().get("[data-testid='node-url']").text()).toBe("ws://localhost:6006");
    expect(dialog().get("[data-testid='node-faucet']").text()).toBe(
      "http://localhost:3005/accounts",
    );
    expect(dialog().text()).toContain("nothing to type");
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem("carbs-node")).toBeNull();
  });

  it("connects, shows the ledger index, saves the choice and reloads on the node", async () => {
    const { wrapper, dialog, reload, probe } = mountPicker();
    await pick(wrapper, "local");
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(probe).toHaveBeenCalledWith("ws://localhost:6006");
    expect(dialog().get("[data-testid='node-status']").text()).toContain("Connected · ledger 42");
    expect(localStorage.getItem("carbs-node")).toBe("local");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says why it could not connect, keeps everything as it was, and retries", async () => {
    let answers = 0;
    const { wrapper, dialog, reload } = mountPicker({
      probe: async () =>
        (answers += 1) === 1
          ? { ok: false, reason: "ws://localhost:6006 did not answer within 8 s" }
          : { ok: true, ledgerIndex: 7 },
    });
    await pick(wrapper, "local");
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(dialog().get("[data-testid='node-status']").text()).toBe(
      "Could not connect: ws://localhost:6006 did not answer within 8 s",
    );
    expect(dialog().get("[data-testid='node-connect']").text()).toBe("Retry");
    expect(localStorage.getItem("carbs-node")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(dialog().get("[data-testid='node-status']").text()).toContain("ledger 7");
  });

  it("opens the Team node dialog on its preset, with no command and the tailnet note", async () => {
    const { wrapper, dialog, probe } = mountPicker();
    await pick(wrapper, "team");
    expect(dialog().get("[data-testid='node-url']").text()).toBe(
      "wss://debian-docker.tail8b5861.ts.net:9448",
    );
    expect(dialog().get("[data-testid='node-faucet']").text()).toBe(
      "https://debian-docker.tail8b5861.ts.net:9449/api/faucet",
    );
    expect(dialog().find("[data-testid='node-command']").exists()).toBe(false);
    expect(dialog().find("input").exists()).toBe(false);
    const note = dialog().get("[data-testid='team-note']").text();
    expect(note).toContain("tailnet");
    expect(note).toContain("secure DNS");
    expect(note).toContain("*.ts.net");
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(probe).toHaveBeenCalledWith("wss://debian-docker.tail8b5861.ts.net:9448");
    expect(localStorage.getItem("carbs-node")).toBe("team");
  });

  it("checks a custom URL as the page allows, before asking the node", async () => {
    const { wrapper, dialog, probe, ctx } = mountPicker({ network: { pageProtocol: "https:" } });
    await pick(wrapper, "local");
    const input = dialog().get("[data-testid='node-custom-url']");
    await input.setValue("ws://node.example.org:6006");
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(dialog().get("[data-testid='url-error']").text()).toContain("mixed content");
    expect(probe).not.toHaveBeenCalled();

    await input.setValue("ws://127.0.0.1:7006");
    expect(dialog().get("[data-testid='node-url']").text()).toBe("ws://127.0.0.1:7006");
    await dialog().get("[data-testid='node-connect']").trigger("click");
    await flushPromises();
    expect(dialog().find("[data-testid='url-error']").exists()).toBe(false);
    expect(probe).toHaveBeenCalledWith("ws://127.0.0.1:7006");
    // Kept by the network store (saved in the browser: network-store.test.ts).
    expect(ctx.network.state.localWss).toBe("ws://127.0.0.1:7006");
  });

  it("closes on Escape without changing anything and gives the focus back to the select", async () => {
    const { wrapper, dialog, reload } = mountPicker();
    await pick(wrapper, "local");
    expect(document.activeElement?.getAttribute("data-testid")).toBe("node-connect");
    await dialog().get("[data-testid='node-dialog']").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(dialog().exists()).toBe(false);
    expect(document.activeElement?.getAttribute("data-testid")).toBe("node-select");
    expect(reload).not.toHaveBeenCalled();
  });

  it("goes back to the simulation at once: saved, reloaded, no dialog", async () => {
    const { wrapper, dialog, reload } = mountPicker({
      status: { requested: "local", active: "local", error: null, target: "ws://localhost:6006" },
    });
    await pick(wrapper, "simulated");
    expect(dialog().exists()).toBe(false);
    expect(localStorage.getItem("carbs-node")).toBe("simulated");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("shows the live node in effect, whose URL opens its dialog", async () => {
    const { wrapper, dialog } = mountPicker({
      status: {
        requested: "team",
        active: "team",
        error: null,
        target: "wss://debian-docker.tail8b5861.ts.net:9448",
      },
    });
    const select = wrapper.get("[data-testid='node-select']").element as HTMLSelectElement;
    expect(select.value).toBe("team");
    const target = wrapper.get("[data-testid='node-target']");
    expect(target.text()).toBe("wss://debian-docker.tail8b5861.ts.net:9448");
    await target.trigger("click");
    expect(dialog().exists()).toBe(true);
    expect(dialog().get("h2").text()).toBe("Team node");
  });

  it("says once, for a while, why the chosen node was not reached", async () => {
    vi.useFakeTimers();
    const { wrapper } = mountPicker({
      noticeMs: 1000,
      status: {
        requested: "team",
        active: "simulated",
        error: "cannot connect to wss://debian-docker.tail8b5861.ts.net:9448",
        target: "wss://debian-docker.tail8b5861.ts.net:9448",
      },
    });
    expect(wrapper.get("[data-testid='node-notice']").text()).toBe(
      "Team node not reached, running on the simulation: cannot connect to wss://debian-docker.tail8b5861.ts.net:9448",
    );
    const select = wrapper.get("[data-testid='node-select']").element as HTMLSelectElement;
    expect(select.value).toBe("simulated");
    vi.advanceTimersByTime(1001);
    await flushPromises();
    expect(wrapper.find("[data-testid='node-notice']").exists()).toBe(false);
  });
});

describe("Header SIMULATED badge", () => {
  it("shows while the simulation is in effect", () => {
    const { wrapper } = mountScreen(HeaderStatus, { status: SIMULATED });
    expect(wrapper.find("[data-testid='sim-badge']").exists()).toBe(true);
  });

  it("shows after a refused live node, with the reason", () => {
    const { wrapper } = mountScreen(HeaderStatus, {
      status: { requested: "local", active: "simulated", error: "socket closed", target: "x" },
    });
    expect(wrapper.find("[data-testid='sim-badge']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='node-notice']").text()).toContain("socket closed");
  });

  it("is gone on a live node", () => {
    const mounted = mountScreen(HeaderStatus, {
      status: { requested: "local", active: "local", error: null, target: "ws://localhost:6006" },
    });
    const live = mountScreen(HeaderStatus, {
      status: { requested: "local", active: "local", error: null, target: "ws://localhost:6006" },
      backend: { ...mounted.ctx.backend, mode: "live" } as Backend,
    });
    expect(live.wrapper.find("[data-testid='sim-badge']").exists()).toBe(false);
    expect(live.wrapper.get("[data-testid='node-target']").text()).toBe("ws://localhost:6006");
  });
});
