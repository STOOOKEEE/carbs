import { describe, expect, it } from "vitest";
import { DefinitionsError, missingSessionNames, parseDefinitions } from "./definitions.js";
import { loadDefinitions } from "./definitions.js";
import { RecordedNode } from "./testing/recorded-node.js";
import {
  alphanetServerDefinitions,
  simulatedSessionDefinitions,
  simulatedSessionServerDefinitions,
} from "./testing/simulated-definitions.js";

describe("definitions from server_definitions", () => {
  it("reads the recorded public AlphaNet answer and finds no SigningSessions names in it", () => {
    const raw = alphanetServerDefinitions();
    expect(raw.hash).toBe("34614C84ACCFD2AB3BB9C0813F69F963DE7A587609BAD2FEAB562DA45D69C3C5");
    expect(missingSessionNames(raw)).toEqual([
      "transaction type SigningSessionSet",
      "transaction type SigningSessionDelete",
      "field SessionKey",
      "field SessionCap",
      "field SessionSpent",
      "field SessionDuration",
      "ledger entry type SigningSession",
      "result code tefSESSION_EXPIRED",
      "result code tefSESSION_LIMIT",
      "result code tefSESSION_TX_NOT_ALLOWED",
      "flag SigningSessionSet.tfAllTransactions",
    ]);
    const defs = parseDefinitions(raw, { requireSessions: false });
    expect(defs.hasSessions).toBe(false);
    expect(defs.transactionType("PasskeyListSet")).toBe(raw.TRANSACTION_TYPES["PasskeyListSet"]);
    expect(defs.accountSetFlag("asfDisableMaster")).toBe(
      raw.ACCOUNT_SET_FLAGS?.["asfDisableMaster"],
    );
  });

  it("refuses definitions without sessions unless asked not to", () => {
    expect(() => parseDefinitions(alphanetServerDefinitions())).toThrow(
      /does not serve SigningSessions/,
    );
  });

  it("refuses an answer that only carries hash", () => {
    expect(() => parseDefinitions({ hash: "AB", status: "success" })).toThrow(/only `hash`/);
  });

  it("refuses malformed answers", () => {
    const raw = alphanetServerDefinitions();
    expect(() => parseDefinitions({ ...raw, FIELDS: [["X", { nth: "1" }]] })).toThrow(
      DefinitionsError,
    );
    expect(() => parseDefinitions({ ...raw, TRANSACTION_TYPES: { Payment: "0" } })).toThrow(
      DefinitionsError,
    );
    expect(() => parseDefinitions(null)).toThrow(DefinitionsError);
  });

  it("serves the session codes from the SIMULATED definitions, every lookup by name", () => {
    const defs = simulatedSessionDefinitions();
    expect(defs.hasSessions).toBe(true);
    expect(defs.transactionType("SigningSessionSet")).toBe(130);
    expect(defs.transactionType("SigningSessionDelete")).toBe(131);
    expect(defs.transactionFlag("SigningSessionSet", "tfAllTransactions")).toBe(0x00010000);
    const tefFirewall = defs.resultCode("tefFIREWALL_BLOCK");
    expect(defs.resultCode("tefSESSION_EXPIRED")).toBe(tefFirewall + 1);
    expect(defs.resultCode("tefSESSION_LIMIT")).toBe(tefFirewall + 2);
    expect(defs.resultCode("tefSESSION_TX_NOT_ALLOWED")).toBe(tefFirewall + 3);
    expect(defs.resultName(tefFirewall + 3)).toBe("tefSESSION_TX_NOT_ALLOWED");
    expect(() => defs.transactionType("NoSuchType")).toThrow(/unknown transaction type/);
  });

  it("matches every number the device track uses (ledger-app/src/xrp/signing_session.h)", async () => {
    const { readFile } = await import("node:fs/promises");
    const header = await readFile(
      new URL("../../../ledger-app/src/xrp/signing_session.h", import.meta.url),
      "utf8",
    );
    const define = (name: string) => {
      const match = new RegExp(`#define\\s+${name}\\s+(0x[0-9A-Fa-f]+u?|\\d+)`).exec(header);
      if (!match?.[1]) throw new Error(`${name} not in signing_session.h`);
      return Number.parseInt(match[1].replace(/u$/, ""), match[1].startsWith("0x") ? 16 : 10);
    };
    const raw = simulatedSessionServerDefinitions();
    const nth = (name: string) => raw.FIELDS.find(([n]) => n === name)?.[1].nth;
    expect(raw.TRANSACTION_TYPES["SigningSessionSet"]).toBe(
      define("TRANSACTION_SIGNING_SESSION_SET"),
    );
    expect(raw.TRANSACTION_TYPES["SigningSessionDelete"]).toBe(
      define("TRANSACTION_SIGNING_SESSION_DELETE"),
    );
    expect(nth("SessionKey")).toBe(define("XRP_ACCOUNT_SESSION_KEY"));
    expect(nth("SessionCap")).toBe(define("XRP_UINT64_SESSION_CAP"));
    expect(nth("SessionDuration")).toBe(define("XRP_UINT32_SESSION_DURATION"));
    expect(nth("PermissionValue")).toBe(define("XRP_UINT32_PERMISSION_VALUE"));
    expect(nth("Permissions")).toBe(define("XRP_STARRAY_PERMISSIONS"));
    expect(nth("Permission")).toBe(define("XRP_STOBJECT_PERMISSION"));
    expect(raw.TRANSACTION_FLAGS?.["SigningSessionSet"]?.["tfAllTransactions"]).toBe(
      define("TF_ALL_TRANSACTIONS"),
    );
  });

  it("loads from a node", async () => {
    const node = new RecordedNode([
      { method: "server_definitions", params: {}, result: simulatedSessionServerDefinitions() },
    ]);
    const defs = await loadDefinitions(node);
    expect(defs.hasSessions).toBe(true);
  });
});
