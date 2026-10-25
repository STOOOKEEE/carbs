import {
  CallTaskInAppDeviceAction,
  type CommandErrorResult,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { type PqPublicKey } from "@api/model/PqPublicKey";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import { APP_NAME } from "@internal/app-binder/constants";
import { GetPqPublicKeyTask } from "@internal/app-binder/task/GetPqPublicKeyTask";

/**
 * Build the device action that opens the XRP app, if needed, and runs
 * {@link GetPqPublicKeyTask} on it: the six `INS 0x10` reads of the ML-DSA-44
 * public key. Nothing is shown on the device.
 */
export const GetPqPublicKeyDeviceActionFactory = (args: {
  skipOpenApp: boolean;
}): CallTaskInAppDeviceAction<
  PqPublicKey,
  CommandErrorResult<XrpErrorCodes>["error"],
  UserInteractionRequired.None
> =>
  new CallTaskInAppDeviceAction<
    PqPublicKey,
    CommandErrorResult<XrpErrorCodes>["error"],
    UserInteractionRequired.None
  >({
    input: {
      task: (internalApi) => new GetPqPublicKeyTask(internalApi).run(),
      appName: APP_NAME,
      requiredUserInteraction: UserInteractionRequired.None,
      skipOpenApp: args.skipOpenApp,
    },
  });
