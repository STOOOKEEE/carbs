import {
  CallTaskInAppDeviceAction,
  type DeviceManagementKit,
  type DeviceSessionId,
  SendCommandInAppDeviceAction,
} from "@ledgerhq/device-management-kit";
import { from } from "rxjs";
import { vi } from "vitest";

import { GetSessionPolicyCommand } from "@internal/app-binder/command/GetSessionPolicyCommand";
import { SignTransactionPqDeviceAction } from "@internal/app-binder/device-action/SignTransactionPq/SignTransactionPqDeviceAction";

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

  describe("signTransactionPq", () => {
    it("should delegate to the use case with the signing data", () => {
      // GIVEN
      const { executeDeviceAction, expectedResult, signer } = setup();
      const signingData = Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12]);

      // WHEN
      const result = signer.signTransactionPq(signingData, {
        skipOpenApp: true,
      });

      // THEN
      expect(result).toBe(expectedResult);
      const callArgs = executeDeviceAction.mock.calls[0]![0] as {
        sessionId: DeviceSessionId;
        deviceAction: SignTransactionPqDeviceAction;
      };
      expect(callArgs.deviceAction).toBeInstanceOf(
        SignTransactionPqDeviceAction,
      );
      expect(callArgs.deviceAction.input.transaction).toBe(signingData);
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(true);
    });
  });

  describe("getSessionPolicy", () => {
    it("should delegate to the use case and return its result", () => {
      // GIVEN
      const { executeDeviceAction, expectedResult, signer } = setup();

      // WHEN
      const result = signer.getSessionPolicy();

      // THEN
      expect(result).toBe(expectedResult);
      const callArgs = executeDeviceAction.mock.calls[0]![0] as {
        sessionId: DeviceSessionId;
        deviceAction: {
          input: { command: unknown; skipOpenApp: boolean };
        };
      };
      expect(callArgs.deviceAction).toBeInstanceOf(
        SendCommandInAppDeviceAction,
      );
      expect(callArgs.deviceAction.input.command).toBeInstanceOf(
        GetSessionPolicyCommand,
      );
      expect(callArgs.deviceAction.input.skipOpenApp).toBe(false);
    });
  });
});
