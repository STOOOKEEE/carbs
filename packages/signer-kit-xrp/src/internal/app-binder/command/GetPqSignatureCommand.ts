import {
  type Apdu,
  ApduBuilder,
  type ApduBuilderArgs,
  ApduParser,
  type ApduResponse,
  type Command,
  type CommandErrors,
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

/**
 * On this instruction `6982` does not mean a cancellation: the app has no
 * signature to give (none was made since the last `INS 0x11`, or it was
 * refused).
 */
const PQ_SIGNATURE_ERRORS: CommandErrors<XrpErrorCodes> = {
  ...XRP_APP_ERRORS,
  "6982": { message: "No ML-DSA-44 signature to read" },
};

export type GetPqSignatureCommandArgs = {
  /** Index of the chunk to read, from 0. */
  readonly chunkIndex: number;
};

/** One chunk of the ML-DSA-44 signature, as the app answers it. */
export type GetPqSignatureCommandResponse = Uint8Array;

/**
 * Reads one chunk of the last ML-DSA-44 signature (`INS 0x12`, P1 the chunk
 * index, no data): 250-byte chunks of the 2,420-byte signature, the last one
 * 170 bytes. The signature stays readable until the next `INS 0x11` first
 * chunk, so a read that failed can be retried.
 */
export class GetPqSignatureCommand
  implements
    Command<
      GetPqSignatureCommandResponse,
      GetPqSignatureCommandArgs,
      XrpErrorCodes
    >
{
  readonly name = "GetPqSignature";

  private readonly args: GetPqSignatureCommandArgs;

  private readonly errorHelper = new CommandErrorHelper<
    GetPqSignatureCommandResponse,
    XrpErrorCodes
  >(PQ_SIGNATURE_ERRORS, XrpAppCommandErrorFactory);

  constructor(args: GetPqSignatureCommandArgs) {
    this.args = args;
  }

  getApdu(): Apdu {
    const getPqSignatureArgs: ApduBuilderArgs = {
      cla: XRP_CLA,
      ins: INS.PQ_GET_SIGNATURE,
      p1: this.args.chunkIndex,
      p2: P2_DEFAULT,
    };

    return new ApduBuilder(getPqSignatureArgs).build();
  }

  parseResponse(
    apduResponse: ApduResponse,
  ): CommandResult<GetPqSignatureCommandResponse, XrpErrorCodes> {
    return Maybe.fromNullable(
      this.errorHelper.getError(apduResponse),
    ).orDefaultLazy(() => {
      const parser = new ApduParser(apduResponse);
      const length = parser.getUnparsedRemainingLength();
      const chunk = parser.extractFieldByLength(length);

      if (length === 0 || chunk === undefined) {
        return CommandResultFactory({
          error: new InvalidResponseFormatError(
            "Cannot extract signature chunk",
          ),
        });
      }

      return CommandResultFactory({ data: chunk });
    });
  }
}
