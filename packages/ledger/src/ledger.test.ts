import { readFile } from "node:fs/promises";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { verify as keypairsVerify } from "ripple-keypairs";
import {
  addressFromPublicKey,
  bytesToHex,
  decodeTx,
  encodeForDevice,
  encodeTx,
  encodeForSigning,
  generateClassicSeed,
  hexToBytes,
  signTransaction,
  type TxJson,
} from "@carbs/sessions";
import { standaloneDefinitions } from "@carbs/sessions/testing";
import { describe, expect, it } from "vitest";
import {
  DeviceError,
  decodeApdu,
  dmkTransport,
  encodeApdu,
  encodeBip32Path,
  kCla,
  kInsPqSign,
  kSw,
  rawExchangeOf,
  rawTransport,
} from "./apdu.js";
import { DeviceContractError, signMlDsa } from "./commands.js";
import { formatDuration, formatXrp, parseScreenVector, reviewLines } from "./screen.js";
import { deviceClassicSigner, deviceMlDsaSigner } from "./signers.js";
import { SimulatedDevice } from "./simulated-device.js";
import { bip39Seed, deviceMlDsaSeed, slip21Node } from "./slip21.js";

const defs = standaloneDefinitions();
const vectors = new URL("../../../ledger-app/tests/standalone/testcases/", import.meta.url);
/** The address the app's own tests substitute for `OWN_ADDR`. */
const kOwnAddress = "rTooLkitCksh5mQa67eaa2JaWHDBnHkpy";
const kAnyKey = "03B41C770E3DE7B0DB75688B86BC574473CF4801990AB9A3F4EF74C02B56D45F55";
/** Speculos' default mnemonic, public on purpose (it is in Speculos' documentation). */
const kSpeculosMnemonic =
  "glory promote mansion idle axis finger extra february uncover one trip resource lawn turtle enact monster seven myth punch hobby comfort wild raise skin";

async function vector(
  name: string,
): Promise<{ tx: Record<string, unknown>; lines: ReturnType<typeof parseScreenVector> }> {
  const json = JSON.parse(await readFile(new URL(`${name}.json`, vectors), "utf8")) as Record<
    string,
    unknown
  >;
  for (const [k, v] of Object.entries(json)) {
    if (v === "OWN_ADDR") json[k] = kOwnAddress;
    if (v === "OWN_PUBKEY") json[k] = kAnyKey;
  }
  const lines = parseScreenVector(await readFile(new URL(`${name}.txt`, vectors), "utf8"));
  // The device sees bytes: go through the encoder, as the simulated device does.
  return { tx: decodeTx(encodeTx(json as TxJson, defs), defs), lines };
}

describe("review lines match the device track's frozen vectors", () => {
  const names = [
    "30-signing-session-set/01-mode-all",
    "30-signing-session-set/02-mode-permissions",
    "30-signing-session-set/03-mode-cap",
    "30-signing-session-set/04-ten-permissions",
    "30-signing-session-set/05-short-duration",
    "31-signing-session-delete/01-own-close",
    "31-signing-session-delete/02-expired-by-third-party",
    "02-set-regular-key/01-basic",
    "06-account-set/04-disable-master",
    "01-payment/01-basic",
  ];
  for (const name of names) {
    it(name, async () => {
      const { tx, lines } = await vector(name);
      const review = reviewLines(tx, defs);
      expect(review.kind).toBe("clear");
      expect(review.lines).toEqual(lines);
    });
  }

  it("formats durations and amounts like the device", () => {
    expect([600, 300, 60, 90, 45].map(formatDuration)).toEqual([
      "10 minutes",
      "5 minutes",
      "1 minute",
      "1 min 30 s",
      "45 s",
    ]);
    expect([formatXrp("12"), formatXrp("20000000"), formatXrp("1500000")]).toEqual([
      "XRP 0.000012",
      "XRP 20",
      "XRP 1.5",
    ]);
  });
});

describe("APDU encoding", () => {
  it("encodes the BIP32 path as the app parses it", () => {
    expect(bytesToHex(encodeBip32Path("44'/144'/0'/0/0"))).toBe(
      "058000002C80000090800000000000000000000000",
    );
    expect(() => encodeBip32Path("44'/x")).toThrow();
  });

  it("round-trips CLA INS P1 P2 Lc data and maps the DMK status code", async () => {
    const apdu = { cla: kCla, ins: kInsPqSign, p1: 0, p2: 1, data: Uint8Array.of(1, 2, 3) };
    expect(bytesToHex(encodeApdu(apdu))).toBe("E011000103010203");
    expect(decodeApdu(encodeApdu(apdu))).toEqual(apdu);
    const sent: Uint8Array[] = [];
    const transport = dmkTransport(
      {
        sendApdu: async ({ apdu: bytes }) => {
          sent.push(bytes);
          return { statusCode: Uint8Array.of(0x69, 0x85), data: new Uint8Array() };
        },
      },
      "session-1",
    );
    await expect(transport.exchange(apdu)).resolves.toEqual({
      data: new Uint8Array(),
      statusWord: kSw.denied,
    });
    expect(bytesToHex(sent[0] ?? new Uint8Array())).toBe("E011000103010203");
  });
});

function device(approve = true) {
  return new SimulatedDevice({
    defs,
    bip39Seed: bip39Seed(kSpeculosMnemonic),
    classicSeeds: {
      secp256k1: generateClassicSeed("ecdsa-secp256k1"),
      ed25519: generateClassicSeed("ed25519"),
    },
    approve: async () => approve,
  });
}

const sessionSet = (account: string): TxJson => ({
  TransactionType: "SigningSessionSet",
  Account: account,
  SessionKey: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  SessionDuration: 600,
  Flags: 0x00010000,
  Fee: "12",
  Sequence: 3,
  LastLedgerSequence: 300,
  NetworkID: 24100,
});

describe("SLIP-21", () => {
  it("matches the test vectors of SLIP-0021", () => {
    const seed = bip39Seed("all all all all all all all all all all all all");
    const key = (labels: string[]) => bytesToHex(slip21Node(seed, labels).slice(32)).toLowerCase();
    expect(key([])).toBe("dbf12b44133eaab506a740f6565cc117228cbf1dd70635cfa8ddfdc9af734756");
    expect(key(["SLIP-0021"])).toBe(
      "1d065e3ac1bbe5c7fad32cf2305f7d709dc070d672044a19e610c77cdf33de0d",
    );
    expect(key(["SLIP-0021", "Master encryption key"])).toBe(
      "ea163130e35bbafdf5ddee97a17b39cef2be4b4f390180d65b54cf05c6a82fde",
    );
    expect(key(["SLIP-0021", "Authentication key"])).toBe(
      "47194e938ab24cc82bfa25f6486ed54bebe79c40ae2a5a32ea6db294d81861a6",
    );
  });
});

describe("ML-DSA-44 root key through the contract (SIMULATED device)", () => {
  it('derives the key as the device does: SLIP-21 "carbs ML-DSA-44", last 32 bytes, KeyGen_internal', () => {
    const seed = deviceMlDsaSeed(bip39Seed(kSpeculosMnemonic));
    const { publicKey } = ml_dsa44.keygen(seed);
    // Vector for the device-track owner: compare with `INS 0x10` on Speculos (default seed).
    expect(bytesToHex(seed)).toBe(bytesToHex(deviceMlDsaSeed(bip39Seed(kSpeculosMnemonic))));
    // The vector of docs/device-contract.md (UNVERIFIED on a device until the owner compares it).
    expect(bytesToHex(sha256(publicKey))).toBe(
      "DDDC0737CF9BC347D07D45C562A355192DAA22CBCD5432F5FB8B40CD3525F948",
    );
    expect(addressFromPublicKey(publicKey)).toBe("rsr2Kobu5srdxbFTFhWnmTR5PPDZoZtTUi");
  });

  it("signs a SigningSessionSet: STX\\0 ‖ fields in, 2 420 bytes out, verified by @noble/post-quantum", async () => {
    const simulated = device();
    const signer = await deviceMlDsaSigner(simulated);
    expect(bytesToHex(signer.publicKey)).toBe(bytesToHex(simulated.mlDsaPublicKey));
    const account = addressFromPublicKey(kAnyKey);
    const signed = await signTransaction(sessionSet(account), signer, defs);
    const signature = hexToBytes(String(signed.tx["TxnSignature"]));
    expect(signature.length).toBe(2420);
    const data = encodeForSigning(signed.tx, defs);
    expect(ml_dsa44.verify(signature, data, signer.publicKey)).toBe(true);
    // The device reviewed exactly what it signed.
    expect(simulated.reviews.at(-1)?.lines.map((l) => l.label)).toEqual([
      "Transaction Type",
      "Account",
      "Session key",
      "Network ID",
      "Allows",
      "Valid for",
      "Fee",
      "Note",
    ]);
  });

  it("works over the device track's raw exchange shape (250-byte chunks for 0x11)", async () => {
    const simulated = device();
    const exchange = rawExchangeOf(simulated);
    // The device track's client sends 0x11 in 250-byte chunks; the app accepts up to 255.
    const tx = { ...sessionSet(kOwnAddress), SigningPubKey: bytesToHex(simulated.mlDsaPublicKey) };
    const message = encodeForSigning(tx, defs);
    for (let offset = 0; offset < message.length; offset += 250) {
      const last = offset + 250 >= message.length ? 1 : 0;
      const chunk = message.subarray(offset, offset + 250);
      const answer = await exchange(
        Uint8Array.of(0xe0, 0x11, offset === 0 ? 0 : 1, last, chunk.length, ...chunk),
      );
      expect(answer.status).toBe(kSw.ok);
    }
    const viaTransport = await deviceMlDsaSigner(rawTransport(exchange));
    expect(bytesToHex(viaTransport.publicKey)).toBe(bytesToHex(simulated.mlDsaPublicKey));
  });

  it("refuses without the prefix, above 2 048 bytes, and on denial", async () => {
    const simulated = device();
    const tx = { ...sessionSet(kOwnAddress), SigningPubKey: bytesToHex(simulated.mlDsaPublicKey) };
    await expect(signMlDsa(simulated, encodeForDevice(tx, defs))).rejects.toThrow(
      DeviceContractError,
    );
    const tooLong = new Uint8Array(2049);
    tooLong.set([0x53, 0x54, 0x58, 0x00]);
    await expect(signMlDsa(simulated, tooLong)).rejects.toThrow(/2048/);
    // The device's own answer to an oversized message, bypassing the client check.
    const chunk = { cla: kCla, ins: kInsPqSign, p2: 0, data: new Uint8Array(255) };
    let answer = await simulated.exchange({ ...chunk, p1: 0 });
    for (let i = 0; i < 8 && answer.statusWord === kSw.ok; i += 1)
      answer = await simulated.exchange({ ...chunk, p1: 1 });
    expect(answer.statusWord).toBe(kSw.wrongLength);
    await expect(signMlDsa(device(false), encodeForSigning(tx, defs))).rejects.toThrow(DeviceError);
  });
});

describe("classical keys through the contract (SIMULATED device)", () => {
  for (const curve of ["secp256k1", "ed25519"] as const) {
    it(`${curve}: the fields without STX\\0 go in, a signature the node accepts comes out`, async () => {
      const simulated = device();
      const signer = await deviceClassicSigner(simulated, "44'/144'/0'/0/0", curve);
      const account = addressFromPublicKey(signer.publicKey);
      // Ten permissions make the transaction longer than one APDU.
      const tx: TxJson = {
        ...sessionSet(account),
        Flags: 0,
        Permissions: [
          "Payment",
          "EscrowCreate",
          "EscrowFinish",
          "EscrowCancel",
          "OfferCreate",
          "OfferCancel",
          "TrustSet",
          "NFTokenCreateOffer",
          "TrustlineAuthorize",
          "PaymentMint",
        ].map((p) => ({ Permission: { PermissionValue: p } })),
      };
      delete tx["Flags"];
      // A memo makes the transaction longer than one APDU (255 bytes, the path included).
      tx["Memos"] = [{ Memo: { MemoData: "AB".repeat(120) } }];
      const signed = await signTransaction(tx, signer, defs);
      expect(
        encodeForDevice({ ...signed.tx, TxnSignature: undefined }, defs).length,
      ).toBeGreaterThan(255);
      const data = bytesToHex(encodeForSigning(signed.tx, defs));
      expect(
        keypairsVerify(data, String(signed.tx["TxnSignature"]), bytesToHex(signer.publicKey)),
      ).toBe(true);
      expect(
        simulated.reviews.at(-1)?.lines.filter((l) => l.label.startsWith("Allows [")).length,
      ).toBe(10);
    });
  }

  it("answers 0x6985 when the user rejects", async () => {
    const simulated = device(false);
    const signer = await deviceClassicSigner(simulated, "44'/144'/0'/0/0", "secp256k1");
    await expect(
      signTransaction(sessionSet(addressFromPublicKey(signer.publicKey)), signer, defs),
    ).rejects.toMatchObject({
      statusWord: kSw.denied,
    });
  });
});
