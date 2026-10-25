import { readFile } from "node:fs/promises";
import {
  addressFromPublicKey,
  bytesToHex,
  decodeTx,
  generateClassicSeed,
  parseDefinitions,
  signTransaction,
  type BytesSigner,
  type TxJson,
} from "@carbs/sessions";
import { simulatedSessionServerDefinitions } from "@carbs/sessions/testing";
import { describe, expect, it } from "vitest";
import { agentIdOf } from "./agent-id.js";
import {
  DeviceError,
  deviceErrorKind,
  kCla,
  kInsGetSessionPolicy,
  kInsSign,
  kSw,
  type Apdu,
  type ApduTransport,
} from "./apdu.js";
import { describeLedgerError } from "./ledger-error.js";
import { parseScreenVector, reviewLines } from "./screen.js";
import {
  encodeSessionPolicy,
  getSessionPolicy,
  kSessionPolicyOff,
  parseSessionPolicy,
  SessionPolicyError,
  type SessionPolicy,
} from "./session-policy.js";
import { sessionPolicyRefusal } from "./session-policy-check.js";
import { deviceClassicSigner, deviceMlDsaSigner } from "./signers.js";
import { SimulatedDevice } from "./simulated-device.js";
import { bip39Seed } from "./slip21.js";

/**
 * SIMULATED definitions: the recorded standalone node does not know `SessionMaxPerTx`,
 * `SessionWitness` nor `SessionMaxTxCount` (rippled `sfields.macro`, UINT32 115).
 */
const defs = (() => {
  const server = simulatedSessionServerDefinitions();
  server.FIELDS.push([
    "SessionMaxTxCount",
    { nth: 115, isVLEncoded: false, isSerialized: true, isSigningField: true, type: "UInt32" },
  ]);
  return parseDefinitions(server);
})();
/** Speculos' default mnemonic, public on purpose (it is in Speculos' documentation). */
const kSpeculosMnemonic =
  "glory promote mansion idle axis finger extra february uncover one trip resource lawn turtle enact monster seven myth punch hobby comfort wild raise skin";
const kSessionKey = "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy";
const kWitness = "rHFqnKBYeky5tuRySHP4EzKoK5Xn2xZyYU";
const kAnyKey = "03B41C770E3DE7B0DB75688B86BC574473CF4801990AB9A3F4EF74C02B56D45F55";
const kAllTransactions = 0x00010000;
const kXrp = 1_000_000n;

/** The demo policy: mode C only, XRP 50 at most, XRP 10 per payment, 10 minutes. */
const kDemoPolicy: SessionPolicy = {
  ...kSessionPolicyOff,
  enabled: true,
  maxCapDrops: 50n * kXrp,
  maxPerTxDrops: 10n * kXrp,
  maxDurationSeconds: 600,
};

const capSession = (account: string, capXrp: bigint): TxJson => ({
  TransactionType: "SigningSessionSet",
  Account: account,
  SessionKey: kSessionKey,
  SessionDuration: 300,
  SessionCap: (capXrp * kXrp).toString(),
  SessionMaxPerTx: (5n * kXrp).toString(),
  Fee: "12",
  Sequence: 3,
  LastLedgerSequence: 300,
  NetworkID: 24100,
});

function device(sessionPolicy?: SessionPolicy) {
  const approvals: string[] = [];
  const simulated = new SimulatedDevice({
    defs,
    bip39Seed: bip39Seed(kSpeculosMnemonic),
    classicSeeds: {
      secp256k1: generateClassicSeed("ecdsa-secp256k1"),
      ed25519: generateClassicSeed("ed25519"),
    },
    approve: async (_review, kind) => {
      approvals.push(kind);
      return true;
    },
    ...(sessionPolicy ? { sessionPolicy } : {}),
  });
  return { simulated, approvals };
}

/** Both signing paths, with the account each key signs for. */
async function signers(
  simulated: SimulatedDevice,
): Promise<{ signer: BytesSigner; account: string }[]> {
  const classic = await deviceClassicSigner(simulated, "44'/144'/0'/0/0", "secp256k1");
  const mlDsa = await deviceMlDsaSigner(simulated);
  return [
    { signer: classic, account: addressFromPublicKey(classic.publicKey) },
    // The ML-DSA root signs for a migrated account, whose address comes from its first key.
    { signer: mlDsa, account: addressFromPublicKey(kAnyKey) },
  ];
}

describe("Agent ID", () => {
  it("is the first 4 bytes of the AccountID, uppercase hex, as XXXX-XXXX", () => {
    // docs/device-contract.md section 6 and the device vectors.
    expect(agentIdOf(kSessionKey)).toBe("A1E8-094F");
    expect(agentIdOf(kWitness)).toBe("B88D-B176");
  });

  it("refuses something that is not a classic address", () => {
    expect(() => agentIdOf("not-an-address")).toThrow();
  });
});

/** Big-endian bytes, as the device writes them. */
const be32 = (value: number) => [
  value >>> 24,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const be64 = (value: bigint) => [
  ...be32(Number(value >> 32n)),
  ...be32(Number(value & 0xffffffffn)),
];

/** The profiles of a fresh install, as `session_policy_serialize` writes them. */
const kFreshProfiles = [
  5,
  ...[0, 1, 0x01, ...be64(50n * kXrp), ...be64(5n * kXrp), ...be32(180), ...be32(20), 0],
  ...[1, 1, 0x01, ...be64(5n * kXrp), ...be64(100_000n), ...be32(600), ...be32(500), 0],
  ...[2, 1, 0x04, ...be64(0n), ...be64(0n), ...be32(600), ...be32(200), 2, ...be32(8), ...be32(9)],
  ...[3, 1, 0x01, ...be64(2n * kXrp), ...be64(10_000n), ...be32(600), ...be32(1000), 0],
  ...[4, 1, 0x04, ...be64(0n), ...be64(0n), ...be32(600), ...be32(100), 1, ...be32(26)],
];

describe("INS 0x08: session policy", () => {
  it("reads the fresh install answer as the policy off, every profile on", () => {
    const fresh = Uint8Array.of(2, ...new Uint8Array(21), ...kFreshProfiles);
    expect(fresh.length).toBe(175);
    expect(parseSessionPolicy(fresh)).toEqual(kSessionPolicyOff);
    expect(encodeSessionPolicy(kSessionPolicyOff)).toEqual(fresh);
  });

  it("reads the flags, the big-endian limits and each profile", () => {
    const bytes = Uint8Array.of(
      2,
      0x0f,
      ...[0, 0, 0, 0, 0x02, 0xfa, 0xf0, 0x80], // 50 000 000 drops
      ...[0, 0, 0, 0, 0, 0x98, 0x96, 0x80], // 10 000 000 drops
      ...[0, 0, 0x02, 0x58], // 600 s
      ...kFreshProfiles,
    );
    // The game profile turned off and its max transactions moved to 1000 on the device
    const game = 23 + 28;
    bytes[game + 1] = 0;
    bytes.set(be32(1000), game + 23);
    const policy = parseSessionPolicy(bytes);
    expect(policy).toEqual({
      ...kSessionPolicyOff,
      enabled: true,
      allowAll: true,
      allowPermissions: true,
      requireWitness: true,
      maxCapDrops: 50_000_000n,
      maxPerTxDrops: 10_000_000n,
      maxDurationSeconds: 600,
      profiles: kSessionPolicyOff.profiles.map((profile) =>
        profile.name === "game" ? { ...profile, enabled: false, maxTxCount: 1000 } : profile,
      ),
    });
    expect(policy.profiles[2]).toEqual({
      name: "trading",
      enabled: true,
      modes: ["permissions"],
      maxCapDrops: null,
      maxPerTxDrops: null,
      maxDurationSeconds: 600,
      maxTxCount: 200,
      permissions: [8, 9],
    });
    expect(encodeSessionPolicy(policy)).toEqual(bytes);
  });

  it("refuses a version 1 answer, a truncated one and trailing bytes", () => {
    // What a device without profiles answers: 22 bytes, version 1
    expect(() => parseSessionPolicy(Uint8Array.of(1, ...new Uint8Array(21)))).toThrow(
      /format 1 is not supported \(expected 2\)/,
    );
    expect(() => parseSessionPolicy(new Uint8Array())).toThrow(SessionPolicyError);
    const fresh = encodeSessionPolicy(kSessionPolicyOff);
    expect(() => parseSessionPolicy(fresh.subarray(0, 22))).toThrow(/at least 23 bytes/);
    expect(() => parseSessionPolicy(fresh.subarray(0, fresh.length - 1))).toThrow(
      /truncated in profile 4/,
    );
    expect(() => parseSessionPolicy(Uint8Array.of(...fresh, 0))).toThrow(/1 bytes after/);
  });

  it("refuses to store a limit of 0 (it would mean no limit)", () => {
    expect(() => encodeSessionPolicy({ ...kDemoPolicy, maxCapDrops: 0n })).toThrow(RangeError);
    const { simulated } = device();
    expect(() => {
      simulated.sessionPolicy = { ...kDemoPolicy, maxDurationSeconds: 0 };
    }).toThrow(RangeError);
    expect(simulated.sessionPolicy).toEqual(kSessionPolicyOff);
  });

  it("sends E0 08 00 00 with no data", async () => {
    const sent: Apdu[] = [];
    const transport: ApduTransport = {
      async exchange(apdu) {
        sent.push(apdu);
        return { data: encodeSessionPolicy(kDemoPolicy), statusWord: kSw.ok };
      },
    };
    await expect(getSessionPolicy(transport)).resolves.toEqual(kDemoPolicy);
    expect(sent).toEqual([
      { cla: kCla, ins: kInsGetSessionPolicy, p1: 0, p2: 0, data: new Uint8Array() },
    ]);
  });

  it("is off on the simulated device by default, and answers the configured policy", async () => {
    await expect(getSessionPolicy(device().simulated)).resolves.toEqual(kSessionPolicyOff);
    const { simulated } = device(kDemoPolicy);
    await expect(getSessionPolicy(simulated)).resolves.toEqual(kDemoPolicy);
    const wrongP1 = { cla: kCla, ins: kInsGetSessionPolicy, p1: 1, p2: 0, data: new Uint8Array() };
    await expect(simulated.exchange(wrongP1)).resolves.toMatchObject({ statusWord: kSw.wrongP1P2 });
  });
});

describe("session status words", () => {
  it("map 0x6986 and 0x6815 to typed kinds and readable messages", () => {
    expect(deviceErrorKind(0x6986)).toBe("sessionPolicyRefused");
    expect(deviceErrorKind(0x6815)).toBe("sessionBlindRefused");
    expect(deviceErrorKind(0x6801)).toBe("parseError");
    const policy = new DeviceError(kSw.sessionPolicyRefused, kInsSign);
    expect(policy.kind).toBe("sessionPolicyRefused");
    expect(describeLedgerError(policy)).toBe(
      "blocked by your session policy on the device (0x6986)",
    );
    const blind = new DeviceError(kSw.sessionBlindRefused, kInsSign);
    expect(blind.kind).toBe("sessionBlindRefused");
    expect(describeLedgerError(blind)).toBe(
      "session transactions are never blind-signed: the device cannot show this one in clear (0x6815)",
    );
    // A DMK error carries the status word as hex text.
    expect(describeLedgerError({ _tag: "UnknownDeviceExchangeError", errorCode: "6986" })).toBe(
      "blocked by your session policy on the device (0x6986)",
    );
  });
});

describe("the simulated device applies the session rules on both paths (SIMULATED)", () => {
  it("refuses a session above the policy with 0x6986, before any review", async () => {
    const { simulated, approvals } = device(kDemoPolicy);
    for (const { signer, account } of await signers(simulated)) {
      await expect(signTransaction(capSession(account, 500n), signer, defs)).rejects.toMatchObject({
        statusWord: kSw.sessionPolicyRefused,
        kind: "sessionPolicyRefused",
      });
    }
    expect(simulated.refusals).toEqual([
      "Blocked by your session policy: Max spend XRP 500 is above XRP 50",
      "Blocked by your session policy: Max spend XRP 500 is above XRP 50",
    ]);
    expect(simulated.reviews).toEqual([]);
    expect(approvals).toEqual([]);
  });

  it("shows the review of a session within the policy, Agent ID after the session key", async () => {
    const { simulated, approvals } = device(kDemoPolicy);
    for (const { signer, account } of await signers(simulated)) {
      const signed = await signTransaction(
        { ...capSession(account, 40n), SessionWitness: kWitness },
        signer,
        defs,
      );
      expect(signed.tx["TxnSignature"]).toBeDefined();
      expect(simulated.reviews.at(-1)).toEqual({
        kind: "clear",
        lines: [
          { label: "Transaction Type", value: "Open session" },
          { label: "Account", value: account },
          { label: "Session key", value: kSessionKey },
          { label: "Agent ID", value: "A1E8-094F" },
          { label: "Network ID", value: "24100" },
          { label: "Valid for", value: "5 minutes" },
          { label: "Fee", value: "XRP 0.000012" },
          { label: "Max spend", value: "XRP 40" },
          { label: "Max per payment", value: "XRP 5" },
          { label: "Witness", value: kWitness },
          { label: "Allows", value: "XRP payments only, fees included" },
          { label: "Note", value: "Cannot change keys or signers" },
        ],
      });
    }
    expect(approvals).toEqual(["classic", "ml-dsa"]);
    expect(simulated.refusals).toEqual([]);
  });

  it("does not check anything while the policy is off", async () => {
    const { simulated } = device();
    for (const { signer, account } of await signers(simulated)) {
      await expect(signTransaction(capSession(account, 500n), signer, defs)).resolves.toBeDefined();
    }
  });

  it("never blind-signs a session transaction: 0x6815, whatever the policy", async () => {
    const { simulated, approvals } = device();
    for (const { signer, account } of await signers(simulated)) {
      // A Flags bit the app does not know (07-unknown-flag) makes the review blind.
      const unclear: TxJson = { ...capSession(account, 40n), Flags: 0x00020000 };
      await expect(signTransaction(unclear, signer, defs)).rejects.toMatchObject({
        statusWord: kSw.sessionBlindRefused,
        kind: "sessionBlindRefused",
      });
    }
    expect(simulated.refusals).toEqual([
      "Session transactions are never blind-signed",
      "Session transactions are never blind-signed",
    ]);
    expect(approvals).toEqual([]);
  });
});

describe("session policy check (the device's rules)", () => {
  const session = (fields: Record<string, unknown>) => ({
    TransactionType: "SigningSessionSet",
    Account: kWitness,
    SessionKey: kSessionKey,
    ...fields,
  });
  const capped = { SessionCap: "20000000", SessionMaxPerTx: "5000000", SessionDuration: 600 };
  const refusal = (policy: SessionPolicy, tx: Record<string, unknown>) =>
    sessionPolicyRefusal(policy, tx, defs);

  it("lets everything through while off, and a session within every limit", () => {
    expect(refusal(kSessionPolicyOff, session({ Flags: kAllTransactions }))).toBeUndefined();
    expect(refusal(kDemoPolicy, session(capped))).toBeUndefined();
    expect(refusal(kDemoPolicy, { TransactionType: "Payment" })).toBeUndefined();
  });

  it("refuses modes A and P unless allowed", () => {
    const modeA = session({ Flags: kAllTransactions, SessionDuration: 600 });
    const modeP = session({ SessionDuration: 600, Permissions: [] });
    expect(refusal(kDemoPolicy, modeA)).toBe("Sessions for all transactions are not allowed");
    expect(refusal(kDemoPolicy, modeP)).toBe("Sessions with permissions are not allowed");
    const open = { ...kDemoPolicy, allowAll: true, allowPermissions: true };
    expect(refusal(open, modeA)).toBeUndefined();
    expect(refusal(open, modeP)).toBeUndefined();
  });

  it("checks the amounts, the duration and the witness", () => {
    expect(refusal(kDemoPolicy, session({ ...capped, SessionMaxPerTx: "20000000" }))).toBe(
      "Max per payment XRP 20 is above XRP 10",
    );
    expect(refusal(kDemoPolicy, session({ ...capped, SessionMaxPerTx: undefined }))).toBe(
      "No max per payment (limit XRP 10)",
    );
    expect(
      refusal(kDemoPolicy, session({ ...capped, SessionCap: { currency: "USD", value: "1" } })),
    ).toBe("Max spend is not an XRP amount");
    expect(refusal(kDemoPolicy, session({ ...capped, SessionDuration: 900 }))).toBe(
      "Duration 900 s is above 600 s",
    );
    expect(refusal(kDemoPolicy, session({ ...capped, SessionDuration: undefined }))).toBe(
      "No session duration",
    );
    const witness = { ...kDemoPolicy, requireWitness: true };
    expect(refusal(witness, session(capped))).toBe("No witness, your policy requires one");
    expect(refusal(witness, session({ ...capped, SessionWitness: kWitness }))).toBeUndefined();
  });

  it("checks every SigningSessionSet inside a Batch and names it", () => {
    const batch = {
      TransactionType: "Batch",
      RawTransactions: [
        { RawTransaction: { TransactionType: "Payment" } },
        { RawTransaction: session({ ...capped, SessionCap: "60000000" }) },
      ],
    };
    expect(refusal(kDemoPolicy, batch)).toBe("Transaction 2: Max spend XRP 60 is above XRP 50");
  });
});

const hexText = (text: string) => bytesToHex(new TextEncoder().encode(text));
const profileMemo = (name: string) => ({
  Memo: { MemoType: hexText("carbs-profile"), MemoData: hexText(name) },
});
/** The real app's game opening: 5 XRP, 0.1 XRP per payment, 300 transactions, 10 minutes. */
const gameSession = (account: string, fields: Record<string, unknown> = {}): TxJson => ({
  ...capSession(account, 5n),
  SessionMaxPerTx: "100000",
  SessionDuration: 600,
  SessionMaxTxCount: 300,
  Memos: [profileMemo("game")],
  ...fields,
});
/** The real app's trading opening: OfferCreate and OfferCancel, 200 transactions. */
const tradingSession = (permissions: string[]): Record<string, unknown> => ({
  TransactionType: "SigningSessionSet",
  Account: kWitness,
  SessionKey: kSessionKey,
  SessionDuration: 600,
  SessionMaxTxCount: 200,
  Permissions: permissions.map((value) => ({ Permission: { PermissionValue: value } })),
  Memos: [profileMemo("trading")],
});

describe("session profiles (the device's rules)", () => {
  const refusal = (policy: SessionPolicy, tx: Record<string, unknown>) =>
    sessionPolicyRefusal(policy, tx, defs);
  const on: SessionPolicy = { ...kSessionPolicyOff, enabled: true };

  it("checks a session naming a profile against that profile, not the default limits", () => {
    expect(refusal(kDemoPolicy, gameSession(kWitness))).toBeUndefined();
    expect(refusal(kDemoPolicy, gameSession(kWitness, { SessionCap: "50000000" }))).toBe(
      "Profile Game: Max spend XRP 50 is above XRP 5",
    );
    expect(refusal(on, tradingSession(["OfferCreate", "OfferCancel"]))).toBeUndefined();
  });

  it("refuses each limit of the profile, and a permission outside it", () => {
    const { SessionMaxTxCount: _count, ...noCount } = gameSession(kWitness);
    expect(refusal(on, noCount)).toBe("Profile Game: Set a transaction limit (at most 500)");
    expect(refusal(on, gameSession(kWitness, { SessionMaxTxCount: 501 }))).toBe(
      "Profile Game: Max transactions 501 is above 500",
    );
    expect(refusal(on, gameSession(kWitness, { SessionMaxPerTx: "200000" }))).toBe(
      "Profile Game: Max per payment XRP 0.2 is above XRP 0.1",
    );
    expect(
      refusal(on, gameSession(kWitness, { Memos: [profileMemo("agent")], SessionMaxTxCount: 20 })),
    ).toBe("Profile Agent: Duration 600 s is above 180 s");
    expect(refusal(on, tradingSession(["OfferCreate", "Payment"]))).toBe(
      "Profile Trading: Payment is not allowed",
    );
    expect(refusal(on, gameSession(kWitness, { Memos: [profileMemo("minting")] }))).toBe(
      "Profile Minting: Session mode not allowed by this profile",
    );
    expect(refusal(on, gameSession(kWitness, { SessionMaxTxCount: 0 }))).toBe(
      "Max transactions 0 is not 1 to 100000",
    );
  });

  it("refuses an unknown profile, two profile memos, a profile turned off", () => {
    expect(refusal(on, gameSession(kWitness, { Memos: [profileMemo("casino")] }))).toBe(
      "Unknown session profile",
    );
    expect(
      refusal(on, gameSession(kWitness, { Memos: [profileMemo("game"), profileMemo("game")] })),
    ).toBe("More than one session profile");
    const gameOff: SessionPolicy = {
      ...on,
      profiles: on.profiles.map((profile) =>
        profile.name === "game" ? { ...profile, enabled: false } : profile,
      ),
    };
    expect(refusal(gameOff, gameSession(kWitness))).toBe(
      "Profile Game: This profile is off in your settings",
    );
    expect(refusal({ ...on, requireWitness: true }, gameSession(kWitness))).toBe(
      "Profile Game: No witness, your policy requires one",
    );
    expect(
      refusal(kSessionPolicyOff, gameSession(kWitness, { SessionCap: "50000000" })),
    ).toBeUndefined();
  });
});

describe("the real app's profile openings clear-sign, policy on or off (SIMULATED)", () => {
  const vectors = new URL(
    "../../../ledger-app/tests/standalone/testcases/33-session-policy/",
    import.meta.url,
  );

  for (const name of ["04-profile-game", "07-profile-trading"]) {
    it(`${name}: the device vector's review, Profile row and Max transactions included`, async () => {
      const raw = new Uint8Array(await readFile(new URL(`${name}.raw`, vectors)));
      const lines = parseScreenVector(await readFile(new URL(`${name}.txt`, vectors), "utf8"));
      const review = reviewLines(decodeTx(bytesToHex(raw), defs), defs);
      expect(review).toEqual({ kind: "clear", lines });
    });
  }

  it("signs the game opening on both paths with the policy off, and checks it when on", async () => {
    for (const policy of [undefined, kDemoPolicy]) {
      const { simulated, approvals } = device(policy);
      for (const { signer, account } of await signers(simulated)) {
        await expect(signTransaction(gameSession(account), signer, defs)).resolves.toBeDefined();
        expect(simulated.reviews.at(-1)?.lines.slice(3, 5)).toEqual([
          { label: "Agent ID", value: "A1E8-094F" },
          { label: "Profile", value: "Game" },
        ]);
      }
      expect(approvals).toEqual(["classic", "ml-dsa"]);
    }
    const { simulated } = device(kDemoPolicy);
    for (const { signer, account } of await signers(simulated)) {
      await expect(
        signTransaction(gameSession(account, { SessionCap: "50000000" }), signer, defs),
      ).rejects.toMatchObject({ statusWord: kSw.sessionPolicyRefused });
    }
    expect(simulated.refusals).toEqual([
      "Blocked by your session policy: Profile Game: Max spend XRP 50 is above XRP 5",
      "Blocked by your session policy: Profile Game: Max spend XRP 50 is above XRP 5",
    ]);
  });
});
