import { type GetAddressDAReturnType } from "@api/app-binder/GetAddressDeviceActionTypes";
import { type GetAppConfigDAReturnType } from "@api/app-binder/GetAppConfigDeviceActionTypes";
import { type GetPqPublicKeyDAReturnType } from "@api/app-binder/GetPqPublicKeyDeviceActionTypes";
import { type GetSessionPolicyDAReturnType } from "@api/app-binder/GetSessionPolicyDeviceActionTypes";
import { type SignTransactionDAReturnType } from "@api/app-binder/SignTransactionDeviceActionTypes";
import { type SignTransactionPqDAReturnType } from "@api/app-binder/SignTransactionPqDeviceActionTypes";
import { type AddressOptions } from "@api/model/AddressOptions";
import { type AppConfigOptions } from "@api/model/AppConfigOptions";
import { type PqPublicKeyOptions } from "@api/model/PqPublicKeyOptions";
import { type PqTransactionOptions } from "@api/model/PqTransactionOptions";
import { type SessionPolicyOptions } from "@api/model/SessionPolicyOptions";
import { type TransactionOptions } from "@api/model/TransactionOptions";

export interface SignerXrp {
  getAppConfig: (options?: AppConfigOptions) => GetAppConfigDAReturnType;

  getAddress: (
    derivationPath: string,
    options?: AddressOptions,
  ) => GetAddressDAReturnType;

  /**
   * Signs with the classical key of `derivationPath` (`INS 0x04`, chunked).
   *
   * `transaction` is the transaction's signing fields **without** the XRPL
   * signing prefix: the XRP app prepends `STX\0` itself (`SMT\0` when
   * `SigningPubKey` is empty, for a multi-signature) and the kit forwards the
   * bytes unchanged, so bytes that already start with `STX\0` would be signed
   * with the prefix twice. Set `SigningPubKey` to the device key and leave
   * `TxnSignature` out. The app buffers at most 10,000 bytes (`6700`).
   */
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

  /**
   * Reads the session policy the user set on the device (`INS 0x08`): the
   * default limits on the signing sessions the device agrees to open, and the
   * limits of each session profile. The host can read it, never write it.
   * Nothing is shown on the device.
   *
   * Requires an XRP app that supports signing sessions (the carbs fork of
   * app-xrp); another app answers `6d00`.
   */
  getSessionPolicy: (
    options?: SessionPolicyOptions,
  ) => GetSessionPolicyDAReturnType;
}
