import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./bytes.js";
import { kTxSignPrefix } from "./constants.js";
import {
  decodeTx,
  EncodeError,
  encodeForDevice,
  encodeForSigning,
  encodeTx,
  transactionHash,
  type TxJson,
} from "./encode.js";
import {
  alphanetDefinitions,
  simulatedSessionDefinitions,
} from "./testing/simulated-definitions.js";

const defs = simulatedSessionDefinitions();

const payment: TxJson = {
  TransactionType: "Payment",
  Account: "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK",
  Destination: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  Amount: "1000000",
  Fee: "12",
  Sequence: 7,
  LastLedgerSequence: 500,
  SigningPubKey: "03B41C770E3DE7B0DB75688B86BC574473CF4801990AB9A3F4EF74C02B56D45F55",
};

describe("encoding", () => {
  it("prefixes the signing data with STX\\0 and leaves it out for the device", () => {
    const signing = encodeForSigning(payment, defs);
    expect(bytesToHex(signing.subarray(0, 4))).toBe(bytesToHex(kTxSignPrefix));
    expect(bytesToHex(signing.subarray(0, 4))).toBe("53545800");
    const device = encodeForDevice(payment, defs);
    expect(bytesToHex(device)).toBe(bytesToHex(signing.subarray(4)));
  });

  it("leaves non-signing fields out of the signing data and keeps them in the blob", () => {
    const signed = { ...payment, TxnSignature: "3045022100AA" };
    expect(bytesToHex(encodeForSigning(signed, defs))).toBe(
      bytesToHex(encodeForSigning(payment, defs)),
    );
    expect(encodeTx(signed, defs)).toContain("3045022100AA");
    expect(decodeTx(encodeTx(signed, defs), defs)).toMatchObject({ TxnSignature: "3045022100AA" });
  });

  it("refuses to give the device a transaction without SigningPubKey or with TxnSignature", () => {
    const { SigningPubKey: _omitted, ...noKey } = payment;
    expect(() => encodeForDevice(noKey as TxJson, defs)).toThrow(EncodeError);
    expect(() => encodeForDevice({ ...payment, TxnSignature: "00" }, defs)).toThrow(EncodeError);
  });

  it("encodes a SigningSessionSet with the field codes of section 6.1 (SIMULATED definitions)", () => {
    const tx: TxJson = {
      TransactionType: "SigningSessionSet",
      Account: payment.Account,
      SessionKey: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
      SessionDuration: 600,
      SessionCap: "20000000",
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: 10,
    };
    const hex = encodeTx(tx, defs);
    // TransactionType (UInt16, nth 2) = 130.
    expect(hex.startsWith("120082")).toBe(true);
    // SessionDuration: UInt32 (type 2), nth 114 → header 20 72, value 600.
    expect(hex).toContain("207200000258");
    // SessionKey: AccountID (type 8), nth 34 → header 80 22, then a 20-byte VL.
    expect(hex).toContain("802214");
    // SessionCap: Amount (type 6), nth 47 → header 60 2F.
    expect(hex).toContain("602F");
    expect(decodeTx(hex, defs)).toMatchObject({ SessionDuration: 600, SessionCap: "20000000" });
  });

  it("cannot encode a session type with the AlphaNet's own definitions", () => {
    expect(() =>
      encodeTx(
        { TransactionType: "SigningSessionSet", Account: payment.Account },
        alphanetDefinitions(),
      ),
    ).toThrow();
  });

  it("computes the transaction id as SHA512Half(TXN\\0 ‖ blob)", () => {
    // A mainnet Payment of ledger 107879416: `tx` on a public server finds it, validated, by this id.
    const blob =
      "12000024061EF51761400000000009033868400000000000000A73210298E594DF404C4C656FDF06A7267C76D09FA8A24BA8CEA18B35404EBCF8D83A767446304402204BBD8EFF3EC1BA1548B4A876F8F4EE06B2F8D1EA44573FC27BA78241C9F2309C022037C7D75BA6D5A15E9F7AB2C8D200EF215C23C5278570F7A2088BE90882F539F481140FF00A9E2FC30234B9AF7CE39FC237A1430F942D8314F12818BC9069AEF584597FFF5561FE0F003BB900";
    expect(transactionHash(blob)).toBe(
      "0E2D3DA2903722E1BA2FC164F5C67B732C9BBCB4365C64AD6419A657BC4D55FA",
    );
  });
});

/**
 * The device track's vectors (`ledger-app/tests/standalone/testcases/3x-*`): each `.raw` is what the
 * app receives, encoded with `ripple-binary-codec`. Our `encodeForDevice` must give the same bytes.
 */
describe("cross-check with the device track's vectors", async () => {
  const root = new URL("../../../ledger-app/tests/standalone/testcases/", import.meta.url);
  const valid = [
    "30-signing-session-set/01-mode-all",
    "30-signing-session-set/02-mode-permissions",
    "30-signing-session-set/03-mode-cap",
    "30-signing-session-set/04-ten-permissions",
    "30-signing-session-set/05-short-duration",
    "31-signing-session-delete/01-own-close",
    "31-signing-session-delete/02-expired-by-third-party",
  ];
  const listed = [
    ...(await readdir(new URL("30-signing-session-set/", root))),
    ...(await readdir(new URL("31-signing-session-delete/", root))),
  ];
  expect(listed.length).toBeGreaterThan(0);

  for (const name of valid) {
    it(`encodes ${name} byte for byte`, async () => {
      const json = JSON.parse(await readFile(new URL(`${name}.json`, root), "utf8")) as TxJson;
      const raw = new Uint8Array(await readFile(new URL(`${name}.raw`, root)));
      expect(bytesToHex(encodeForDevice(json, defs))).toBe(bytesToHex(raw));
      expect(hexToBytes(bytesToHex(raw))).toEqual(raw);
    });
  }
});
