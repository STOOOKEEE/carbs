import {
  type Apdu,
  ApduBuilder,
  type ApduBuilderArgs,
  ApduParser,
  type ApduResponse,
  type Command,
  type CommandResult,
  CommandResultFactory,
  InvalidResponseFormatError,
} from "@ledgerhq/device-management-kit";
import { CommandErrorHelper } from "@ledgerhq/signer-utils";
import { Maybe } from "purify-ts";

import { INS, P2_DEFAULT, XRP_CLA } from "./utils/apduHeaderUtils";
import {
  XRP_APP_ERRORS,
  XrpAppCommandErrorFactory,
  type XrpErrorCodes,
} from "./utils/xrpApplicationErrors";

export type GetPqPublicKeyCommandArgs = {
  /**
   * Index of the chunk to read, from 0. Reading chunk 0 makes the app derive
   * the key, so a read always starts there.
   */
  readonly chunkIndex: number;
};

/** One chunk of the ML-DSA-44 public key, as the app answers it. */
export type GetPqPublicKeyCommandResponse = Uint8Array;

/**
 * Reads one chunk of the ML-DSA-44 public key of the XRP app's post-quantum
 * root (`INS 0x10`, P1 the chunk index, no data).
 *
 * The app derives the key on chunk 0 (SLIP-21 node of the label
 * `carbs ML-DSA-44`, then `ML-DSA.KeyGen_internal` on its last 32 bytes, so it
 * is recoverable from the 24 words) and answers the 1,312-byte key in 250-byte
 * chunks. Reading the whole key is the job of `GetPqPublicKeyTask`; this
 * command only knows one chunk. A chunk index past the key answers `6b00`.
 */
export class GetPqPublicKeyCommand
  implements
    Command<
      GetPqPublicKeyCommandResponse,
      GetPqPublicKeyCommandArgs,
      XrpErrorCodes
    >
{
  readonly name = "GetPqPublicKey";

  private readonly args: GetPqPublicKeyCommandArgs;

  private readonly errorHelper = new CommandErrorHelper<
    GetPqPublicKeyCommandResponse,
    XrpErrorCodes
  >(XRP_APP_ERRORS, XrpAppCommandErrorFactory);

  constructor(args: GetPqPublicKeyCommandArgs) {
    this.args = args;
  }

  getApdu(): Apdu {
    const getPqPublicKeyArgs: ApduBuilderArgs = {
      cla: XRP_CLA,
      ins: INS.PQ_GET_PUBLIC_KEY,
      p1: this.args.chunkIndex,
      p2: P2_DEFAULT,
    };

    return new ApduBuilder(getPqPublicKeyArgs).build();
  }

  parseResponse(
    apduResponse: ApduResponse,
  ): CommandResult<GetPqPublicKeyCommandResponse, XrpErrorCodes> {
    return Maybe.fromNullable(
      this.errorHelper.getError(apduResponse),
    ).orDefaultLazy(() => {
      const parser = new ApduParser(apduResponse);
      const length = parser.getUnparsedRemainingLength();
      const chunk = parser.extractFieldByLength(length);

      if (length === 0 || chunk === undefined) {
        return CommandResultFactory({
          error: new InvalidResponseFormatError(
            "Cannot extract public key chunk",
          ),
        });
      }

      return CommandResultFactory({ data: chunk });
    });
  }
}
