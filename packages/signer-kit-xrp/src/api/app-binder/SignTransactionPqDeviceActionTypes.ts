import {
  type CommandErrorResult,
  type ExecuteDeviceActionReturnType,
  type LoggerPublisherService,
  type OpenAppDAError,
  type OpenAppDARequiredInteraction,
  type UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { type PqSignature } from "@api/model/PqSignature";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";

export type SignTransactionPqDAOutput = PqSignature;

/**
 * Device-action input for `SignTransactionPqDeviceAction`.
 *
 * Like `SignTransactionDAInput`, the signing data can come from the factory
 * (direct `executeDeviceAction`) or from the parent invoke `input` when this
 * machine is nested; the sign step rejects it if it is missing or empty.
 */
export type SignTransactionPqDAInput = {
  /**
   * The signing data: `STX\0` then the transaction's signing fields, with
   * `SigningPubKey` the 1,312-byte ML-DSA-44 public key. At most 2,048 bytes.
   */
  readonly transaction: Uint8Array;
  readonly skipOpenApp: boolean;
  readonly loggerFactory: (tag: string) => LoggerPublisherService;
};

export type SignTransactionPqDAError =
  | OpenAppDAError
  | CommandErrorResult<XrpErrorCodes>["error"];

type SignTransactionPqDARequiredInteraction =
  | OpenAppDARequiredInteraction
  | UserInteractionRequired.SignTransaction;

export enum SignTransactionPqDAStep {
  OPEN_APP = "signer.xrp.steps.openApp",
  SIGN_TRANSACTION_PQ = "signer.xrp.steps.signTransactionPq",
}

export type SignTransactionPqDAIntermediateValue = {
  requiredUserInteraction: SignTransactionPqDARequiredInteraction;
  step: SignTransactionPqDAStep;
};

export type SignTransactionPqDAInternalState = {
  readonly error: SignTransactionPqDAError | null;
  readonly signature: PqSignature | null;
};

export type SignTransactionPqDAReturnType = ExecuteDeviceActionReturnType<
  SignTransactionPqDAOutput,
  SignTransactionPqDAError,
  SignTransactionPqDAIntermediateValue
>;
