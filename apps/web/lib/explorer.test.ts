import { describe, expect, it } from "vitest";
import { explorerLink, explorerSegments } from "./explorer";
import { NETWORKS } from "./networks";

/** The genesis account: a real classic address. */
const ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const HASH = "238EA325".padEnd(64, "0A");

describe("explorer links", () => {
  it("opens an AlphaNet account or transaction on the custom-network XRPL Explorer", () => {
    expect(explorerLink(NETWORKS.alphanet, "account", ACCOUNT)).toBe(
      `https://custom.xrpl.org/alphanet.xrpl.org/accounts/${ACCOUNT}`,
    );
    expect(explorerLink(NETWORKS.alphanet, "tx", HASH)).toBe(
      `https://custom.xrpl.org/alphanet.xrpl.org/transactions/${HASH}`,
    );
  });

  it("opens a mainnet account or transaction on livenet.xrpl.org", () => {
    expect(explorerLink(NETWORKS.mainnet, "account", ACCOUNT)).toBe(
      `https://livenet.xrpl.org/accounts/${ACCOUNT}`,
    );
    expect(explorerLink(NETWORKS.mainnet, "tx", HASH)).toBe(
      `https://livenet.xrpl.org/transactions/${HASH}`,
    );
  });

  it("gives no link without a network or for the local node, which has no public explorer", () => {
    expect(explorerLink(null, "tx", HASH)).toBeNull();
    expect(explorerLink(NETWORKS.local, "tx", HASH)).toBeNull();
    expect(explorerLink(NETWORKS.local, "account", ACCOUNT)).toBeNull();
  });

  it("links only a real address or hash of the kind asked", () => {
    for (const value of [
      "ABC",
      "rX",
      "rFunderFunderFunderFunderFunder", // the shape of an address, not its checksum
      `${HASH}/../accounts`,
      HASH.slice(1),
    ]) {
      expect(explorerLink(NETWORKS.alphanet, "tx", value), value).toBeNull();
      expect(explorerLink(NETWORKS.alphanet, "account", value), value).toBeNull();
    }
    expect(explorerLink(NETWORKS.alphanet, "account", HASH)).toBeNull();
    expect(explorerLink(NETWORKS.alphanet, "tx", ACCOUNT)).toBeNull();
  });
});

describe("addresses and hashes named in a sentence", () => {
  it("cuts a sentence around the real addresses and hashes it names", () => {
    const text = `regular-key ${ACCOUNT} is exposed, first in ${HASH}.`;
    const segments = explorerSegments(text);
    expect(segments).toEqual([
      { text: "regular-key ", kind: null },
      { text: ACCOUNT, kind: "account" },
      { text: " is exposed, first in ", kind: null },
      { text: HASH, kind: "tx" },
      { text: ".", kind: null },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("leaves plain a sentence with nothing real in it", () => {
    for (const text of [
      "The master key has not signed any transaction in the history searched.",
      "account rFunderFunderFunderFunderFunder not found on this node",
      `a seed ${HASH}${HASH} is not a hash`,
      "",
    ]) {
      const segments = explorerSegments(text);
      expect(
        segments.every((segment) => segment.kind === null),
        text,
      ).toBe(true);
      expect(segments.map((segment) => segment.text).join("")).toBe(text);
    }
  });
});
