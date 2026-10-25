import {
  type CallTaskInAppDAError,
  type CallTaskInAppDAIntermediateValue,
  type CallTaskInAppDAOutput,
  type CommandErrorResult,
  type ExecuteDeviceActionReturnType,
  type UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { type PqPublicKey } from "@api/model/PqPublicKey";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";

type GetPqPublicKeyDAUserInteractionRequired = UserInteractionRequired.None;

export type GetPqPublicKeyDAOutput = CallTaskInAppDAOutput<PqPublicKey>;

export type GetPqPublicKeyDAError = CallTaskInAppDAError<
  CommandErrorResult<XrpErrorCodes>["error"]
>;

export type GetPqPublicKeyDAIntermediateValue =
  CallTaskInAppDAIntermediateValue<GetPqPublicKeyDAUserInteractionRequired>;

export type GetPqPublicKeyDAReturnType = ExecuteDeviceActionReturnType<
  GetPqPublicKeyDAOutput,
  GetPqPublicKeyDAError,
  GetPqPublicKeyDAIntermediateValue
>;
