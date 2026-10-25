import {
  type Command,
  type CommandResult,
  CommandResultFactory,
  type InternalApi,
  InvalidResponseFormatError,
  isSuccessCommandResult,
} from "@ledgerhq/device-management-kit";

import { type XrpErrorCodes } from "@internal/app-binder/command/utils/xrpApplicationErrors";
import { PQ_ANSWER_CHUNK_LENGTH } from "@internal/app-binder/constants";

type ReadPqChunksTaskArgs<Args> = {
  /** Total length of the answer, in bytes. */
  length: number;
  /** The command that reads chunk `chunkIndex`. */
  commandFactory: (
    chunkIndex: number,
  ) => Command<Uint8Array, Args, XrpErrorCodes>;
  /** What is read, for the error messages ("public key", "signature"). */
  label: string;
};

/**
 * Reads an answer that the app splits into {@link PQ_ANSWER_CHUNK_LENGTH}-byte
 * chunks, one command per chunk index, and reassembles it.
 *
 * The ML-DSA-44 public key (`INS 0x10`) and signature (`INS 0x12`) are read
 * this way. Every chunk must have exactly the length its position implies, so
 * a short or long answer is an error rather than a key or signature with a
 * hole in it.
 */
export class ReadPqChunksTask<Args> {
  constructor(
    private api: InternalApi,
    private args: ReadPqChunksTaskArgs<Args>,
  ) {}

  async run(): Promise<CommandResult<Uint8Array, XrpErrorCodes>> {
    const { length, commandFactory, label } = this.args;
    const answer = new Uint8Array(length);
    const chunks = Math.ceil(length / PQ_ANSWER_CHUNK_LENGTH);

    for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
      const result = await this.api.sendCommand(commandFactory(chunkIndex));
      if (!isSuccessCommandResult(result)) {
        return result;
      }

      const offset = chunkIndex * PQ_ANSWER_CHUNK_LENGTH;
      const expected = Math.min(PQ_ANSWER_CHUNK_LENGTH, length - offset);
      if (result.data.length !== expected) {
        return CommandResultFactory({
          error: new InvalidResponseFormatError(
            `The ${label} chunk ${chunkIndex} has ${result.data.length} bytes, expected ${expected}`,
          ),
        });
      }
      answer.set(result.data, offset);
    }

    return CommandResultFactory({ data: answer });
  }
}
