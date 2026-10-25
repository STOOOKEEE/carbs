import {
  ApduResponse,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { GetPqPublicKeyCommand } from "@internal/app-binder/command/GetPqPublicKeyCommand";
import {
  INS,
  XRP_CLA,
} from "@internal/app-binder/command/utils/apduHeaderUtils";
import { type XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";

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

describe("GetPqPublicKeyCommand", () => {
  describe("name", () => {
    it("should be 'GetPqPublicKey'", () => {
      expect(new GetPqPublicKeyCommand({ chunkIndex: 0 }).name).toBe(
        "GetPqPublicKey",
      );
    });
  });

  describe("getApdu", () => {
    it.each([0, 1, 5])(
      "should build E0 10 0%i 00 with no data",
      (chunkIndex) => {
        // WHEN
        const apdu = new GetPqPublicKeyCommand({ chunkIndex }).getApdu();

        // THEN CLA INS P1 P2 Lc, the chunk index in P1
        expect(apdu.getRawApdu()).toStrictEqual(
          Uint8Array.from([XRP_CLA, INS.PQ_GET_PUBLIC_KEY, chunkIndex, 0, 0]),
        );
      },
    );

    it("should use instruction 0x10", () => {
      expect(INS.PQ_GET_PUBLIC_KEY).toBe(0x10);
    });
  });

  describe("parseResponse", () => {
    const command = new GetPqPublicKeyCommand({ chunkIndex: 0 });

    it("should return the chunk as it is", () => {
      // GIVEN a full 250-byte chunk
      const chunk = Array.from({ length: 250 }, (_, i) => i & 0xff);

      // WHEN
      const result = command.parseResponse(success(chunk));

      // THEN
      if (!isSuccessCommandResult(result)) {
        assert.fail("Expected a success");
      }
      expect(result.data).toStrictEqual(Uint8Array.from(chunk));
    });

    it("should return an error for an empty answer", () => {
      // WHEN
      const result = command.parseResponse(success([]));

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
      expect(result.error).toEqual(
        expect.objectContaining({
          originalError: new Error("Cannot extract public key chunk"),
        }),
      );
    });

    it.each([
      {
        statusCode: [0x6b, 0x00] as [number, number],
        errorCode: "6b00",
        message: "Incorrect parameter P1 or P2",
      },
      {
        statusCode: [0x6f, 0x00] as [number, number],
        errorCode: "6f00",
        message: "Technical problem (Internal error, please report)",
      },
      {
        statusCode: [0x6d, 0x00] as [number, number],
        errorCode: "6d00",
        message: "Incorrect parameter INS",
      },
    ])(
      "should map $errorCode (a chunk past the key, a failed derivation, an app without the root)",
      ({ statusCode, errorCode, message }) => {
        // WHEN
        const result = command.parseResponse(failure(statusCode));

        // THEN
        if (isSuccessCommandResult(result)) {
          assert.fail("Expected an error");
        }
        const error = result.error as XrpAppCommandError;
        expect(error.errorCode).toBe(errorCode);
        expect(error.message).toBe(message);
      },
    );

    it("should return an error if the device is locked", () => {
      // WHEN
      const result = command.parseResponse(failure([0x55, 0x15]));

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toEqual(
        expect.objectContaining({
          errorCode: "5515",
          message: "Device is locked.",
        }),
      );
    });
  });
});
