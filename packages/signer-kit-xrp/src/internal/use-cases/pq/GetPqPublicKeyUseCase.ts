import { inject, injectable } from "inversify";

import { type GetPqPublicKeyDAReturnType } from "@api/app-binder/GetPqPublicKeyDeviceActionTypes";
import { type PqPublicKeyOptions } from "@api/model/PqPublicKeyOptions";
import { appBinderTypes } from "@internal/app-binder/di/appBinderTypes";
import { XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

@injectable()
export class GetPqPublicKeyUseCase {
  private readonly _appBinder: XrpAppBinder;

  constructor(@inject(appBinderTypes.AppBinding) appBinder: XrpAppBinder) {
    this._appBinder = appBinder;
  }

  execute(options?: PqPublicKeyOptions): GetPqPublicKeyDAReturnType {
    return this._appBinder.getPqPublicKey({
      skipOpenApp: options?.skipOpenApp ?? false,
    });
  }
}
