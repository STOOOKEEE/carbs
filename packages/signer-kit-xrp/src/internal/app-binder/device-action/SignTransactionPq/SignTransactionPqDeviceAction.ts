import {
  type CommandResult,
  type DeviceActionStateMachine,
  type InternalApi,
  isSuccessCommandResult,
  OpenAppDeviceAction,
  type StateMachineTypes,
  UnknownDAError,
  UserInteractionRequired,
  XStateDeviceAction,
} from "@ledgerhq/device-management-kit";
import { Left, Right } from "purify-ts";
import { assign, fromPromise, setup } from "xstate";

import {
  type SignTransactionPqDAError,
  type SignTransactionPqDAInput,
  type SignTransactionPqDAIntermediateValue,
  type SignTransactionPqDAInternalState,
  type SignTransactionPqDAOutput,
  SignTransactionPqDAStep,
} from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { type PqSignature } from "@api/model/PqSignature";
import { type XrpSessionErrorCodes } from "@internal/app-binder/command/utils/sessionApplicationErrors";
import { APP_NAME } from "@internal/app-binder/constants";
import { SendSignTransactionPqTask } from "@internal/app-binder/task/SendSignTransactionPqTask";

export type MachineDependencies = {
  readonly signTransactionPq: (arg0: {
    input: {
      transaction: Uint8Array;
    };
  }) => Promise<CommandResult<PqSignature, XrpSessionErrorCodes>>;
};

/**
 * Opens the XRP app (unless skipped), then runs
 * {@link SendSignTransactionPqTask}: the signing data in `INS 0x11` chunks,
 * the review on the device, then the signature read with `INS 0x12`.
 *
 * Built like `SignTransactionDeviceAction`: the signing data lives on the
 * machine `context.input.transaction`, so it can come from the factory or
 * from the parent invoke `input` when this device action is nested.
 */
export class SignTransactionPqDeviceAction extends XStateDeviceAction<
  SignTransactionPqDAOutput,
  SignTransactionPqDAInput,
  SignTransactionPqDAError,
  SignTransactionPqDAIntermediateValue,
  SignTransactionPqDAInternalState
> {
  makeStateMachine(
    internalApi: InternalApi,
  ): DeviceActionStateMachine<
    SignTransactionPqDAOutput,
    SignTransactionPqDAInput,
    SignTransactionPqDAError,
    SignTransactionPqDAIntermediateValue,
    SignTransactionPqDAInternalState
  > {
    type types = StateMachineTypes<
      SignTransactionPqDAOutput,
      SignTransactionPqDAInput,
      SignTransactionPqDAError,
      SignTransactionPqDAIntermediateValue,
      SignTransactionPqDAInternalState
    >;

    const { signTransactionPq } = this.extractDependencies(internalApi);

    return setup({
      types: {
        input: {} as types["input"],
        context: {} as types["context"],
        output: {} as types["output"],
      },
      actors: {
        signTransactionPq: fromPromise(signTransactionPq),
        openAppStateMachine: new OpenAppDeviceAction({
          input: { appName: APP_NAME },
        }).makeStateMachine(internalApi),
      },
      guards: {
        skipOpenApp: ({ context }) => context.input.skipOpenApp,
        noInternalError: ({ context }) => context._internalState.error === null,
      },
      actions: {
        assignErrorFromEvent: assign({
          _internalState: ({
            context,
            event,
          }): SignTransactionPqDAInternalState => {
            const eventError: unknown = (event as { error?: unknown }).error;
            return {
              signature: context._internalState.signature,
              error: new UnknownDAError(
                eventError instanceof Error
                  ? eventError.message
                  : String(eventError),
              ),
            };
          },
        }),
      },
    }).createMachine({
      id: "SignTransactionPqDeviceAction",
      initial: "InitialState",
      context: ({ input }) => ({
        input,
        intermediateValue: {
          requiredUserInteraction: UserInteractionRequired.None,
          step: SignTransactionPqDAStep.OPEN_APP,
        },
        _internalState: {
          error: null,
          signature: null,
        },
      }),
      states: {
        InitialState: {
          always: [
            { target: "SignTransactionPq", guard: "skipOpenApp" },
            "OpenAppDeviceAction",
          ],
        },
        OpenAppDeviceAction: {
          invoke: {
            id: "openAppStateMachine",
            src: "openAppStateMachine",
            input: { appName: APP_NAME },
            onSnapshot: {
              actions: assign({
                intermediateValue: (_) => ({
                  ..._.event.snapshot.context.intermediateValue,
                  step: SignTransactionPqDAStep.OPEN_APP,
                }),
              }),
            },
            onDone: {
              target: "CheckOpenAppDeviceActionResult",
              actions: assign({
                _internalState: (_) =>
                  _.event.output.caseOf<SignTransactionPqDAInternalState>({
                    Right: () => _.context._internalState,
                    Left: (error) => ({
                      ..._.context._internalState,
                      error,
                    }),
                  }),
              }),
            },
          },
        },
        CheckOpenAppDeviceActionResult: {
          always: [
            { target: "SignTransactionPq", guard: "noInternalError" },
            "Error",
          ],
        },
        SignTransactionPq: {
          entry: assign({
            intermediateValue: {
              requiredUserInteraction: UserInteractionRequired.SignTransaction,
              step: SignTransactionPqDAStep.SIGN_TRANSACTION_PQ,
            },
          }),
          invoke: {
            id: "signTransactionPq",
            src: "signTransactionPq",
            // Always from context.input (seeded by factory args or invoke input).
            input: ({ context }) => ({
              transaction: context.input.transaction,
            }),
            onDone: {
              target: "SignTransactionPqResultCheck",
              actions: assign({
                _internalState: ({ event, context }) =>
                  isSuccessCommandResult(event.output)
                    ? {
                        ...context._internalState,
                        signature: event.output.data,
                      }
                    : {
                        ...context._internalState,
                        error: event.output.error,
                      },
              }),
            },
            onError: {
              target: "Error",
              actions: "assignErrorFromEvent",
            },
          },
        },
        SignTransactionPqResultCheck: {
          always: [
            { target: "Success", guard: "noInternalError" },
            { target: "Error" },
          ],
        },
        Success: { type: "final" },
        Error: { type: "final" },
      },
      output: ({ context }) =>
        context._internalState.signature
          ? Right(context._internalState.signature)
          : Left(
              context._internalState.error ||
                new UnknownDAError("No error or signature available"),
            ),
    });
  }

  extractDependencies(internalApi: InternalApi): MachineDependencies {
    const loggerFactory =
      this.input.loggerFactory ?? this.getLoggerFactory(internalApi);

    return {
      signTransactionPq: ({
        input,
      }: {
        input: {
          transaction: Uint8Array;
        };
      }) => {
        // Reject the factory default / missing bytes before hitting the device.
        if (!input.transaction?.length) {
          return Promise.reject(
            new UnknownDAError(
              "SignTransactionPqDeviceAction requires non-empty signing data (factory arg or invoke/context input)",
            ),
          );
        }

        return new SendSignTransactionPqTask(internalApi, {
          signingData: input.transaction,
          loggerFactory,
        }).run();
      },
    };
  }
}
