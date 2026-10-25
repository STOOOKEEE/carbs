import {
  CallTaskInAppDeviceAction,
  CommandResultFactory,
  type InternalApi,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { type GetPqPublicKeyCommand } from "@internal/app-binder/command/GetPqPublicKeyCommand";
import { APP_NAME } from "@internal/app-binder/constants";

import { GetPqPublicKeyDeviceActionFactory } from "./GetPqPublicKeyDeviceActionFactory";

vi.mock("@ledgerhq/device-management-kit", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@ledgerhq/device-management-kit")>();
  return {
    ...original,
    CallTaskInAppDeviceAction: vi.fn(),
  };
});

type CallTaskInput = {
  input: {
    task: (internalApi: InternalApi) => Promise<unknown>;
    appName: string;
    requiredUserInteraction: UserInteractionRequired;
    skipOpenApp: boolean;
  };
};

describe("GetPqPublicKeyDeviceActionFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should open the XRP app and require no user interaction", () => {
    GetPqPublicKeyDeviceActionFactory({ skipOpenApp: false });

    expect(CallTaskInAppDeviceAction).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      input: expect.objectContaining({
        appName: APP_NAME,
        requiredUserInteraction: UserInteractionRequired.None,
        skipOpenApp: false,
      }),
    });
  });

  it("should forward skipOpenApp to the device action", () => {
    GetPqPublicKeyDeviceActionFactory({ skipOpenApp: true });

    expect(CallTaskInAppDeviceAction).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      input: expect.objectContaining({ skipOpenApp: true }),
    });
  });

  it("should run the public key task: six INS 0x10 reads", async () => {
    GetPqPublicKeyDeviceActionFactory({ skipOpenApp: true });
    const { input } = vi.mocked(CallTaskInAppDeviceAction).mock
      .calls[0]![0] as unknown as CallTaskInput;
    const sendCommand = vi.fn((command: GetPqPublicKeyCommand) => {
      const chunkIndex = command.getApdu().getRawApdu()[2]!;
      return Promise.resolve(
        CommandResultFactory({
          data: new Uint8Array(chunkIndex === 5 ? 62 : 250),
        }),
      );
    });

    await input.task({ sendCommand } as unknown as InternalApi);

    expect(
      sendCommand.mock.calls.map(([command]) =>
        Array.from(command.getApdu().getRawApdu().slice(0, 3)),
      ),
    ).toStrictEqual([0, 1, 2, 3, 4, 5].map((index) => [0xe0, 0x10, index]));
  });
});
