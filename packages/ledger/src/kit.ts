/**
 * The device commands run through Ledger's XRP signer kit, extended for the XRP app of this
 * repository (`@carbs/device-signer-kit-xrp`, `packages/signer-kit-xrp`). Two executors run the
 * same device actions of the kit, so both see the same APDUs:
 *
 * - a real Ledger from `connectLedger()` carries the kit's `SignerXrp`, bound to its Device
 *   Management Kit session: the commands call its public methods (`dmk.executeDeviceAction`);
 * - any other `ApduTransport` (the SIMULATED device, test doubles) runs the kit's exported
 *   device action factories through an internal API whose `sendCommand` is one `exchange`.
 *
 * Errors keep the contract of this package: a status word becomes a `DeviceError` (the
 * instruction it carries is the flow's own, `0x11` for the whole ML-DSA signature); an error
 * thrown by a transport is thrown again as it is.
 */

import {
  ApduResponse,
  type Command,
  type CommandResult,
  CommandResultFactory,
  DeviceActionStatus,
  type DmkError,
  type ExecuteDeviceActionReturnType,
  type InternalApi,
  noopLoggerFactory,
  UnknownDeviceExchangeError,
} from "@ledgerhq/device-management-kit";
import {
  Curve,
  GetAddressDeviceActionFactory,
  GetPqPublicKeyDeviceActionFactory,
  GetSessionPolicyDeviceActionFactory,
  SignTransactionDeviceActionFactory,
  SignTransactionPqDeviceActionFactory,
  type SignerXrp,
} from "@carbs/device-signer-kit-xrp";
import { type Either, Left, Right } from "purify-ts";
import { decodeApdu, DeviceError, type ApduTransport } from "./apdu.js";

/** The flows of the extended kit that the commands of this package use. */
export type XrpKitFlows = Pick<
  SignerXrp,
  "getAddress" | "signTransaction" | "getPqPublicKey" | "signTransactionPq" | "getSessionPolicy"
>;

/** An `ApduTransport` that may carry the extended kit, bound to a real device session. */
export interface XrpTransport extends ApduTransport {
  /** Set on a real Ledger from `connectLedger()`; the commands then use it. */
  readonly signer?: SignerXrp | undefined;
}

/**
 * The XRP app must be open, as before the kit: the kit's OpenApp step is skipped, since this
 * change could not be exercised against a device's dashboard.
 */
export const kSkipOpenApp = true;

/** A transport that threw: kept apart so that its error is thrown again unchanged. */
class TransportExchangeError implements DmkError {
  readonly _tag = "TransportExchangeError";
  readonly message = "the APDU transport failed";
  constructor(readonly originalError: unknown) {}
}

function unavailable(name: string): never {
  throw new Error(`${name} is not available on an APDU transport`);
}

/** The kit's `InternalApi` over one `ApduTransport`: each APDU is one `exchange`. */
export function apduInternalApi(transport: ApduTransport): InternalApi {
  const sendApdu = async (apdu: Uint8Array): Promise<Either<DmkError, ApduResponse>> => {
    try {
      const { data, statusWord } = await transport.exchange(decodeApdu(apdu));
      const statusCode = Uint8Array.of(statusWord >> 8, statusWord & 0xff);
      return Right(new ApduResponse({ statusCode, data }));
    } catch (error) {
      return Left(new TransportExchangeError(error));
    }
  };
  return {
    sendApdu,
    sendCommand: async <Response, Args, ErrorStatusCodes>(
      command: Command<Response, Args, ErrorStatusCodes>,
    ): Promise<CommandResult<Response, ErrorStatusCodes>> =>
      (await sendApdu(command.getApdu().getRawApdu())).caseOf<
        CommandResult<Response, ErrorStatusCodes>
      >({
        // A command error is a device exchange error: the transport's travels inside one.
        Left: (error) =>
          CommandResultFactory<Response, ErrorStatusCodes>({
            error: new UnknownDeviceExchangeError(error),
          }),
        Right: (response) => command.parseResponse(response, undefined),
      }),
    getDeviceModel: () => unavailable("getDeviceModel"),
    getDeviceSessionState: () => unavailable("getDeviceSessionState"),
    getDeviceSessionStateObservable: () => unavailable("getDeviceSessionStateObservable"),
    setDeviceSessionState: () => unavailable("setDeviceSessionState"),
    getManagerApiService: () => unavailable("getManagerApiService"),
    getSecureChannelService: () => unavailable("getSecureChannelService"),
    loggerFactory: noopLoggerFactory,
  };
}

/** The kit's flows over any `ApduTransport`, through its exported device action factories. */
export function apduFlows(transport: ApduTransport): XrpKitFlows {
  const api = apduInternalApi(transport);
  return {
    getAddress: (derivationPath, options) =>
      GetAddressDeviceActionFactory({
        derivationPath,
        checkOnDevice: options?.checkOnDevice ?? false,
        returnChainCode: options?.returnChainCode ?? false,
        skipOpenApp: kSkipOpenApp,
        curve: options?.curve ?? Curve.Secp256k1,
      })._execute(api),
    signTransaction: (derivationPath, transaction, options) =>
      SignTransactionDeviceActionFactory({
        derivationPath,
        transaction,
        skipOpenApp: kSkipOpenApp,
        curve: options?.curve ?? Curve.Secp256k1,
        loggerFactory: noopLoggerFactory,
      })._execute(api),
    getPqPublicKey: () =>
      GetPqPublicKeyDeviceActionFactory({ skipOpenApp: kSkipOpenApp })._execute(api),
    signTransactionPq: (signingData) =>
      SignTransactionPqDeviceActionFactory({
        transaction: signingData,
        skipOpenApp: kSkipOpenApp,
        loggerFactory: noopLoggerFactory,
      })._execute(api),
    getSessionPolicy: () =>
      GetSessionPolicyDeviceActionFactory({ skipOpenApp: kSkipOpenApp })._execute(api),
  };
}

/** The kit bound to the device session when there is one, else run over the transport. */
export function kitFlows(transport: XrpTransport): XrpKitFlows {
  return transport.signer ?? apduFlows(transport);
}

const kStatusWordHex = /^[0-9a-f]{4}$/i;

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code: unknown = Reflect.get(error, "errorCode");
  if (typeof code === "string" && kStatusWordHex.test(code)) return code;
  return errorCodeOf(Reflect.get(error, "originalError"));
}

/** What a device action's error becomes for the callers of this package. */
export function ledgerErrorOf(error: unknown, ins: number): unknown {
  if (
    error instanceof UnknownDeviceExchangeError &&
    error.originalError instanceof TransportExchangeError
  ) {
    return error.originalError.originalError;
  }
  const code = errorCodeOf(error);
  return code === undefined ? error : new DeviceError(Number.parseInt(code, 16), ins);
}

/**
 * Waits for a device action of the kit to end: its output, or its error as `ledgerErrorOf`
 * describes it. `ins` is the instruction a status word is reported against.
 */
export function runDeviceAction<Output, Error, IntermediateValue>(
  { observable }: ExecuteDeviceActionReturnType<Output, Error, IntermediateValue>,
  ins: number,
): Promise<Output> {
  return new Promise((resolve, reject) => {
    let settled = false;
    observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Completed) {
          settled = true;
          resolve(state.output);
        } else if (state.status === DeviceActionStatus.Error) {
          settled = true;
          reject(ledgerErrorOf(state.error, ins));
        } else if (state.status === DeviceActionStatus.Stopped) {
          settled = true;
          reject(new Error("the device action was stopped"));
        }
      },
      error: (error: unknown) => {
        settled = true;
        reject(ledgerErrorOf(error, ins));
      },
      complete: () => {
        if (!settled) reject(new Error("the device action ended without a result"));
      },
    });
  });
}
