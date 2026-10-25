import { from } from "rxjs";
import { vi } from "vitest";

import { type XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

import { SignTransactionPqUseCase } from "./SignTransactionPqUseCase";

const SIGNING_DATA = Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12, 0x00]);

describe("SignTransactionPqUseCase", () => {
  const setup = () => {
    const expectedResult = { observable: from([]), cancel: vi.fn() };
    const signTransactionPqMock = vi.fn().mockReturnValue(expectedResult);
    const appBinderMock = {
      signTransactionPq: signTransactionPqMock,
    } as unknown as XrpAppBinder;

    return {
      signTransactionPqMock,
      expectedResult,
      useCase: new SignTransactionPqUseCase(appBinderMock),
    };
  };

  it("should return the result from appBinder.signTransactionPq", () => {
    // GIVEN
    const { useCase, expectedResult } = setup();

    // WHEN
    const result = useCase.execute(SIGNING_DATA);

    // THEN
    expect(result).toBe(expectedResult);
  });

  it("should pass the signing data as it is and default skipOpenApp to false", () => {
    // GIVEN
    const { useCase, signTransactionPqMock } = setup();

    // WHEN
    useCase.execute(SIGNING_DATA, {});

    // THEN
    expect(signTransactionPqMock).toHaveBeenCalledWith({
      transaction: SIGNING_DATA,
      skipOpenApp: false,
    });
  });

  it("should forward skipOpenApp", () => {
    // GIVEN
    const { useCase, signTransactionPqMock } = setup();

    // WHEN
    useCase.execute(SIGNING_DATA, { skipOpenApp: true });

    // THEN
    expect(signTransactionPqMock).toHaveBeenCalledWith({
      transaction: SIGNING_DATA,
      skipOpenApp: true,
    });
  });
});
