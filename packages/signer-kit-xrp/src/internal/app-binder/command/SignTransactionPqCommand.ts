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
import { Just, Maybe, Nothing } from "purify-ts";

import {
  INS,
  PQ_P1_FIRST_CHUNK,
  PQ_P1_NEXT_CHUNK,
  PQ_P2_LAST_CHUNK,
  PQ_P2_MORE_CHUNKS,
  XRP_CLA,
} from "./utils/apduHeaderUtils";
import {
  XRP_APP_ERRORS,
  XrpAppCommandErrorFactory,
  type XrpErrorCodes,
} from "./utils/xrpApplicationErrors";

const SIGNATURE_LENGTH_SIZE = 2;

/**
 * The length of the signature, which the app announces in answer to the last
 * chunk once the user approved the review. The other chunks are acknowledged
 * with an empty body, reported as `Nothing`.
 */
export type SignTransactionPqCommandResponse = Maybe<number>;

export type SignTransactionPqCommandArgs = {
  /** One chunk of the signing data, written as it is. */
  readonly chunkedData: Uint8Array;
  readonly isFirstChunk: boolean;
  readonly isLastChunk: boolean;
};

/**
 * Sends one chunk of the signing data to sign with the ML-DSA-44 key
 * (`INS 0x11`).
 *
 * Chunk-agnostic, like {@link SignTransactionCommand}: splitting the data and
 * reading the signature back belong to `SendSignTransactionPqTask`. P1 is `00`
 * on the first chunk and `01` after it, P2 is `01` on the last chunk; the app
 * copies whatever a chunk carries and only checks the 2,048-byte total. On the
 * last chunk it parses the transaction, applies the session rules (`6986`,
 * `6815`) and shows the review, then answers the signature length (2 bytes,
 * big-endian) once the user approved.
 */
export class SignTransactionPqCommand
  implements
    Command<
      SignTransactionPqCommandResponse,
      SignTransactionPqCommandArgs,
      XrpErrorCodes
    >
{
  readonly name = "SignTransactionPq";

  private readonly args: SignTransactionPqCommandArgs;

  private readonly errorHelper = new CommandErrorHelper<
    SignTransactionPqCommandResponse,
    XrpErrorCodes
  >(XRP_APP_ERRORS, XrpAppCommandErrorFactory);

  constructor(args: SignTransactionPqCommandArgs) {
    this.args = args;
  }

  getApdu(): Apdu {
    const { chunkedData, isFirstChunk, isLastChunk } = this.args;

    const signTransactionPqArgs: ApduBuilderArgs = {
      cla: XRP_CLA,
      ins: INS.PQ_SIGN,
      p1: isFirstChunk ? PQ_P1_FIRST_CHUNK : PQ_P1_NEXT_CHUNK,
      p2: isLastChunk ? PQ_P2_LAST_CHUNK : PQ_P2_MORE_CHUNKS,
    };

    return new ApduBuilder(signTransactionPqArgs)
      .addBufferToData(chunkedData)
      .build();
  }

  parseResponse(
    apduResponse: ApduResponse,
  ): CommandResult<SignTransactionPqCommandResponse, XrpErrorCodes> {
    return Maybe.fromNullable(
      this.errorHelper.getError(apduResponse),
    ).orDefaultLazy(() => {
      const parser = new ApduParser(apduResponse);
      const length = parser.getUnparsedRemainingLength();

      if (length === 0) {
        return CommandResultFactory({ data: Nothing });
      }

      const signatureLength =
        length === SIGNATURE_LENGTH_SIZE
          ? parser.extract16BitUInt()
          : undefined;
      if (signatureLength === undefined) {
        return CommandResultFactory({
          error: new InvalidResponseFormatError(
            "Cannot extract signature length",
          ),
        });
      }

      return CommandResultFactory({ data: Just(signatureLength) });
    });
  }
}
