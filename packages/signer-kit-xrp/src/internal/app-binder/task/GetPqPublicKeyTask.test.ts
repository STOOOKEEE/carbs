import {
  CommandResultFactory,
  type InternalApi,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";
import { vi } from "vitest";

import { type GetPqPublicKeyCommand } from "@internal/app-binder/command/GetPqPublicKeyCommand";
import { XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";

import { GetPqPublicKeyTask } from "./GetPqPublicKeyTask";

const PUBLIC_KEY_LENGTH = 1312;
const CHUNK = 250;

/**
 * A device that answers chunk `i` of the key with bytes all equal to `i`
 * (250 bytes, the last one 62), unless told to answer something else.
 */
const runTask = async ({
  answerFor,
}: {
  answerFor?: (
    chunkIndex: number,
  ) => ReturnType<typeof CommandResultFactory> | undefined;
} = {}) => {
  const commands: GetPqPublicKeyCommand[] = [];
  const sendCommand = vi.fn((command: GetPqPublicKeyCommand) => {
    commands.push(command);
    const chunkIndex = command.getApdu().getRawApdu()[2]!;
    const custom = answerFor?.(chunkIndex);
    if (custom !== undefined) {
      return Promise.resolve(custom);
    }
    const length = Math.min(CHUNK, PUBLIC_KEY_LENGTH - chunkIndex * CHUNK);
    return Promise.resolve(
      CommandResultFactory({
        data: new Uint8Array(length).fill(chunkIndex),
      }),
    );
  });

  const api = { sendCommand } as unknown as InternalApi;
  const result = await new GetPqPublicKeyTask(api).run();
  return {
    result,
    apdus: commands.map((c) => c.getApdu().getRawApdu()),
  };
};

describe("GetPqPublicKeyTask", () => {
  it("should read chunks 0 to 5, one E0 10 <index> 00 00 each, chunk 0 first", async () => {
    // WHEN
    const { apdus } = await runTask();

    // THEN
    expect(apdus).toStrictEqual(
      [0, 1, 2, 3, 4, 5].map((index) =>
        Uint8Array.from([0xe0, 0x10, index, 0x00, 0x00]),
      ),
    );
  });

  it("should reassemble the 1,312-byte key in chunk order", async () => {
    // WHEN
    const { result } = await runTask();

    // THEN
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data).toHaveLength(PUBLIC_KEY_LENGTH);
    [0, 1, 2, 3, 4, 5].forEach((index) => {
      expect(result.data[index * CHUNK]).toBe(index);
    });
    // The last chunk holds the remaining 62 bytes.
    expect(result.data[PUBLIC_KEY_LENGTH - 1]).toBe(5);
  });

  it("should refuse a short chunk rather than return a key with a hole", async () => {
    // GIVEN the device answers 249 bytes for chunk 2
    const { result, apdus } = await runTask({
      answerFor: (chunkIndex) =>
        chunkIndex === 2
          ? CommandResultFactory({ data: new Uint8Array(CHUNK - 1) })
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
          "The public key chunk 2 has 249 bytes, expected 250",
        ),
      }),
    );
    expect(apdus).toHaveLength(3);
  });

  it("should refuse a last chunk longer than the key", async () => {
    // GIVEN a full 250-byte answer for chunk 5, which holds 62 bytes
    const { result } = await runTask({
      answerFor: (chunkIndex) =>
        chunkIndex === 5
          ? CommandResultFactory({ data: new Uint8Array(CHUNK) })
          : undefined,
    });

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
  });

  it("should propagate a device error and stop reading", async () => {
    // GIVEN the app fails to derive the key on chunk 0
    const error = new XrpAppCommandError({
      message: "Technical problem (Internal error, please report)",
      errorCode: "6f00",
    });
    const { result, apdus } = await runTask({
      answerFor: () => CommandResultFactory({ error }),
    });

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toBe(error);
    expect(apdus).toHaveLength(1);
  });
});
