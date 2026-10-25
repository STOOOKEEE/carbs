import {
  SendCommandInAppDeviceAction,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import {
  GetSessionPolicyCommand,
  type GetSessionPolicyCommandResponse,
} from "@internal/app-binder/command/GetSessionPolicyCommand";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import { APP_NAME } from "@internal/app-binder/constants";

/**
 * Build the device action that opens the XRP app, if needed, and reads its
 * session policy with {@link GetSessionPolicyCommand}. Nothing is shown on the
 * device.
 */
export const GetSessionPolicyDeviceActionFactory = (args: {
  skipOpenApp: boolean;
}): SendCommandInAppDeviceAction<
  GetSessionPolicyCommandResponse,
  void,
  XrpErrorCodes,
  UserInteractionRequired.None
> =>
  new SendCommandInAppDeviceAction<
    GetSessionPolicyCommandResponse,
    void,
    XrpErrorCodes,
    UserInteractionRequired.None
  >({
    input: {
      command: new GetSessionPolicyCommand(),
      appName: APP_NAME,
      requiredUserInteraction: UserInteractionRequired.None,
      skipOpenApp: args.skipOpenApp,
    },
  });
