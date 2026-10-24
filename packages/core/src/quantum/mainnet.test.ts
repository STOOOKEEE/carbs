/**
 * Spike K7 replayed: answers of a public mainnet full-history server (`xrplcluster.com`, ledgers
 * 32570 onward), recorded read-only by `spikes/k7-mainnet.ts` at ledger 107879672.
 */

import { describe, expect, it } from "vitest";
import { parseDefinitions } from "../definitions.js";
import { RecordedNode, type RecordedCall } from "../testing/recorded-node.js";
import { checkExposure } from "./exposure.js";
import mainnetDefinitions from "./fixtures/mainnet-server-definitions.json" with { type: "json" };
import exposed from "./fixtures/mainnet-exposed.json" with { type: "json" };
import safe from "./fixtures/mainnet-safe.json" with { type: "json" };

const defs = parseDefinitions(mainnetDefinitions, { requireSessions: false });
const options = { pageSize: 10, pageLimit: 3, subCheckPageLimit: 1 };

function replay(recording: { calls: unknown[] }): RecordedNode {
  // The recording holds the node's answers as they came; RecordedNode replays them.
  return new RecordedNode(recording.calls as RecordedCall[]);
}

describe("K7 on mainnet (recorded, read-only)", () => {
  it("finds the first self-signed transaction of a known-exposed account", async () => {
    const report = await checkExposure(exposed.address, replay(exposed), defs, options);
    expect(report.status).toBe("exposed");
    const master = report.findings.find((f) => f.role === "master");
    expect(master).toMatchObject({ status: "exposed", active: true, keyType: "secp256k1" });
    expect(master?.firstReveal?.hash).toBe(
      "5773874D4E9E6DC8C8756EAC2B30DCBC860113EA20FE5EB29CEFC84025E581FE",
    );
    expect(report.coverage).toMatchObject({
      ledgerIndexMin: 32570,
      creationFound: true,
      truncated: true,
    });
  });

  it("confirms an account that never sent returns no exposure", async () => {
    const report = await checkExposure(safe.address, replay(safe), defs, options);
    expect(report.status).toBe("no-exposure-found");
    expect(report.coverage).toMatchObject({
      creationFound: true,
      truncated: false,
      transactionsScanned: 1,
    });
  });

  it("says unknown, not found within N pages, when the same account is searched with a smaller bound", async () => {
    const calls = (safe.calls as RecordedCall[]).map((call) =>
      call.method === "account_tx" && call.result !== undefined
        ? { ...call, result: { ...(call.result as object), marker: { cut: true } } }
        : call,
    );
    const report = await checkExposure(safe.address, new RecordedNode(calls), defs, {
      ...options,
      pageLimit: 1,
    });
    expect(report.status).toBe("unknown");
    expect(report.reasons.join(" ")).toMatch(/not found within 1 pages of 10 transactions/);
  });

  it("asks mainnet only for entry types its definitions list", () => {
    expect(defs.raw.LEDGER_ENTRY_TYPES["PasskeyList"]).toBeUndefined();
    const asked = (exposed.calls as RecordedCall[])
      .filter((c) => c.method === "account_objects")
      .map((c) => c.params["type"]);
    expect(asked).toEqual(["delegate", "signer_list"]);
  });
});
