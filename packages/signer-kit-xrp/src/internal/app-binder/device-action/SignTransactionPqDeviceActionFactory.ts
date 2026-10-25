import { type LoggerPublisherService } from "@ledgerhq/device-management-kit";

import { SignTransactionPqDeviceAction } from "@internal/app-binder/device-action/SignTransactionPq/SignTransactionPqDeviceAction";

/**
 * Build the device action that opens the XRP app, if needed, and signs with
 * the ML-DSA-44 key ({@link SendSignTransactionPqTask}).
 *
 * As for {@link SignTransactionDeviceActionFactory}, the signing data can be
 * given here (direct `executeDeviceAction`) or omitted and supplied on the
 * parent invoke `input` when the action is nested.
 */
export const SignTransactionPqDeviceActionFactory = (args: {
  /**
   * The signing data, `STX\0` included. Optional for nested actors (override
   * via invoke `input`); defaults to an empty buffer so construction stays
   * typed.
   */
  transaction?: Uint8Array;
  skipOpenApp: boolean;
  loggerFactory: (tag: string) => LoggerPublisherService;
}): SignTransactionPqDeviceAction =>
  new SignTransactionPqDeviceAction({
    input: {
      transaction: args.transaction ?? new Uint8Array(),
      skipOpenApp: args.skipOpenApp,
      loggerFactory: args.loggerFactory,
    },
    logger: args.loggerFactory("SignTransactionPqDeviceAction"),
  });
