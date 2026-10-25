import {
  ApduResponse,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { SignTransactionPqCommand } from "@internal/app-binder/command/SignTransactionPqCommand";
import {
  INS,
  XRP_CLA,
} from "@internal/app-binder/command/utils/apduHeaderUtils";
import { type XrpSessionCommandError } from "@internal/app-binder/command/utils/sessionApplicationErrors";

// A stand-in chunk; the command writes whatever chunk it is given.
const CHUNK = Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12, 0x00]);

const success = (data: number[]) =>
  new ApduResponse({
    statusCode: Uint8Array.from([0x90, 0x00]),
    data: Uint8Array.from(data),
  });

const failure = (statusCode: [number, number]) =>
  new ApduResponse({
    statusCode: Uint8Array.from(statusCode),
    data: new Uint8Array(0),
  });

const lastChunkCommand = new SignTransactionPqCommand({
  chunkedData: CHUNK,
  isFirstChunk: true,
  isLastChunk: true,
});

describe("SignTransactionPqCommand", () => {
  describe("name", () => {
    it("should be 'SignTransactionPq'", () => {
      expect(lastChunkCommand.name).toBe("SignTransactionPq");
    });
  });

  describe("getApdu", () => {
    // P1: 00 first chunk, 01 next; P2: 01 last chunk, 00 more to come.
    it.each([
      { isFirstChunk: true, isLastChunk: true, p1: 0x00, p2: 0x01 },
      { isFirstChunk: true, isLastChunk: false, p1: 0x00, p2: 0x00 },
      { isFirstChunk: false, isLastChunk: false, p1: 0x01, p2: 0x00 },
      { isFirstChunk: false, isLastChunk: true, p1: 0x01, p2: 0x01 },
    ])(
      "should build P1=$p1 P2=$p2 when isFirstChunk=$isFirstChunk and isLastChunk=$isLastChunk",
      ({ isFirstChunk, isLastChunk, p1, p2 }) => {
        // GIVEN
        const command = new SignTransactionPqCommand({
          chunkedData: CHUNK,
          isFirstChunk,
          isLastChunk,
        });

        // WHEN
        const apdu = command.getApdu().getRawApdu();

        // THEN
        expect(apdu).toStrictEqual(
          Uint8Array.from([
            XRP_CLA,
            INS.PQ_SIGN,
            p1,
            p2,
            CHUNK.length,
            ...CHUNK,
          ]),
        );
      },
    );

    it("should use instruction 0x11 and carry a full 255-byte chunk", () => {
      // GIVEN
      const chunk = new Uint8Array(255).fill(0xab);

      // WHEN
      const apdu = new SignTransactionPqCommand({
        chunkedData: chunk,
        isFirstChunk: false,
        isLastChunk: false,
      })
        .getApdu()
        .getRawApdu();

      // THEN
      expect(INS.PQ_SIGN).toBe(0x11);
      expect(apdu[4]).toBe(0xff);
      expect(apdu.slice(5)).toStrictEqual(chunk);
    });
  });

  describe("parseResponse", () => {
    it("should return Nothing for the acknowledgement of a chunk", () => {
      // WHEN
      const result = lastChunkCommand.parseResponse(success([]));

      // THEN
      if (!isSuccessCommandResult(result)) {
        assert.fail("Expected a success");
      }
      expect(result.data.isNothing()).toBe(true);
    });

    it("should return the announced signature length, big-endian", () => {
      // WHEN the app answers 09 74 after the review
      const result = lastChunkCommand.parseResponse(success([0x09, 0x74]));

      // THEN
      if (!isSuccessCommandResult(result)) {
        assert.fail("Expected a success");
      }
      expect(result.data.extract()).toBe(2420);
    });

    it.each([[[0x09]], [[0x00, 0x09, 0x74]]])(
      "should refuse an answer that is not 2 bytes: %j",
      (data) => {
        // WHEN
        const result = lastChunkCommand.parseResponse(success(data));

        // THEN
        if (isSuccessCommandResult(result)) {
          assert.fail("Expected an error");
        }
        expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
        expect(result.error).toEqual(
          expect.objectContaining({
            originalError: new Error("Cannot extract signature length"),
          }),
        );
      },
    );

    it.each([
      { statusCode: [0x69, 0x85] as [number, number], errorCode: "6985" },
      { statusCode: [0x69, 0x86] as [number, number], errorCode: "6986" },
      { statusCode: [0x68, 0x15] as [number, number], errorCode: "6815" },
      { statusCode: [0x6a, 0x80] as [number, number], errorCode: "6a80" },
      { statusCode: [0x67, 0x00] as [number, number], errorCode: "6700" },
    ])(
      "should map $errorCode (refused, session policy, never blind, bad data, too long)",
      ({ statusCode, errorCode }) => {
        // WHEN
        const result = lastChunkCommand.parseResponse(failure(statusCode));

        // THEN
        if (isSuccessCommandResult(result)) {
          assert.fail("Expected an error");
        }
        expect((result.error as XrpSessionCommandError).errorCode).toBe(
          errorCode,
        );
      },
    );
  });
});
