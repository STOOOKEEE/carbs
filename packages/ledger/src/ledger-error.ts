/**
 * A message for the user from whatever a device call threw: this package's `DeviceError`, or a
 * Device Management Kit error, which is a plain object (`_tag`, `errorCode`, `message`,
 * `originalError`; `@ledgerhq/device-management-kit` 1.11.0, `lib/types/src/api/Error.d.ts`)
 * and would otherwise print as `[object Object]`.
 */

import { DeviceError, formatStatusWord, kSw } from "./apdu.js";

/** The OS answer while the device is locked. */
const kSwLocked = 0x5515;
const kStatusWordHex = /^[0-9a-f]{4}$/i;

const kStatusHints = new Map<number, string>([
  [kSw.denied, "refused on the device"],
  [kSwLocked, "the device is locked"],
  [kSw.noSignature, "the device is locked, or no signature is waiting on it"],
  [kSw.insNotSupported, "the XRP app does not know this instruction (wrong app version?)"],
  [kSw.claNotSupported, "the open app is not the XRP app"],
  [kSw.wrongData, "the XRP app refused the data"],
  [kSw.wrongLength, "the transaction is too large for the XRP app"],
]);

function stringField(error: object, key: string): string | undefined {
  const value: unknown = Reflect.get(error, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The status word of the error or of the error it wraps. */
function statusWordOf(error: object): number | undefined {
  if (error instanceof DeviceError) return error.statusWord;
  const code = stringField(error, "errorCode");
  if (code !== undefined && kStatusWordHex.test(code)) return Number.parseInt(code, 16);
  const original: unknown = Reflect.get(error, "originalError");
  return typeof original === "object" && original !== null ? statusWordOf(original) : undefined;
}

export function describeLedgerError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const statusWord = statusWordOf(error);
  const hint = statusWord === undefined ? undefined : kStatusHints.get(statusWord);
  if (statusWord !== undefined && hint !== undefined)
    return `${hint} (${formatStatusWord(statusWord)})`;
  if (error instanceof Error) return error.message;
  return [
    stringField(error, "_tag") ?? "Ledger error",
    stringField(error, "errorCode"),
    stringField(error, "message"),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}
