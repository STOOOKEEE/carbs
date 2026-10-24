/** Device keys as `BytesSigner`s of `@carbs/sessions`, so the same signing code serves every key. */

import { kTxSignPrefix, type BytesSigner } from "@carbs/sessions";
import type { ApduTransport } from "./apdu.js";
import {
  DeviceContractError,
  getClassicPublicKey,
  getMlDsaPublicKey,
  signClassic,
  signMlDsa,
  type DeviceCurve,
} from "./commands.js";

/** The device's ML-DSA-44 root key. `sign` receives `STX\0 ‖ fields` and sends it as it is. */
export async function deviceMlDsaSigner(transport: ApduTransport): Promise<BytesSigner> {
  const publicKey = await getMlDsaPublicKey(transport);
  return { keyType: "ml-dsa-44", publicKey, sign: (data) => signMlDsa(transport, data) };
}

/** A classical device key. `sign` receives `STX\0 ‖ fields` and sends the fields only. */
export async function deviceClassicSigner(
  transport: ApduTransport,
  path: string,
  curve: DeviceCurve,
): Promise<BytesSigner> {
  const { publicKey } = await getClassicPublicKey(transport, path, curve);
  return {
    keyType: curve,
    publicKey,
    sign: async (data) => {
      if (!kTxSignPrefix.every((b, i) => data[i] === b)) {
        throw new DeviceContractError("expected signing data that starts with STX\\0");
      }
      return signClassic(transport, path, curve, data.subarray(kTxSignPrefix.length));
    },
  };
}
