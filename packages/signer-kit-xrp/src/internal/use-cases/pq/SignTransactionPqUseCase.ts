import { inject, injectable } from "inversify";

import { type SignTransactionPqDAReturnType } from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { type PqTransactionOptions } from "@api/model/PqTransactionOptions";
import { appBinderTypes } from "@internal/app-binder/di/appBinderTypes";
import { XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

@injectable()
export class SignTransactionPqUseCase {
  private readonly _appBinder: XrpAppBinder;

  constructor(@inject(appBinderTypes.AppBinding) appBinder: XrpAppBinder) {
    this._appBinder = appBinder;
  }

  execute(
    transaction: Uint8Array,
    options?: PqTransactionOptions,
  ): SignTransactionPqDAReturnType {
    return this._appBinder.signTransactionPq({
      transaction,
      skipOpenApp: options?.skipOpenApp ?? false,
    });
  }
}
