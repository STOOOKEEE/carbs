import {
  addressFromPublicKey,
  generateClassicSeed,
  signTransaction,
  type BytesSigner,
  type TxJson,
} from "@carbs/sessions";
import { simulatedSessionDefinitions } from "@carbs/sessions/testing";
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

/** SIMULATED definitions: the recorded standalone node does not know `SessionMaxPerTx`/`SessionWitness`. */
const defs = simulatedSessionDefinitions();
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

describe("INS 0x08: session policy", () => {
  it("reads the fresh install answer as the policy off", () => {
    const fresh = Uint8Array.of(1, ...new Uint8Array(21));
    expect(parseSessionPolicy(fresh)).toEqual(kSessionPolicyOff);
    expect(encodeSessionPolicy(kSessionPolicyOff)).toEqual(fresh);
  });

  it("reads the flags and the big-endian limits", () => {
    const bytes = Uint8Array.of(
      1,
      0x0f,
      ...[0, 0, 0, 0, 0x02, 0xfa, 0xf0, 0x80], // 50 000 000 drops
      ...[0, 0, 0, 0, 0, 0x98, 0x96, 0x80], // 10 000 000 drops
      ...[0, 0, 0x02, 0x58], // 600 s
    );
    const policy = parseSessionPolicy(bytes);
    expect(policy).toEqual({
      version: 1,
      enabled: true,
      allowAll: true,
      allowPermissions: true,
      requireWitness: true,
      maxCapDrops: 50_000_000n,
      maxPerTxDrops: 10_000_000n,
      maxDurationSeconds: 600,
    });
    expect(encodeSessionPolicy(policy)).toEqual(bytes);
  });

  it("refuses a wrong length or an unknown version", () => {
    expect(() => parseSessionPolicy(new Uint8Array(21))).toThrow(SessionPolicyError);
    expect(() => parseSessionPolicy(Uint8Array.of(1, ...new Uint8Array(22)))).toThrow(/23 bytes/);
    expect(() => parseSessionPolicy(Uint8Array.of(2, ...new Uint8Array(21)))).toThrow(
      SessionPolicyError,
    );
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
