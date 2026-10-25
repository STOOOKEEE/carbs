import { from } from "rxjs";
import { vi } from "vitest";

import { type XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

import { GetSessionPolicyUseCase } from "./GetSessionPolicyUseCase";

describe("GetSessionPolicyUseCase", () => {
  const setup = () => {
    const expectedResult = { observable: from([]), cancel: vi.fn() };
    const getSessionPolicyMock = vi.fn().mockReturnValue(expectedResult);
    const appBinderMock = {
      getSessionPolicy: getSessionPolicyMock,
    } as unknown as XrpAppBinder;

    return {
      getSessionPolicyMock,
      expectedResult,
      useCase: new GetSessionPolicyUseCase(appBinderMock),
    };
  };

  it("should return the result from appBinder.getSessionPolicy", () => {
    // GIVEN
    const { useCase, expectedResult } = setup();

    // WHEN
    const result = useCase.execute();

    // THEN
    expect(result).toBe(expectedResult);
  });

  it("should default skipOpenApp to false and forward it", () => {
    // GIVEN
    const { useCase, getSessionPolicyMock } = setup();

    // WHEN
    useCase.execute({});
    useCase.execute({ skipOpenApp: true });

    // THEN
    expect(getSessionPolicyMock).toHaveBeenNthCalledWith(1, {
      skipOpenApp: false,
    });
    expect(getSessionPolicyMock).toHaveBeenNthCalledWith(2, {
      skipOpenApp: true,
    });
  });
});
