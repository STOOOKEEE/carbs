import { from } from "rxjs";
import { vi } from "vitest";

import { type XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

import { GetPqPublicKeyUseCase } from "./GetPqPublicKeyUseCase";

describe("GetPqPublicKeyUseCase", () => {
  const setup = () => {
    const expectedResult = { observable: from([]), cancel: vi.fn() };
    const getPqPublicKeyMock = vi.fn().mockReturnValue(expectedResult);
    const appBinderMock = {
      getPqPublicKey: getPqPublicKeyMock,
    } as unknown as XrpAppBinder;

    return {
      getPqPublicKeyMock,
      expectedResult,
      useCase: new GetPqPublicKeyUseCase(appBinderMock),
    };
  };

  it("should return the result from appBinder.getPqPublicKey", () => {
    // GIVEN
    const { useCase, expectedResult } = setup();

    // WHEN
    const result = useCase.execute();

    // THEN
    expect(result).toBe(expectedResult);
  });

  it("should default skipOpenApp to false, with or without an option object", () => {
    // GIVEN
    const { useCase, getPqPublicKeyMock } = setup();

    // WHEN
    useCase.execute();
    useCase.execute({});

    // THEN
    expect(getPqPublicKeyMock).toHaveBeenNthCalledWith(1, {
      skipOpenApp: false,
    });
    expect(getPqPublicKeyMock).toHaveBeenNthCalledWith(2, {
      skipOpenApp: false,
    });
  });

  it("should forward skipOpenApp", () => {
    // GIVEN
    const { useCase, getPqPublicKeyMock } = setup();

    // WHEN
    useCase.execute({ skipOpenApp: true });

    // THEN
    expect(getPqPublicKeyMock).toHaveBeenCalledWith({ skipOpenApp: true });
  });
});
