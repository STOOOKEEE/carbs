import {
  addressFromPublicKey,
  bytesToHex,
  encodeForSigning,
  generateClassicSeed,
  type TxJson,
} from "@carbs/sessions";
import { standaloneDefinitions } from "@carbs/sessions/testing";
import { SignerXrpBuilder, type SignerXrp } from "@carbs/device-signer-kit-xrp";
import {
  CallTaskInAppDeviceAction,
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  InvalidResponseFormatError,
  SendCommandInAppDeviceAction,
  UnknownDeviceExchangeError,
} from "@ledgerhq/device-management-kit";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { verify as keypairsVerify } from "ripple-keypairs";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DeviceError, kInsGetAppConfiguration, kInsPqSign, kSw } from "./apdu.js";
import {
  DeviceContractError,
  getAppConfig,
  getClassicPublicKey,
  getMlDsaPublicKey,
  signClassic,
  signMlDsa,
} from "./commands.js";
import { kDefaultXrpPath, ledgerDevice, type DmkSession } from "./device.js";
import { apduInternalApi, ledgerErrorOf, runDeviceAction } from "./kit.js";
import { getSessionPolicy, kSessionPolicyOff, type SessionPolicy } from "./session-policy.js";
import { SimulatedDevice } from "./simulated-device.js";

const defs = standaloneDefinitions();
const kSessionId = "session-1";

function simulatedDevice(sessionPolicy?: SessionPolicy, approve = true) {
  return new SimulatedDevice({
    defs,
    bip39Seed: new Uint8Array(64).fill(7),
    classicSeeds: {
      secp256k1: generateClassicSeed("ecdsa-secp256k1"),
      ed25519: generateClassicSeed("ed25519"),
    },
    approve: async () => approve,
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
  });
}

/**
 * A real `SignerXrp` (the kit's DI container, use cases, binder and factories) on a real
 * `DeviceManagementKit`, whose `executeDeviceAction` runs each device action against the
 * SIMULATED device, as the DMK runs it against a device session.
 */
function kitOnSimulatedDevice(simulated: SimulatedDevice) {
  const dmk = new DeviceManagementKitBuilder().build();
  const executeDeviceAction = vi
    .spyOn(dmk, "executeDeviceAction")
    .mockImplementation(({ deviceAction }) => deviceAction._execute(apduInternalApi(simulated)));
  const signer = new SignerXrpBuilder({ dmk, sessionId: kSessionId }).build();
  const sendApdu = vi.fn<DmkSession["sendApdu"]>();
  const session: DmkSession = { sendApdu, disconnect: vi.fn(), close: vi.fn() };
  return { device: ledgerDevice(session, kSessionId, signer), executeDeviceAction, sendApdu };
}

const sessionSet = (account: string, publicKey: string): TxJson => ({
  TransactionType: "SigningSessionSet",
  Account: account,
  SessionKey: "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy",
  SessionDuration: 600,
  Flags: 0x00010000,
  Fee: "12",
  Sequence: 3,
  LastLedgerSequence: 300,
  SigningPubKey: publicKey,
});

describe("a real Ledger: the commands go through the kit's SignerXrp (SIMULATED device behind)", () => {
  it("reads the ML-DSA key with getPqPublicKey, skipping OpenApp, and never sends raw APDUs", async () => {
    const simulated = simulatedDevice();
    const { device, executeDeviceAction, sendApdu } = kitOnSimulatedDevice(simulated);
    const publicKey = await getMlDsaPublicKey(device);
    expect(publicKey).toEqual(simulated.mlDsaPublicKey);
    const [call] = executeDeviceAction.mock.calls;
    expect(call?.[0].sessionId).toBe(kSessionId);
    expect(call?.[0].deviceAction).toBeInstanceOf(CallTaskInAppDeviceAction);
    expect(call?.[0].deviceAction.input).toMatchObject({ appName: "XRP", skipOpenApp: true });
    expect(sendApdu).not.toHaveBeenCalled();
  });

  it("signs with ML-DSA-44: STX\\0 ‖ fields in, a 2 420-byte signature that verifies", async () => {
    const simulated = simulatedDevice();
    const { device } = kitOnSimulatedDevice(simulated);
    const key = await getMlDsaPublicKey(device);
    const tx = sessionSet(addressFromPublicKey(key), bytesToHex(key));
    const data = encodeForSigning(tx, defs);
    const signature = await signMlDsa(device, data);
    expect(signature).toHaveLength(2420);
    expect(ml_dsa44.verify(signature, data, key)).toBe(true);
    expect(simulated.reviews).toHaveLength(1);
  });

  it("reads the classical key and signs the fields without STX\\0 (the app adds it)", async () => {
    const simulated = simulatedDevice();
    const { device, executeDeviceAction } = kitOnSimulatedDevice(simulated);
    const { publicKey, address } = await getClassicPublicKey(device, kDefaultXrpPath, "secp256k1");
    expect(address).toBe(addressFromPublicKey(publicKey));
    expect(executeDeviceAction.mock.calls[0]?.[0].deviceAction).toBeInstanceOf(
      SendCommandInAppDeviceAction,
    );
    const tx = sessionSet(address, bytesToHex(publicKey));
    const data = encodeForSigning(tx, defs);
    const signature = await signClassic(device, kDefaultXrpPath, "secp256k1", data.subarray(4));
    expect(keypairsVerify(bytesToHex(data), bytesToHex(signature), bytesToHex(publicKey))).toBe(
      true,
    );
  });

  it("reads the session policy with getSessionPolicy, in this package's model", async () => {
    const policy: SessionPolicy = { ...kSessionPolicyOff, enabled: true, maxCapDrops: 50_000_000n };
    const { device } = kitOnSimulatedDevice(simulatedDevice(policy));
    await expect(getSessionPolicy(device)).resolves.toEqual(policy);
  });

  it("keeps the app's session refusal a DeviceError of kind sessionPolicyRefused (0x6986)", async () => {
    // Mode A is not allowed by this policy: the app refuses before any review.
    const policy: SessionPolicy = { ...kSessionPolicyOff, enabled: true, allowAll: false };
    const simulated = simulatedDevice(policy);
    const { device } = kitOnSimulatedDevice(simulated);
    const key = await getMlDsaPublicKey(device);
    const tx = sessionSet(addressFromPublicKey(key), bytesToHex(key));
    const error: unknown = await signMlDsa(device, encodeForSigning(tx, defs)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DeviceError);
    expect(error).toMatchObject({
      statusWord: kSw.sessionPolicyRefused,
      kind: "sessionPolicyRefused",
      ins: kInsPqSign,
    });
    expect(simulated.reviews).toHaveLength(0);
  });

  it("maps a refusal on the device to DeviceError 0x6985", async () => {
    const simulated = simulatedDevice(undefined, false);
    const { device } = kitOnSimulatedDevice(simulated);
    const key = await getMlDsaPublicKey(device);
    const tx = sessionSet(addressFromPublicKey(key), bytesToHex(key));
    await expect(signMlDsa(device, encodeForSigning(tx, defs))).rejects.toMatchObject({
      statusWord: kSw.denied,
      kind: "denied",
    });
  });
});

describe("getAppConfig", () => {
  const signerAnswering = (version: string): SignerXrp => {
    const unused = () => {
      throw new Error("not used");
    };
    return {
      getAppConfig: vi.fn(() => ({
        observable: of({ status: DeviceActionStatus.Completed as const, output: { version } }),
        cancel: vi.fn(),
      })),
      getAddress: unused,
      signTransaction: unused,
      getPqPublicKey: unused,
      signTransactionPq: unused,
      getSessionPolicy: unused,
    };
  };

  it("reads the app version through the kit's signer of a connected Ledger", async () => {
    const signer = signerAnswering("2.8.2");
    const session: DmkSession = { sendApdu: vi.fn(), disconnect: vi.fn(), close: vi.fn() };
    await expect(getAppConfig(ledgerDevice(session, kSessionId, signer))).resolves.toEqual({
      version: "2.8.2",
    });
    expect(signer.getAppConfig).toHaveBeenCalledWith({ skipOpenApp: true });
  });

  it("is refused on a transport without the kit's signer", async () => {
    await expect(getAppConfig(simulatedDevice())).rejects.toThrow(DeviceContractError);
  });
});

describe("the kit's errors, as this package reports them", () => {
  it("turns a status word of the XRP app or of the DMK into a DeviceError", () => {
    expect(ledgerErrorOf({ _tag: "XrpAppCommandError", errorCode: "6815" }, kInsPqSign)).toEqual(
      new DeviceError(kSw.sessionBlindRefused, kInsPqSign),
    );
    const unknown = new UnknownDeviceExchangeError({ message: "UnknownError", errorCode: "6a84" });
    expect(ledgerErrorOf(unknown, kInsGetAppConfiguration)).toMatchObject({
      statusWord: 0x6a84,
      kind: "unknown",
    });
  });

  it("keeps an error without a status word, and a transport's own error, as they are", async () => {
    const format = new InvalidResponseFormatError("Cannot extract public key chunk");
    expect(ledgerErrorOf(format, kInsPqSign)).toBe(format);
    const thrown = { _tag: "DeviceLockedError", errorCode: "5515", message: "locked" };
    const transport = { exchange: () => Promise.reject(thrown) };
    await expect(getMlDsaPublicKey(transport)).rejects.toBe(thrown);
  });

  it("refuses a device action that stopped or ended without a result", async () => {
    await expect(
      runDeviceAction(
        { observable: of({ status: DeviceActionStatus.Stopped }), cancel: vi.fn() },
        kInsPqSign,
      ),
    ).rejects.toThrow("stopped");
    await expect(
      runDeviceAction({ observable: of(), cancel: vi.fn() }, kInsPqSign),
    ).rejects.toThrow("without a result");
  });
});
