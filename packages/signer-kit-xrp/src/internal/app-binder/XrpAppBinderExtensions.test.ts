import {
  CallTaskInAppDeviceAction,
  type DeviceManagementKit,
  type DeviceSessionId,
  type LoggerPublisherService,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";
import { from } from "rxjs";
import { vi } from "vitest";

import { APP_NAME } from "@internal/app-binder/constants";
import { SignTransactionPqDeviceAction } from "@internal/app-binder/device-action/SignTransactionPq/SignTransactionPqDeviceAction";
import { XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

/** The binder methods that drive the post-quantum root and the session policy. */

const loggerFactory = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    subscribers: [],
  }) as unknown as LoggerPublisherService;

type CallTaskCallArgs = {
  sessionId: DeviceSessionId;
  deviceAction: CallTaskInAppDeviceAction<
    Uint8Array,
    never,
    UserInteractionRequired.None
  >;
};

const setup = () => {
  const expectedResult = { observable: from([]), cancel: vi.fn() };
  const executeDeviceAction = vi.fn().mockReturnValue(expectedResult);
  const dmk = { executeDeviceAction } as unknown as DeviceManagementKit;
  return {
    executeDeviceAction,
    expectedResult,
    binder: new XrpAppBinder(dmk, "test-session-id", loggerFactory),
  };
};

describe("XrpAppBinder extensions", () => {
  describe("getPqPublicKey", () => {
    it("should execute a CallTaskInAppDeviceAction in the XRP app", () => {
      // GIVEN
      const { executeDeviceAction, expectedResult, binder } = setup();

      // WHEN
      const result = binder.getPqPublicKey({ skipOpenApp: false });

      // THEN
      expect(result).toBe(expectedResult);
      expect(executeDeviceAction).toHaveBeenCalledTimes(1);
      const callArgs = executeDeviceAction.mock
        .calls[0]![0] as CallTaskCallArgs;
      expect(callArgs.sessionId).toBe("test-session-id");
      expect(callArgs.deviceAction).toBeInstanceOf(CallTaskInAppDeviceAction);
      expect(callArgs.deviceAction.input.appName).toBe(APP_NAME);
      expect(callArgs.deviceAction.input.requiredUserInteraction).toBe(
        UserInteractionRequired.None,
      );
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(false);
    });

    it("should forward skipOpenApp", () => {
      // GIVEN
      const { executeDeviceAction, binder } = setup();

      // WHEN
      binder.getPqPublicKey({ skipOpenApp: true });

      // THEN
      const callArgs = executeDeviceAction.mock
        .calls[0]![0] as CallTaskCallArgs;
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(true);
    });
  });

  describe("signTransactionPq", () => {
    const signingData = Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12, 0x00]);

    it("should execute a SignTransactionPqDeviceAction with the signing data", () => {
      // GIVEN
      const { executeDeviceAction, expectedResult, binder } = setup();

      // WHEN
      const result = binder.signTransactionPq({
        transaction: signingData,
        skipOpenApp: false,
      });

      // THEN
      expect(result).toBe(expectedResult);
      const callArgs = executeDeviceAction.mock.calls[0]![0] as {
        sessionId: DeviceSessionId;
        deviceAction: SignTransactionPqDeviceAction;
      };
      expect(callArgs.sessionId).toBe("test-session-id");
      expect(callArgs.deviceAction).toBeInstanceOf(
        SignTransactionPqDeviceAction,
      );
      expect(callArgs.deviceAction.input.transaction).toBe(signingData);
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(false);
      expect(callArgs.deviceAction.input.loggerFactory).toBe(loggerFactory);
    });
  });
});
