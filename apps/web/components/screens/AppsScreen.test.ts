import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPS_URL, LIVE_APPS } from "~/lib/live-apps";
import AppsScreen from "./AppsScreen.vue";
import { flushPromises, mountScreen } from "./test-utils";

const BASE = "https://apps.example.org";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Apps screen", () => {
  it("has a card per app, each opening its page on the team's server in a new tab", () => {
    const { wrapper } = mountScreen(AppsScreen, { props: { appsUrl: BASE } });
    expect(wrapper.findAll("article")).toHaveLength(LIVE_APPS.length);
    for (const app of LIVE_APPS) {
      const link = wrapper.get(`[data-testid='open-${app.id}']`);
      expect(link.attributes("href")).toBe(`${BASE}/${app.page}`);
      expect(link.attributes("target")).toBe("_blank");
      expect(link.attributes("rel")).toBe("noopener noreferrer");
      expect(wrapper.get(`[data-testid='app-${app.id}']`).text()).toContain(app.name);
    }
  });

  it("shows the session each app opens, as the Stax review lists it", () => {
    const { wrapper } = mountScreen(AppsScreen, { props: { appsUrl: BASE } });
    const game = wrapper.get("[data-testid='app-game']");
    expect(game.get("[data-testid='mode']").text()).toBe(
      "Mode C, a spending cap; Stax profile Game (memo carbs-profile).",
    );
    const rows = game.get("[data-testid='stax-rows']").text();
    for (const text of ["Profile", "Game", "Max transactions", "300", "XRP 5", "XRP 0.1"]) {
      expect(rows).toContain(text);
    }
    expect(rows).toContain("10 minutes");
    const trading = wrapper.get("[data-testid='app-trading'] [data-testid='stax-rows']").text();
    expect(trading).toContain("OfferCreate");
    expect(trading).toContain("OfferCancel");
    // The agent's opening names no profile and sets no count: the Stax shows neither row.
    const agent = wrapper.get("[data-testid='app-agent'] [data-testid='stax-rows']").text();
    expect(agent).not.toContain("Profile");
    expect(agent).not.toContain("Max transactions");
    expect(agent).toContain("XRP 20");
  });

  it("names what each layer refuses, with the ledger's code or the Stax's status word", () => {
    const { wrapper } = mountScreen(AppsScreen, { props: { appsUrl: BASE } });
    const codes = (id: string) =>
      wrapper
        .findAll(`[data-testid='app-${id}'] [data-testid='refusal-code']`)
        .map((n) => n.text());
    expect(codes("game")).toEqual([
      "tefSESSION_LIMIT",
      "tefSESSION_LIMIT",
      "tefSESSION_EXPIRED",
      "0x6986",
    ]);
    expect(codes("minting")).toContain("tefSESSION_TX_NOT_ALLOWED");
    expect(codes("wallet")).toContain("tefSESSION_NO_WITNESS");
    const device = wrapper.get("[data-testid='app-streaming'] .chip-device");
    expect(device.text()).toBe("0x6986");
  });

  it("says the apps need the team's node and network, and checks nothing itself", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    const { wrapper } = mountScreen(AppsScreen, { props: { appsUrl: DEFAULT_APPS_URL } });
    await flushPromises();
    const note = wrapper.get("[data-testid='apps-note']").text();
    expect(note).toContain(DEFAULT_APPS_URL);
    expect(note).toContain("reachable");
    expect(note).toContain("does not check");
    // Links are navigation: the screen sends no request to the team's server.
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows no link when the configured address cannot be used", () => {
    const { wrapper } = mountScreen(AppsScreen, { props: { appsUrl: null } });
    expect(wrapper.find("[data-testid='apps-url-unusable']").exists()).toBe(true);
    expect(wrapper.findAll("a")).toHaveLength(0);
    expect(wrapper.findAll("article")).toHaveLength(LIVE_APPS.length);
  });
});
