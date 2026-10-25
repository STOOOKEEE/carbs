import { inject, injectable } from "inversify";

import { type GetSessionPolicyDAReturnType } from "@api/app-binder/GetSessionPolicyDeviceActionTypes";
import { type SessionPolicyOptions } from "@api/model/SessionPolicyOptions";
import { appBinderTypes } from "@internal/app-binder/di/appBinderTypes";
import { XrpAppBinder } from "@internal/app-binder/XrpAppBinder";

@injectable()
export class GetSessionPolicyUseCase {
  private readonly _appBinder: XrpAppBinder;

  constructor(@inject(appBinderTypes.AppBinding) appBinder: XrpAppBinder) {
    this._appBinder = appBinder;
  }

  execute(options?: SessionPolicyOptions): GetSessionPolicyDAReturnType {
    return this._appBinder.getSessionPolicy({
      skipOpenApp: options?.skipOpenApp ?? false,
    });
  }
}
