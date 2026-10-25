import {
  APDU_MAX_PAYLOAD,
  type Command,
  CommandResultFactory,
  type InternalApi,
  InvalidArgumentError,
  InvalidResponseFormatError,
  isSuccessCommandResult,
  type LoggerPublisherService,
} from "@ledgerhq/device-management-kit";
import { Just, Nothing } from "purify-ts";
import { vi } from "vitest";

import { XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";

import { SendSignTransactionPqTask } from "./SendSignTransactionPqTask";

const SIGNATURE_LENGTH = 2420;
const ANSWER_CHUNK = 250;
const PREFIX = [0x53, 0x54, 0x58, 0x00];

const loggerFactory = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    subscribers: [],
  }) as unknown as LoggerPublisherService;

/** `STX\0` then `length - 4` bytes, each distinct enough to spot a slice. */
const signingDataOfLength = (length: number) =>
  Uint8Array.from({ length }, (_, i) => (i < 4 ? PREFIX[i]! : i & 0xff));

type Answer = ReturnType<typeof CommandResultFactory>;

/**
 * Drive the task against a device that acknowledges every 0x11 chunk,
 * announces a 2,420-byte signature on the last one, and answers 0x12 chunk
 * `i` with bytes all equal to `i`, unless told otherwise.
 */
const runTask = async (
  signingData: Uint8Array,
  {
    answerFor,
  }: {
    answerFor?: (apdu: Uint8Array, index: number) => Answer | undefined;
  } = {},
) => {
  const apdus: Uint8Array[] = [];
  const sendCommand = vi.fn((command: Command<unknown, unknown, unknown>) => {
    const apdu = command.getApdu().getRawApdu();
    apdus.push(apdu);
    const custom = answerFor?.(apdu, apdus.length - 1);
    if (custom !== undefined) {
      return Promise.resolve(custom);
    }
    if (apdu[1] === 0x11) {
      const isLast = apdu[3] === 0x01;
      return Promise.resolve(
        CommandResultFactory({
          data: isLast ? Just(SIGNATURE_LENGTH) : Nothing,
        }),
      );
    }
    const chunkIndex = apdu[2]!;
    const length = Math.min(
      ANSWER_CHUNK,
      SIGNATURE_LENGTH - chunkIndex * ANSWER_CHUNK,
    );
    return Promise.resolve(
      CommandResultFactory({ data: new Uint8Array(length).fill(chunkIndex) }),
    );
  });

  const api = { sendCommand } as unknown as InternalApi;
  const result = await new SendSignTransactionPqTask(api, {
    signingData,
    loggerFactory,
  }).run();
  const signs = apdus.filter((apdu) => apdu[1] === 0x11);
  const reads = apdus.filter((apdu) => apdu[1] === 0x12);
  return { result, apdus, signs, reads };
};

describe("SendSignTransactionPqTask", () => {
  it("should frame 0x11 in 255-byte chunks: P1 00 then 01, P2 01 on the last", async () => {
    // GIVEN 600 bytes: 255, 255, then 90
    const { signs } = await runTask(signingDataOfLength(600));

    // THEN
    expect(signs.map((apdu) => Array.from(apdu.slice(0, 5)))).toStrictEqual([
      [0xe0, 0x11, 0x00, 0x00, 0xff],
      [0xe0, 0x11, 0x01, 0x00, 0xff],
      [0xe0, 0x11, 0x01, 0x01, 0x5a],
    ]);
  });

  it("should send the signing data unchanged, STX\\0 included", async () => {
    // GIVEN
    const signingData = signingDataOfLength(APDU_MAX_PAYLOAD * 2 + 7);

    // WHEN
    const { signs } = await runTask(signingData);

    // THEN nothing repeated or dropped at the seams, nothing prepended
    const sent = Uint8Array.from(signs.flatMap((apdu) => [...apdu.slice(5)]));
    expect(sent).toStrictEqual(signingData);
    expect(Array.from(sent.slice(0, 4))).toStrictEqual(PREFIX);
  });

  it("should send a single chunk with P1 00 and P2 01 when the data fits", async () => {
    // WHEN
    const { signs } = await runTask(signingDataOfLength(100));

    // THEN
    expect(signs).toHaveLength(1);
    expect(Array.from(signs[0]!.slice(2, 4))).toStrictEqual([0x00, 0x01]);
  });

  it("should then read the signature in ten 0x12 chunks and reassemble it", async () => {
    // WHEN
    const { result, reads } = await runTask(signingDataOfLength(1500));

    // THEN
    expect(reads).toStrictEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) =>
        Uint8Array.from([0xe0, 0x12, index, 0x00, 0x00]),
      ),
    );
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data).toHaveLength(SIGNATURE_LENGTH);
    expect(result.data[ANSWER_CHUNK * 9]).toBe(9);
    expect(result.data[SIGNATURE_LENGTH - 1]).toBe(9);
  });

  it("should accept exactly 2,048 bytes, the app's limit", async () => {
    // WHEN
    const { result, signs } = await runTask(signingDataOfLength(2048));

    // THEN 8 full chunks and 8 bytes
    expect(isSuccessCommandResult(result)).toBe(true);
    expect(signs).toHaveLength(9);
    expect(signs[8]![4]).toBe(8);
  });

  it.each([
    {
      desc: "data without the STX\\0 prefix",
      data: Uint8Array.from([0x12, 0x00, 0x00, 0x24, 0x00]),
      message:
        "The ML-DSA signing data must start with the STX\\0 prefix (53545800)",
    },
    {
      desc: "the prefix alone",
      data: Uint8Array.from(PREFIX),
      message:
        "The ML-DSA signing data must start with the STX\\0 prefix (53545800)",
    },
    {
      desc: "more than 2,048 bytes",
      data: signingDataOfLength(2049),
      message: "The app signs at most 2048 bytes with ML-DSA-44, got 2049",
    },
  ])(
    "should refuse $desc before anything reaches the device",
    async ({ data, message }) => {
      // WHEN
      const { result, apdus } = await runTask(data);

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toBeInstanceOf(InvalidArgumentError);
      expect(result.error).toEqual(
        expect.objectContaining({ originalError: new Error(message) }),
      );
      expect(apdus).toHaveLength(0);
    },
  );

  it("should propagate a refusal on the last chunk and read no signature", async () => {
    // GIVEN the session policy refuses the transaction
    const error = new XrpAppCommandError({
      message: "Session refused by the session policy set on the device",
      errorCode: "6986",
    });
    const { result, reads } = await runTask(signingDataOfLength(600), {
      answerFor: (apdu) =>
        apdu[1] === 0x11 && apdu[3] === 0x01
          ? CommandResultFactory({ error })
          : undefined,
    });

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toBe(error);
    expect(reads).toHaveLength(0);
  });

  it("should stop sending after an error mid-loop", async () => {
    // GIVEN the app refuses the second chunk
    const error = new XrpAppCommandError({
      message: "Invalid data",
      errorCode: "6a80",
    });
    const { result, apdus } = await runTask(signingDataOfLength(900), {
      answerFor: (_apdu, index) =>
        index === 1 ? CommandResultFactory({ error }) : undefined,
    });

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(apdus).toHaveLength(2);
  });

  it.each([
    { desc: "a length other than 2,420", answer: Just(2419), announced: 2419 },
    { desc: "no length at all", answer: Nothing, announced: 0 },
  ])(
    "should refuse $desc and read no signature",
    async ({ answer, announced }) => {
      // WHEN
      const { result, reads } = await runTask(signingDataOfLength(300), {
        answerFor: (apdu) =>
          apdu[1] === 0x11 && apdu[3] === 0x01
            ? CommandResultFactory({ data: answer })
            : undefined,
      });

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
      expect(result.error).toEqual(
        expect.objectContaining({
          originalError: new Error(
            `Expected a 2420-byte signature, the app announced ${announced}`,
          ),
        }),
      );
      expect(reads).toHaveLength(0);
    },
  );

  it("should propagate an error while reading the signature", async () => {
    // GIVEN no signature to read
    const error = new XrpAppCommandError({
      message: "No ML-DSA-44 signature to read",
      errorCode: "6982",
    });
    const { result, reads } = await runTask(signingDataOfLength(300), {
      answerFor: (apdu) =>
        apdu[1] === 0x12 && apdu[2] === 3
          ? CommandResultFactory({ error })
          : undefined,
    });

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toBe(error);
    expect(reads).toHaveLength(4);
  });
});
