import {
  type CommandResult,
  type InternalApi,
} from "@ledgerhq/device-management-kit";

import { type PqPublicKey } from "@api/model/PqPublicKey";
import { GetPqPublicKeyCommand } from "@internal/app-binder/command/GetPqPublicKeyCommand";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import { ML_DSA_44_PUBLIC_KEY_LENGTH } from "@internal/app-binder/constants";
import { ReadPqChunksTask } from "@internal/app-binder/task/ReadPqChunksTask";

/**
 * Reads the whole ML-DSA-44 public key with {@link GetPqPublicKeyCommand}:
 * chunks 0 to 5 of the 1,312 bytes, chunk 0 first since it makes the app
 * derive the key.
 */
export class GetPqPublicKeyTask {
  constructor(private api: InternalApi) {}

  run(): Promise<CommandResult<PqPublicKey, XrpErrorCodes>> {
    return new ReadPqChunksTask(this.api, {
      length: ML_DSA_44_PUBLIC_KEY_LENGTH,
      commandFactory: (chunkIndex) => new GetPqPublicKeyCommand({ chunkIndex }),
      label: "public key",
    }).run();
  }
}
