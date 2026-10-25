import {
  type Command,
  CommandResultFactory,
  type InternalApi,
  type LoggerPublisherService,
} from "@ledgerhq/device-management-kit";
import { Just, Nothing } from "purify-ts";

import { SignTransactionPqDeviceAction } from "@internal/app-binder/device-action/SignTransactionPq/SignTransactionPqDeviceAction";

import { SignTransactionPqDeviceActionFactory } from "./SignTransactionPqDeviceActionFactory";

const loggerFactory = () =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    subscribers: [],
  }) as unknown as LoggerPublisherService;

const SIGNING_DATA = Uint8Array.from([0x53, 0x54, 0x58, 0x00, 0x12, 0x00]);

describe("SignTransactionPqDeviceActionFactory", () => {
  it("should create a SignTransactionPqDeviceAction", () => {
    const deviceAction = SignTransactionPqDeviceActionFactory({
      transaction: SIGNING_DATA,
      skipOpenApp: false,
      loggerFactory,
    });

    expect(deviceAction).toBeInstanceOf(SignTransactionPqDeviceAction);
    expect(deviceAction.input.transaction).toBe(SIGNING_DATA);
    expect(deviceAction.input.skipOpenApp).toBe(false);
  });

  it("should forward skipOpenApp and default the signing data to empty", () => {
    const deviceAction = SignTransactionPqDeviceActionFactory({
      skipOpenApp: true,
      loggerFactory,
    });

    expect(deviceAction.input.skipOpenApp).toBe(true);
    expect(deviceAction.input.transaction).toHaveLength(0);
  });

  it("should build a sign dependency that sends 0x11 then reads 0x12", async () => {
    const deviceAction = SignTransactionPqDeviceActionFactory({
      transaction: SIGNING_DATA,
      skipOpenApp: true,
      loggerFactory,
    });
    const sendCommand = vi.fn((command: Command<unknown, unknown, unknown>) => {
      const apdu = command.getApdu().getRawApdu();
      if (apdu[1] === 0x11) {
        return Promise.resolve(
          CommandResultFactory({ data: apdu[3] === 1 ? Just(2420) : Nothing }),
        );
      }
      return Promise.resolve(
        CommandResultFactory({
          data: new Uint8Array(apdu[2] === 9 ? 170 : 250),
        }),
      );
    });

    const { signTransactionPq } = deviceAction.extractDependencies({
      sendCommand,
    } as unknown as InternalApi);
    await signTransactionPq({
      input: { transaction: deviceAction.input.transaction },
    });

    const instructions = sendCommand.mock.calls.map(([command]) =>
      Array.from(command.getApdu().getRawApdu().slice(1, 4)),
    );
    expect(instructions[0]).toStrictEqual([0x11, 0x00, 0x01]);
    expect(instructions.slice(1)).toStrictEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => [0x12, index, 0x00]),
    );
  });
});
