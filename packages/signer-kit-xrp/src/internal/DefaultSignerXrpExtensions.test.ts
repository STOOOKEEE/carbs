import {
  CallTaskInAppDeviceAction,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { from } from "rxjs";
import { vi } from "vitest";

import { DefaultSignerXrp } from "./DefaultSignerXrp";

/** The signer methods that drive the post-quantum root and the session policy. */

type ExecuteDeviceActionCallArgs = {
  sessionId: DeviceSessionId;
  deviceAction: { input: { skipOpenApp: boolean } };
};

describe("DefaultSignerXrp extensions", () => {
  const sessionId = "test-session-id" as DeviceSessionId;

  const setup = () => {
    const expectedResult = { observable: from([]), cancel: vi.fn() };
    const executeDeviceAction = vi.fn().mockReturnValue(expectedResult);
    const getLoggerFactory = vi.fn().mockReturnValue(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      subscribers: [],
    }));
    const dmk = {
      executeDeviceAction,
      getLoggerFactory,
    } as unknown as DeviceManagementKit;

    return {
      executeDeviceAction,
      expectedResult,
      signer: new DefaultSignerXrp({ dmk, sessionId }),
    };
  };

  describe("getPqPublicKey", () => {
    it("should delegate to the use case and return its result", () => {
      // GIVEN
      const { executeDeviceAction, expectedResult, signer } = setup();

      // WHEN
      const result = signer.getPqPublicKey();

      // THEN
      expect(result).toBe(expectedResult);
      const callArgs = executeDeviceAction.mock
        .calls[0]![0] as ExecuteDeviceActionCallArgs;
      expect(callArgs.sessionId).toBe(sessionId);
      expect(callArgs.deviceAction).toBeInstanceOf(CallTaskInAppDeviceAction);
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(false);
    });

    it("should forward skipOpenApp", () => {
      // GIVEN
      const { executeDeviceAction, signer } = setup();

      // WHEN
      signer.getPqPublicKey({ skipOpenApp: true });

      // THEN
      const callArgs = executeDeviceAction.mock
        .calls[0]![0] as ExecuteDeviceActionCallArgs;
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(true);
    });
  });
});
