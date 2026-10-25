import {
  SendCommandInAppDeviceAction,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { GetSessionPolicyCommand } from "@internal/app-binder/command/GetSessionPolicyCommand";
import { APP_NAME } from "@internal/app-binder/constants";

import { GetSessionPolicyDeviceActionFactory } from "./GetSessionPolicyDeviceActionFactory";

vi.mock("@ledgerhq/device-management-kit", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@ledgerhq/device-management-kit")>();
  return {
    ...original,
    SendCommandInAppDeviceAction: vi.fn(),
  };
});

describe("GetSessionPolicyDeviceActionFactory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send GetSessionPolicyCommand in the XRP app, with no user interaction", () => {
    GetSessionPolicyDeviceActionFactory({ skipOpenApp: false });

    expect(SendCommandInAppDeviceAction).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      input: expect.objectContaining({
        appName: APP_NAME,
        requiredUserInteraction: UserInteractionRequired.None,
        skipOpenApp: false,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        command: expect.any(GetSessionPolicyCommand),
      }),
    });
  });

  it("should forward skipOpenApp to the device action", () => {
    GetSessionPolicyDeviceActionFactory({ skipOpenApp: true });

    expect(SendCommandInAppDeviceAction).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      input: expect.objectContaining({ skipOpenApp: true }),
    });
  });
});
