import {
  ApduResponse,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { GetAppConfigCommand } from "@internal/app-binder/command/GetAppConfigCommand";
import { GetPqSignatureCommand } from "@internal/app-binder/command/GetPqSignatureCommand";
import {
  INS,
  XRP_CLA,
} from "@internal/app-binder/command/utils/apduHeaderUtils";
import { type XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";

const failure = (statusCode: [number, number]) =>
  new ApduResponse({
    statusCode: Uint8Array.from(statusCode),
    data: new Uint8Array(0),
  });

describe("GetPqSignatureCommand", () => {
  it("should be named 'GetPqSignature'", () => {
    expect(new GetPqSignatureCommand({ chunkIndex: 0 }).name).toBe(
      "GetPqSignature",
    );
  });

  it.each([0, 4, 9])("should build E0 12 0%i 00 with no data", (chunkIndex) => {
    // WHEN
    const apdu = new GetPqSignatureCommand({ chunkIndex }).getApdu();

    // THEN
    expect(INS.PQ_GET_SIGNATURE).toBe(0x12);
    expect(apdu.getRawApdu()).toStrictEqual(
      Uint8Array.from([XRP_CLA, INS.PQ_GET_SIGNATURE, chunkIndex, 0, 0]),
    );
  });

  it("should return the chunk as it is", () => {
    // GIVEN the last, 170-byte chunk of a signature
    const chunk = Array.from({ length: 170 }, (_, i) => (i * 3) & 0xff);

    // WHEN
    const result = new GetPqSignatureCommand({ chunkIndex: 9 }).parseResponse(
      new ApduResponse({
        statusCode: Uint8Array.from([0x90, 0x00]),
        data: Uint8Array.from(chunk),
      }),
    );

    // THEN
    if (!isSuccessCommandResult(result)) {
      assert.fail("Expected a success");
    }
    expect(result.data).toStrictEqual(Uint8Array.from(chunk));
  });

  it("should return an error for an empty answer", () => {
    // WHEN
    const result = new GetPqSignatureCommand({ chunkIndex: 0 }).parseResponse(
      new ApduResponse({
        statusCode: Uint8Array.from([0x90, 0x00]),
        data: new Uint8Array(0),
      }),
    );

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect(result.error).toBeInstanceOf(InvalidResponseFormatError);
  });

  it("should say that 6982 means no signature to read on this instruction only", () => {
    // WHEN
    const result = new GetPqSignatureCommand({ chunkIndex: 0 }).parseResponse(
      failure([0x69, 0x82]),
    );
    const elsewhere = new GetAppConfigCommand().parseResponse(
      failure([0x69, 0x82]),
    );

    // THEN
    if (isSuccessCommandResult(result) || isSuccessCommandResult(elsewhere)) {
      assert.fail("Expected errors");
    }
    expect((result.error as XrpAppCommandError).errorCode).toBe("6982");
    expect((result.error as XrpAppCommandError).message).toBe(
      "No ML-DSA-44 signature to read",
    );
    expect((elsewhere.error as XrpAppCommandError).message).toBe(
      "Security status not satisfied (Canceled by user)",
    );
  });

  it("should map a chunk index past the signature", () => {
    // WHEN
    const result = new GetPqSignatureCommand({ chunkIndex: 10 }).parseResponse(
      failure([0x6b, 0x00]),
    );

    // THEN
    if (isSuccessCommandResult(result)) {
      assert.fail("Expected an error");
    }
    expect((result.error as XrpAppCommandError).errorCode).toBe("6b00");
  });
});
