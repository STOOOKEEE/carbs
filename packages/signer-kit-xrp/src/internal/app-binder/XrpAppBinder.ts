import {
  type DeviceManagementKit,
  type DeviceSessionId,
  type LoggerPublisherService,
  SendCommandInAppDeviceAction,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";
import { inject, injectable } from "inversify";

import { type GetAddressDAReturnType } from "@api/app-binder/GetAddressDeviceActionTypes";
import { type GetAppConfigDAReturnType } from "@api/app-binder/GetAppConfigDeviceActionTypes";
import { type GetPqPublicKeyDAReturnType } from "@api/app-binder/GetPqPublicKeyDeviceActionTypes";
import { type SignTransactionDAReturnType } from "@api/app-binder/SignTransactionDeviceActionTypes";
import { type SignTransactionPqDAReturnType } from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { type Curve } from "@api/model/Curve";
import { APP_NAME } from "@internal/app-binder/constants";
import { externalTypes } from "@internal/externalTypes";

import { GetAppConfigCommand } from "./command/GetAppConfigCommand";
import { GetAddressDeviceActionFactory } from "./device-action/GetAddressDeviceActionFactory";
import { GetPqPublicKeyDeviceActionFactory } from "./device-action/GetPqPublicKeyDeviceActionFactory";
import { SignTransactionDeviceActionFactory } from "./device-action/SignTransactionDeviceActionFactory";
import { SignTransactionPqDeviceActionFactory } from "./device-action/SignTransactionPqDeviceActionFactory";

@injectable()
export class XrpAppBinder {
  constructor(
    @inject(externalTypes.Dmk) private dmk: DeviceManagementKit,
    @inject(externalTypes.SessionId) private sessionId: DeviceSessionId,
    @inject(externalTypes.DmkLoggerFactory)
    private dmkLoggerFactory: (tag: string) => LoggerPublisherService,
  ) {}

  getAppConfig(args: { skipOpenApp: boolean }): GetAppConfigDAReturnType {
    return this.dmk.executeDeviceAction({
      sessionId: this.sessionId,
      deviceAction: new SendCommandInAppDeviceAction({
        input: {
          command: new GetAppConfigCommand(),
          appName: APP_NAME,
          requiredUserInteraction: UserInteractionRequired.None,
          skipOpenApp: args.skipOpenApp,
        },
      }),
    });
  }

  getAddress(args: {
    derivationPath: string;
    checkOnDevice: boolean;
    returnChainCode: boolean;
    skipOpenApp: boolean;
    curve: Curve;
  }): GetAddressDAReturnType {
    return this.dmk.executeDeviceAction({
      sessionId: this.sessionId,
      deviceAction: GetAddressDeviceActionFactory(args),
    });
  }

  /**
   * Signs via {@link SignTransactionDeviceActionFactory} with the serialized
   * transaction passed as a factory arg (direct execute path). Nested flows
   * instead omit that arg and set `transaction` on invoke `input`.
   */
  signTransaction(args: {
    derivationPath: string;
    transaction: Uint8Array;
    skipOpenApp: boolean;
    curve: Curve;
  }): SignTransactionDAReturnType {
    return this.dmk.executeDeviceAction({
      sessionId: this.sessionId,
      deviceAction: SignTransactionDeviceActionFactory({
        ...args,
        loggerFactory: this.dmkLoggerFactory,
      }),
    });
  }

  /**
   * Reads the ML-DSA-44 public key of the app's post-quantum root through
   * {@link GetPqPublicKeyDeviceActionFactory}.
   */
  getPqPublicKey(args: { skipOpenApp: boolean }): GetPqPublicKeyDAReturnType {
    return this.dmk.executeDeviceAction({
      sessionId: this.sessionId,
      deviceAction: GetPqPublicKeyDeviceActionFactory(args),
    });
  }

  /**
   * Signs with the ML-DSA-44 key through
   * {@link SignTransactionPqDeviceActionFactory}, the signing data passed as
   * a factory arg (direct execute path).
   */
  signTransactionPq(args: {
    transaction: Uint8Array;
    skipOpenApp: boolean;
  }): SignTransactionPqDAReturnType {
    return this.dmk.executeDeviceAction({
      sessionId: this.sessionId,
      deviceAction: SignTransactionPqDeviceActionFactory({
        ...args,
        loggerFactory: this.dmkLoggerFactory,
      }),
    });
  }
}
