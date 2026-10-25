/* eslint @typescript-eslint/consistent-type-imports: 0 */
import {
  CommandResultFactory,
  DeviceActionStatus,
  type LoggerPublisherService,
  OpenAppDeviceAction,
  UnknownDAError,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";
import { Left, Right } from "purify-ts";
import { type Mock } from "vitest";
import { assign, createMachine } from "xstate";

import { SignTransactionPqDAStep } from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { XrpAppCommandError } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import { makeDeviceActionInternalApiMock } from "@internal/app-binder/device-action/__test-utils__/makeInternalApi";
import { testDeviceActionStates } from "@internal/app-binder/device-action/__test-utils__/testDeviceActionStates";

import { SignTransactionPqDeviceAction } from "./SignTransactionPqDeviceAction";

vi.mock("@ledgerhq/device-management-kit", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@ledgerhq/device-management-kit")>();
  return {
    ...original,
    OpenAppDeviceAction: vi.fn(() => ({
      makeStateMachine: vi.fn(),
    })),
  };
});

const SIGNING_DATA = new Uint8Array([0x53, 0x54, 0x58, 0x00, 0x12, 0x00]);
const SIGNATURE = new Uint8Array(2420).fill(0x5a);

const loggerFactory = (_tag: string): LoggerPublisherService =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    subscribers: [],
  }) as unknown as LoggerPublisherService;

const setupOpenAppDAMock = (error?: unknown) => {
  (OpenAppDeviceAction as Mock).mockImplementation(() => ({
    makeStateMachine: vi.fn().mockImplementation(() =>
      createMachine({
        initial: "pending",
        states: {
          pending: {
            entry: assign({
              intermediateValue: {
                requiredUserInteraction: UserInteractionRequired.ConfirmOpenApp,
              },
            }),
            after: {
              0: "done",
            },
          },
          done: {
            type: "final",
          },
        },
        output: () => (error ? Left(error) : Right(undefined)),
      }),
    ),
  }));
};

describe("SignTransactionPqDeviceAction", () => {
  const apiMock = makeDeviceActionInternalApiMock();
  const signTransactionPqMock = vi.fn();

  const makeDeviceAction = (skipOpenApp: boolean) => {
    const deviceAction = new SignTransactionPqDeviceAction({
      input: {
        transaction: SIGNING_DATA,
        skipOpenApp,
        loggerFactory,
      },
    });
    vi.spyOn(deviceAction, "extractDependencies").mockReturnValue({
      signTransactionPq: signTransactionPqMock,
    });
    return deviceAction;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    signTransactionPqMock.mockResolvedValue(
      CommandResultFactory({ data: SIGNATURE }),
    );
  });

  describe("skipOpenApp: true", () => {
    it("signs the signing data from machine input", () =>
      new Promise<void>((resolve, reject) => {
        const deviceAction = makeDeviceAction(true);

        testDeviceActionStates(
          deviceAction,
          [
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction:
                  UserInteractionRequired.SignTransaction,
                step: SignTransactionPqDAStep.SIGN_TRANSACTION_PQ,
              },
            },
            {
              status: DeviceActionStatus.Completed,
              output: SIGNATURE,
            },
          ],
          apiMock,
          {
            onDone: () => {
              expect(signTransactionPqMock).toHaveBeenCalledWith(
                expect.objectContaining({
                  input: { transaction: SIGNING_DATA },
                }),
              );
              resolve();
            },
            onError: reject,
          },
        );
      }));

    it("forwards a command error from the sign task", () =>
      new Promise<void>((resolve, reject) => {
        const error = new XrpAppCommandError({
          message: "Session refused by the session policy set on the device",
          errorCode: "6986",
        });
        signTransactionPqMock.mockResolvedValue(
          CommandResultFactory({ error }),
        );
        const deviceAction = makeDeviceAction(true);

        testDeviceActionStates(
          deviceAction,
          [
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction:
                  UserInteractionRequired.SignTransaction,
                step: SignTransactionPqDAStep.SIGN_TRANSACTION_PQ,
              },
            },
            {
              status: DeviceActionStatus.Error,
              error,
            },
          ],
          apiMock,
          { onDone: resolve, onError: reject },
        );
      }));
  });

  describe("skipOpenApp: false", () => {
    it("opens the app, forwards ConfirmOpenApp, then signs", () =>
      new Promise<void>((resolve, reject) => {
        setupOpenAppDAMock();
        const deviceAction = makeDeviceAction(false);

        testDeviceActionStates(
          deviceAction,
          [
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction: UserInteractionRequired.None,
                step: SignTransactionPqDAStep.OPEN_APP,
              },
            },
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction: UserInteractionRequired.ConfirmOpenApp,
                step: SignTransactionPqDAStep.OPEN_APP,
              },
            },
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction:
                  UserInteractionRequired.SignTransaction,
                step: SignTransactionPqDAStep.SIGN_TRANSACTION_PQ,
              },
            },
            {
              status: DeviceActionStatus.Completed,
              output: SIGNATURE,
            },
          ],
          apiMock,
          {
            onDone: () => {
              expect(signTransactionPqMock).toHaveBeenCalledTimes(1);
              resolve();
            },
            onError: reject,
          },
        );
      }));

    it("errors when opening the app fails and does not sign", () =>
      new Promise<void>((resolve, reject) => {
        const openAppError = new UnknownDAError("OpenApp failed");
        setupOpenAppDAMock(openAppError);
        const deviceAction = makeDeviceAction(false);

        testDeviceActionStates(
          deviceAction,
          [
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction: UserInteractionRequired.None,
                step: SignTransactionPqDAStep.OPEN_APP,
              },
            },
            {
              status: DeviceActionStatus.Pending,
              intermediateValue: {
                requiredUserInteraction: UserInteractionRequired.ConfirmOpenApp,
                step: SignTransactionPqDAStep.OPEN_APP,
              },
            },
            {
              status: DeviceActionStatus.Error,
              error: openAppError,
            },
          ],
          apiMock,
          {
            onDone: () => {
              expect(signTransactionPqMock).not.toHaveBeenCalled();
              resolve();
            },
            onError: reject,
          },
        );
      }));
  });

  describe("signing data validation", () => {
    it("rejects empty signing data (neither factory arg nor invoke input)", async () => {
      const deviceAction = new SignTransactionPqDeviceAction({
        input: {
          transaction: new Uint8Array(),
          skipOpenApp: true,
          loggerFactory,
        },
      });
      const { signTransactionPq } = deviceAction.extractDependencies(apiMock);

      await expect(
        signTransactionPq({ input: { transaction: new Uint8Array() } }),
      ).rejects.toMatchObject({
        _tag: "UnknownDAError",
        originalError: {
          message:
            "SignTransactionPqDeviceAction requires non-empty signing data (factory arg or invoke/context input)",
        },
      });
    });
  });
});
