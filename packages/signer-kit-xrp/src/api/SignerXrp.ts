import { type GetAddressDAReturnType } from "@api/app-binder/GetAddressDeviceActionTypes";
import { type GetAppConfigDAReturnType } from "@api/app-binder/GetAppConfigDeviceActionTypes";
import { type GetPqPublicKeyDAReturnType } from "@api/app-binder/GetPqPublicKeyDeviceActionTypes";
import { type SignTransactionDAReturnType } from "@api/app-binder/SignTransactionDeviceActionTypes";
import { type AddressOptions } from "@api/model/AddressOptions";
import { type AppConfigOptions } from "@api/model/AppConfigOptions";
import { type PqPublicKeyOptions } from "@api/model/PqPublicKeyOptions";
import { type TransactionOptions } from "@api/model/TransactionOptions";

export interface SignerXrp {
  getAppConfig: (options?: AppConfigOptions) => GetAppConfigDAReturnType;

  getAddress: (
    derivationPath: string,
    options?: AddressOptions,
  ) => GetAddressDAReturnType;

  signTransaction: (
    derivationPath: string,
    transaction: Uint8Array,
    options?: TransactionOptions,
  ) => SignTransactionDAReturnType;

  /**
   * Reads the ML-DSA-44 public key of the app's post-quantum root
   * (`INS 0x10`): 1,312 bytes, derived on the device from the 24 words, so
   * the same seed always gives the same key. Nothing is shown on the device.
   *
   * Requires an XRP app with the post-quantum root (the carbs fork of
   * app-xrp); another app answers `6d00`.
   */
  getPqPublicKey: (options?: PqPublicKeyOptions) => GetPqPublicKeyDAReturnType;
}
