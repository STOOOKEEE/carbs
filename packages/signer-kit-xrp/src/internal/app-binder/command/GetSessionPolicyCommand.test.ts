import {
  ApduResponse,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { GetSessionPolicyCommand } from "@internal/app-binder/command/GetSessionPolicyCommand";
import {
  INS,
  XRP_CLA,
} from "@internal/app-binder/command/utils/apduHeaderUtils";
import { type XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";

const XRP = 1_000_000n;

type Record = {
  id: number;
  flags: number;
  modes: number;
  maxCap: bigint;
  maxPerTx: bigint;
  maxDuration: number;
  maxTxCount: number;
  permissions: number[];
};

/** The default profiles of a fresh install (`session_profiles.c`). */
const DEFAULT_RECORDS: Record[] = [
  {
    id: 0,
    flags: 1,
    modes: 0x01,
    maxCap: 50n * XRP,
    maxPerTx: 5n * XRP,
    maxDuration: 180,
    maxTxCount: 20,
    permissions: [],
  },
  {
    id: 1,
    flags: 1,
    modes: 0x01,
    maxCap: 5n * XRP,
    maxPerTx: XRP / 10n,
    maxDuration: 600,
    maxTxCount: 500,
    permissions: [],
  },
  {
    id: 2,
    flags: 1,
    modes: 0x04,
    maxCap: 0n,
    maxPerTx: 0n,
    maxDuration: 600,
    maxTxCount: 200,
    permissions: [8, 9],
  },
  {
    id: 3,
    flags: 1,
    modes: 0x01,
    maxCap: 2n * XRP,
    maxPerTx: XRP / 100n,
    maxDuration: 600,
    maxTxCount: 1000,
    permissions: [],
  },
  {
    id: 4,
    flags: 1,
    modes: 0x04,
    maxCap: 0n,
    maxPerTx: 0n,
    maxDuration: 600,
    maxTxCount: 100,
    permissions: [26],
  },
];

const u32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];
const u64 = (value: bigint) =>
  Array.from({ length: 8 }, (_, i) =>
    Number((value >> BigInt(8 * (7 - i))) & 0xffn),
  );

/** `session_policy_serialize`, format version 2. */
const serialize = ({
  version = 2,
  flags = 0,
  maxCap = 0n,
  maxPerTx = 0n,
  maxDuration = 0,
  records = DEFAULT_RECORDS,
}: {
  version?: number;
  flags?: number;
  maxCap?: bigint;
  maxPerTx?: bigint;
  maxDuration?: number;
  records?: Record[];
} = {}) => [
  version,
  flags,
  ...u64(maxCap),
  ...u64(maxPerTx),
  ...u32(maxDuration),
  records.length,
  ...records.flatMap((r) => [
    r.id,
    r.flags,
    r.modes,
    ...u64(r.maxCap),
    ...u64(r.maxPerTx),
    ...u32(r.maxDuration),
    ...u32(r.maxTxCount),
    r.permissions.length,
    ...r.permissions.flatMap(u32),
  ]),
];

const answer = (data: number[]) =>
  new ApduResponse({
    statusCode: Uint8Array.from([0x90, 0x00]),
    data: Uint8Array.from(data),
  });

const command = new GetSessionPolicyCommand();

const parseError = (data: number[]) => {
  const result = command.parseResponse(answer(data));
  if (isSuccessCommandResult(result)) {
    assert.fail("Expected an error");
  }
  expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
  return (result.error as InvalidResponseFormatError).originalError;
};

describe("GetSessionPolicyCommand", () => {
  it("should be named 'GetSessionPolicy'", () => {
    expect(command.name).toBe("GetSessionPolicy");
  });

  it("should build E0 08 00 00 with no data", () => {
    expect(INS.GET_SESSION_POLICY).toBe(0x08);
    expect(command.getApdu().getRawApdu()).toStrictEqual(
      Uint8Array.from([XRP_CLA, INS.GET_SESSION_POLICY, 0x00, 0x00, 0x00]),
    );
  });

  it("should read a fresh install: policy off, no limit, the five default profiles", () => {
    // GIVEN 02, 21 zero bytes, 05, then the five records (175 bytes)
    const data = serialize();
    expect(data).toHaveLength(175);

    // WHEN
    const result = command.parseResponse(answer(data));

    // THEN
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data).toStrictEqual({
      version: 2,
      enabled: false,
      allowAll: false,
      allowPermissions: false,
      requireWitness: false,
      maxCapDrops: null,
      maxPerTxDrops: null,
      maxDurationSeconds: null,
      profiles: [
        {
          id: 0,
          name: "agent",
          enabled: true,
          modes: ["cap"],
          maxCapDrops: 50_000_000n,
          maxPerTxDrops: 5_000_000n,
          maxDurationSeconds: 180,
          maxTxCount: 20,
          permissions: [],
        },
        {
          id: 1,
          name: "game",
          enabled: true,
          modes: ["cap"],
          maxCapDrops: 5_000_000n,
          maxPerTxDrops: 100_000n,
          maxDurationSeconds: 600,
          maxTxCount: 500,
          permissions: [],
        },
        {
          id: 2,
          name: "trading",
          enabled: true,
          modes: ["permissions"],
          maxCapDrops: null,
          maxPerTxDrops: null,
          maxDurationSeconds: 600,
          maxTxCount: 200,
          permissions: [8, 9],
        },
        {
          id: 3,
          name: "streaming",
          enabled: true,
          modes: ["cap"],
          maxCapDrops: 2_000_000n,
          maxPerTxDrops: 10_000n,
          maxDurationSeconds: 600,
          maxTxCount: 1000,
          permissions: [],
        },
        {
          id: 4,
          name: "minting",
          enabled: true,
          modes: ["permissions"],
          maxCapDrops: null,
          maxPerTxDrops: null,
          maxDurationSeconds: 600,
          maxTxCount: 100,
          permissions: [26],
        },
      ],
    });
  });

  it("should read the flags, the limits and a profile turned off", () => {
    // GIVEN the policy on, modes A and P allowed, witness required, limits set
    const records = DEFAULT_RECORDS.map((r) =>
      r.id === 1 ? { ...r, flags: 0 } : r,
    );
    const data = serialize({
      flags: 0x0f,
      maxCap: 50n * XRP,
      maxPerTx: 0xffffffffffffffffn,
      maxDuration: 300,
      records,
    });

    // WHEN
    const result = command.parseResponse(answer(data));

    // THEN
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data).toEqual(
      expect.objectContaining({
        enabled: true,
        allowAll: true,
        allowPermissions: true,
        requireWitness: true,
        maxCapDrops: 50_000_000n,
        maxPerTxDrops: 0xffffffffffffffffn,
        maxDurationSeconds: 300,
      }),
    );
    expect(result.data.profiles[1]).toEqual(
      expect.objectContaining({ name: "game", enabled: false }),
    );
  });

  it("should read a permission value above 2^31 unsigned", () => {
    // GIVEN
    const records = DEFAULT_RECORDS.map((r) =>
      r.id === 4 ? { ...r, permissions: [0xfffffffe] } : r,
    );

    // WHEN
    const result = command.parseResponse(answer(serialize({ records })));

    // THEN
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data.profiles[4]!.permissions).toStrictEqual([0xfffffffe]);
  });

  it("should refuse a version 1 answer", () => {
    expect(parseError(serialize({ version: 1 }))).toEqual(
      new Error("Session policy format 1 is not supported (expected 2)"),
    );
  });

  it("should refuse an empty answer and a truncated header", () => {
    expect(parseError([])).toEqual(
      new Error("Session policy truncated in its version"),
    );
    expect(parseError(serialize().slice(0, 22))).toEqual(
      new Error("Session policy truncated in its header"),
    );
  });

  it("should refuse a truncated profile record", () => {
    // GIVEN the answer cut inside the last permission of the last profile
    const data = serialize();

    // THEN
    expect(parseError(data.slice(0, data.length - 1))).toEqual(
      new Error("Session policy truncated in profile 4"),
    );
  });

  it("should refuse trailing bytes", () => {
    expect(parseError([...serialize(), 0x00])).toEqual(
      new Error("Session policy has 1 bytes after its last profile"),
    );
  });

  it("should refuse another number of profiles", () => {
    expect(
      parseError(serialize({ records: DEFAULT_RECORDS.slice(0, 4) })),
    ).toEqual(new Error("Expected 5 session profiles, the app answered 4"));
  });

  it("should refuse a profile out of its place", () => {
    const records = DEFAULT_RECORDS.map((r) =>
      r.id === 2 ? { ...r, id: 3 } : r,
    );
    expect(parseError(serialize({ records }))).toEqual(
      new Error("Session policy profile 2 has id 3"),
    );
  });

  it.each([
    { statusCode: [0x6b, 0x00] as [number, number], errorCode: "6b00" },
    { statusCode: [0x6d, 0x00] as [number, number], errorCode: "6d00" },
  ])("should map $errorCode", ({ statusCode, errorCode }) => {
    // WHEN
    const result = command.parseResponse(
      new ApduResponse({
        statusCode: Uint8Array.from(statusCode),
        data: new Uint8Array(0),
      }),
    );

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect((result.error as XrpAppCommandError).errorCode).toBe(errorCode);
  });
});
