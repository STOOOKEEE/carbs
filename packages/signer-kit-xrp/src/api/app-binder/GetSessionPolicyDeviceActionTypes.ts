import {
  type CommandErrorResult,
  type ExecuteDeviceActionReturnType,
  type OpenAppDAError,
  type SendCommandInAppDAIntermediateValue,
  type SendCommandInAppDAOutput,
  type UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { type GetSessionPolicyCommandResponse } from "@internal/app-binder/command/GetSessionPolicyCommand";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";

type GetSessionPolicyDAUserInteractionRequired = UserInteractionRequired.None;

export type GetSessionPolicyDAOutput =
  SendCommandInAppDAOutput<GetSessionPolicyCommandResponse>;

export type GetSessionPolicyDAError =
  | OpenAppDAError
  | CommandErrorResult<XrpErrorCodes>["error"];

export type GetSessionPolicyDAIntermediateValue =
  SendCommandInAppDAIntermediateValue<GetSessionPolicyDAUserInteractionRequired>;

export type GetSessionPolicyDAReturnType = ExecuteDeviceActionReturnType<
  GetSessionPolicyDAOutput,
  GetSessionPolicyDAError,
  GetSessionPolicyDAIntermediateValue
>;
