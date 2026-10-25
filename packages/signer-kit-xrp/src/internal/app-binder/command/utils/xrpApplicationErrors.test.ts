import {
  ApduResponse,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { Curve } from "@api/model/Curve";
import { GetAddressCommand } from "@internal/app-binder/command/GetAddressCommand";
import { SignTransactionCommand } from "@internal/app-binder/command/SignTransactionCommand";
import {
  XRP_APP_ERRORS,
  XrpAppCommandError,
} from "@internal/app-binder/command/utils/xrpApplicationErrors";

const failure = (statusCode: [number, number]) =>
  new ApduResponse({
    statusCode: Uint8Array.from(statusCode),
    data: new Uint8Array(0),
  });

const signCommand = new SignTransactionCommand({
  chunkedData: Uint8Array.from([0x12, 0x00, 0x00]),
  isFirstChunk: true,
  isLastChunk: true,
  curve: Curve.Secp256k1,
});

describe("XRP application errors: the session refusals", () => {
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
    "should map $errorCode to an XRP app error with its message",
    ({ statusCode, errorCode, message }) => {
      // WHEN the app refuses a session transaction before any review
      const result = signCommand.parseResponse(failure(statusCode));

      // THEN
      if (isSuccessCommandResult(result)) {
        assert.fail("Expected an error");
      }
      expect(result.error).toBeInstanceOf(XrpAppCommandError);
      const error = result.error as XrpAppCommandError;
      expect(error.errorCode).toBe(errorCode);
      expect(error.message).toBe(message);
    },
  );

  it("should map the session refusals on every command, as the app answers them on both signing paths", () => {
    // GIVEN a command that is not a signature
    const command = new GetAddressCommand({
      derivationPath: "44'/144'/0'/0/0",
    });

    // WHEN
    const result = command.parseResponse(failure([0x69, 0x86]));

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect((result.error as XrpAppCommandError).errorCode).toBe("6986");
  });

  it("should keep another parse error of the 68xx range unmapped", () => {
    // GIVEN 0x6816, a parse error of the classical path that has no anchor
    // WHEN
    const result = signCommand.parseResponse(failure([0x68, 0x16]));

    // THEN it is a generic device exchange error that carries the status word
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).not.toBeInstanceOf(XrpAppCommandError);
    expect(result.error).toEqual(
      expect.objectContaining({
        _tag: "UnknownDeviceExchangeError",
        originalError: expect.objectContaining({ errorCode: "6816" }),
      }),
    );
  });

  it("should give every mapped status word a message", () => {
    Object.values(XRP_APP_ERRORS).forEach(({ message }) => {
      expect(message.length).toBeGreaterThan(0);
    });
  });
});
