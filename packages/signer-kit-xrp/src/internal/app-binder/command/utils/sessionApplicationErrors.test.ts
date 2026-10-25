import {
  ApduResponse,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { Curve } from "@api/model/Curve";
import { SignTransactionCommand } from "@internal/app-binder/command/SignTransactionCommand";
import { SignTransactionPqCommand } from "@internal/app-binder/command/SignTransactionPqCommand";
import {
  XRP_SESSION_APP_ERRORS,
  XrpSessionCommandError,
} from "@internal/app-binder/command/utils/sessionApplicationErrors";
import { XRP_APP_ERRORS } from "@internal/app-binder/command/utils/xrpApplicationErrors";

const failure = (statusCode: [number, number]) =>
  new ApduResponse({
    statusCode: Uint8Array.from(statusCode),
    data: new Uint8Array(0),
  });

const pqCommand = new SignTransactionPqCommand({
  chunkedData: Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12]),
  isFirstChunk: true,
  isLastChunk: true,
});

describe("XRP session application errors", () => {
  it.each([
    {
      statusCode: [0x68, 0x15] as [number, number],
      errorCode: "6815",
      message:
        "Session transaction refused: the app cannot show it in full, and session transactions are never blind-signed",
    },
    {
      statusCode: [0x69, 0x86] as [number, number],
      errorCode: "6986",
      message: "Session refused by the session policy set on the device",
    },
  ])(
    "should map $errorCode on the ML-DSA sign command, with its message",
    ({ statusCode, errorCode, message }) => {
      // WHEN
      const result = pqCommand.parseResponse(failure(statusCode));

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toBeInstanceOf(XrpSessionCommandError);
      const error = result.error as XrpSessionCommandError;
      expect(error.errorCode).toBe(errorCode);
      expect(error.message).toBe(message);
    },
  );

  it("should keep every upstream mapping in the session map", () => {
    Object.entries(XRP_APP_ERRORS).forEach(([code, entry]) => {
      expect(
        XRP_SESSION_APP_ERRORS[code as keyof typeof XRP_SESSION_APP_ERRORS],
      ).toEqual(entry);
    });
  });

  it("should leave the shared upstream map, and so the classical command, unchanged", () => {
    // GIVEN the upstream classical sign command
    const command = new SignTransactionCommand({
      chunkedData: Uint8Array.from([0x12, 0x00]),
      isFirstChunk: true,
      isLastChunk: true,
      curve: Curve.Secp256k1,
    });

    // WHEN
    const result = command.parseResponse(failure([0x69, 0x86]));

    // THEN a generic device exchange error that still carries the status word
    expect(Object.keys(XRP_APP_ERRORS)).not.toContain("6986");
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toEqual(
      expect.objectContaining({
        _tag: "UnknownDeviceExchangeError",
        originalError: expect.objectContaining({ errorCode: "6986" }),
      }),
    );
  });
});
