import { type GetAddressDAReturnType } from "@api/app-binder/GetAddressDeviceActionTypes";
import { type GetAppConfigDAReturnType } from "@api/app-binder/GetAppConfigDeviceActionTypes";
import { type GetPqPublicKeyDAReturnType } from "@api/app-binder/GetPqPublicKeyDeviceActionTypes";
import { type SignTransactionDAReturnType } from "@api/app-binder/SignTransactionDeviceActionTypes";
import { type SignTransactionPqDAReturnType } from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { type AddressOptions } from "@api/model/AddressOptions";
import { type AppConfigOptions } from "@api/model/AppConfigOptions";
import { type PqPublicKeyOptions } from "@api/model/PqPublicKeyOptions";
import { type PqTransactionOptions } from "@api/model/PqTransactionOptions";
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

  /**
   * Signs with the ML-DSA-44 key of the app's post-quantum root (`INS 0x11`
   * in chunks, the review on the device, then `INS 0x12`): a 2,420-byte
   * signature, pure ML-DSA-44 with an empty context, as the XRPL node verifies
   * it.
   *
   * Unlike {@link SignerXrp.signTransaction}, `signingData` carries the
   * `STX\0` prefix: `STX\0` then the signing fields of the transaction, with
   * `SigningPubKey` the 1,312-byte key of {@link SignerXrp.getPqPublicKey}
   * and no `TxnSignature`; at most 2,048 bytes in all. The app parses it and
   * shows the same review as for a classical signature, and refuses a session
   * transaction it cannot show in full (`6815`) or that the session policy
   * refuses (`6986`).
   */
  signTransactionPq: (
    signingData: Uint8Array,
    options?: PqTransactionOptions,
  ) => SignTransactionPqDAReturnType;
}
