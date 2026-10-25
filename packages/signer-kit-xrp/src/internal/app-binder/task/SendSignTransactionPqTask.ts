import {
  APDU_MAX_PAYLOAD,
  type CommandResult,
  CommandResultFactory,
  type InternalApi,
  InvalidArgumentError,
  InvalidResponseFormatError,
  isSuccessCommandResult,
  type LoggerPublisherService,
} from "@ledgerhq/device-management-kit";
import { Nothing } from "purify-ts";

import { type PqSignature } from "@api/model/PqSignature";
import { GetPqSignatureCommand } from "@internal/app-binder/command/GetPqSignatureCommand";
import {
  SignTransactionPqCommand,
  type SignTransactionPqCommandResponse,
} from "@internal/app-binder/command/SignTransactionPqCommand";
import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import {
  ML_DSA_44_SIGNATURE_LENGTH,
  PQ_MAX_SIGNING_DATA_LENGTH,
  XRPL_SINGLE_SIGNING_PREFIX,
} from "@internal/app-binder/constants";
import { ReadPqChunksTask } from "@internal/app-binder/task/ReadPqChunksTask";

type SendSignTransactionPqTaskArgs = {
  /**
   * The signing data: `STX\0`, then the transaction's signing fields with
   * `SigningPubKey` set to the 1,312-byte ML-DSA-44 public key.
   */
  signingData: Uint8Array;
  loggerFactory: (tag: string) => LoggerPublisherService;
};

const startsWithSigningPrefix = (data: Uint8Array) =>
  data.length > XRPL_SINGLE_SIGNING_PREFIX.length &&
  XRPL_SINGLE_SIGNING_PREFIX.every((byte, i) => data[i] === byte);

/**
 * Signs with the ML-DSA-44 key: sends the signing data in APDU-sized chunks
 * with {@link SignTransactionPqCommand} (the device reviews the transaction
 * on the last one), checks the signature length the app announces, then reads
 * the 2,420-byte signature with {@link GetPqSignatureCommand}.
 *
 * Unlike the classical path, the data carries the `STX\0` prefix: the app
 * checks it, parses the rest with its own parser, and signs the whole buffer,
 * prefix included, with pure ML-DSA-44 as the node verifies it. Data without
 * the prefix, or longer than the app's 2,048 bytes, is refused here before
 * anything reaches the device.
 */
export class SendSignTransactionPqTask {
  private readonly _logger: LoggerPublisherService;

  constructor(
    private api: InternalApi,
    private args: SendSignTransactionPqTaskArgs,
  ) {
    this._logger = args.loggerFactory("SendSignTransactionPqTask");
  }

  async run(): Promise<CommandResult<PqSignature, XrpErrorCodes>> {
    const { signingData } = this.args;

    if (!startsWithSigningPrefix(signingData)) {
      return CommandResultFactory({
        error: new InvalidArgumentError(
          "The ML-DSA signing data must start with the STX\\0 prefix (53545800)",
        ),
      });
    }
    if (signingData.length > PQ_MAX_SIGNING_DATA_LENGTH) {
      return CommandResultFactory({
        error: new InvalidArgumentError(
          `The app signs at most ${PQ_MAX_SIGNING_DATA_LENGTH} bytes with ML-DSA-44, got ${signingData.length}`,
        ),
      });
    }

    const chunks: Uint8Array[] = [];
    for (
      let offset = 0;
      offset < signingData.length;
      offset += APDU_MAX_PAYLOAD
    ) {
      chunks.push(signingData.slice(offset, offset + APDU_MAX_PAYLOAD));
    }
    this._logger.debug("[run] Sending signing data in chunks", {
      data: {
        chunksCount: chunks.length,
        signingDataLength: signingData.length,
      },
    });

    let announced: SignTransactionPqCommandResponse = Nothing;
    for (let i = 0; i < chunks.length; i++) {
      const result = await this.api.sendCommand(
        new SignTransactionPqCommand({
          chunkedData: chunks[i]!,
          isFirstChunk: i === 0,
          isLastChunk: i === chunks.length - 1,
        }),
      );

      if (!isSuccessCommandResult(result)) {
        this._logger.error("[run] Failed to send signing data chunk", {
          data: { chunkIndex: i, error: result.error },
        });
        return result;
      }

      announced = result.data;
    }

    const signatureLength = announced.orDefault(0);
    if (signatureLength !== ML_DSA_44_SIGNATURE_LENGTH) {
      return CommandResultFactory({
        error: new InvalidResponseFormatError(
          `Expected a ${ML_DSA_44_SIGNATURE_LENGTH}-byte signature, the app announced ${signatureLength}`,
        ),
      });
    }

    return new ReadPqChunksTask(this.api, {
      length: ML_DSA_44_SIGNATURE_LENGTH,
      commandFactory: (chunkIndex) => new GetPqSignatureCommand({ chunkIndex }),
      label: "signature",
    }).run();
  }
}
