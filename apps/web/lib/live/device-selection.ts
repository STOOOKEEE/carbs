/**
 * Which device the live parts sign with: the SIMULATED software double (the default, and what
 * the tests run on) or a real Ledger Stax over USB. The real one is connected only by
 * `connect()`, which must run inside a user gesture (WebHID opens its device picker), and its
 * session is closed when the person disconnects, goes back to the simulated device, unplugs the
 * Stax or leaves the page.
 */
import {
  connectLedger,
  describeLedgerError,
  reviewLines,
  type ApduTransport,
  type LedgerDevice,
} from "@carbs/ledger";
import type { Definitions } from "@carbs/sessions";
import { reactive } from "vue";
import type { DevicePort } from "../ports";
import { deviceReview } from "./contract-device";
import { closeLedgerDevice, createLedgerDevicePort, LEDGER_STAX_USB_MODEL } from "./ledger-device";

export type DeviceChoice = "simulated" | "usb";

/** USB vendor id of Ledger devices, as the WebHID `disconnect` event reports it. */
const LEDGER_USB_VENDOR_ID = 0x2c97;

export const NOT_CONNECTED_MESSAGE = "Connect the Ledger Stax over USB first.";

export interface DeviceSelection {
  readonly choice: DeviceChoice;
  /** A real Stax is connected. */
  readonly connected: boolean;
  readonly busy: boolean;
  /** The last connection or disconnection error, described for the person. */
  readonly error: string | null;
  /** Going back to the simulated device closes the real one. */
  choose(choice: DeviceChoice): Promise<void>;
  /** Call it from a click: WebHID asks the person to pick the device. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** The connected Stax; throws when there is none. */
  ledger(): LedgerDevice;
  /** APDUs to whichever Stax is connected when they are sent (it survives a reconnection). */
  readonly transport: ApduTransport;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export function createDeviceSelection(
  connector: () => Promise<LedgerDevice> = () => connectLedger(),
): DeviceSelection {
  // Kept outside the reactive state: the device session is not UI state.
  let device: LedgerDevice | null = null;

  function ledger(): LedgerDevice {
    if (device === null) throw new Error(NOT_CONNECTED_MESSAGE);
    return device;
  }

  async function disconnect(): Promise<void> {
    const closing = device;
    device = null;
    selection.connected = false;
    if (closing === null) return;
    try {
      await closeLedgerDevice(closing);
    } catch (error) {
      selection.error = describeLedgerError(error);
    }
  }

  const selection = reactive<Mutable<DeviceSelection>>({
    choice: "simulated",
    connected: false,
    busy: false,
    error: null,
    async choose(choice: DeviceChoice) {
      selection.choice = choice;
      selection.error = null;
      if (choice === "simulated") await disconnect();
    },
    async connect() {
      if (device !== null) return;
      selection.busy = true;
      selection.error = null;
      try {
        device = await connector();
        selection.choice = "usb";
        selection.connected = true;
      } catch (error) {
        selection.error = describeLedgerError(error);
      } finally {
        selection.busy = false;
      }
    },
    disconnect,
    ledger,
    transport: { exchange: async (apdu) => ledger().exchange(apdu) },
  });
  return selection;
}

/**
 * The device port of the live backend: the simulated double, or the connected Stax, as chosen
 * now. The keys of a Stax are read again after each connection.
 */
export function createSelectableDevice(
  selection: DeviceSelection,
  simulated: DevicePort,
  defs: Definitions,
): DevicePort {
  const real = new WeakMap<LedgerDevice, DevicePort>();

  /** The port of the connected Stax, made once per connection. */
  function stax(): DevicePort {
    const device = selection.ledger();
    let port = real.get(device);
    if (port === undefined) {
      port = createLedgerDevicePort(defs, device);
      real.set(device, port);
    }
    return port;
  }
  const usb = () => selection.choice === "usb";

  return {
    get mode() {
      return usb() ? "live" : simulated.mode;
    },
    get model() {
      if (!usb()) return simulated.model;
      return selection.connected
        ? LEDGER_STAX_USB_MODEL
        : `${LEDGER_STAX_USB_MODEL}, not connected`;
    },
    getPublicKey: async (algorithm) => (usb() ? stax() : simulated).getPublicKey(algorithm),
    // The Stax shows its own review; this one only lists what it will show.
    review: (tx) => (usb() ? deviceReview(reviewLines(tx, defs), false) : simulated.review(tx)),
    reset: () => {
      // A new connection already reads the keys again; a connected Stax drops the ones it read.
      if (!usb()) simulated.reset();
      else if (selection.connected) stax().reset();
    },
    signTransaction: async (algorithm, tx) =>
      (usb() ? stax() : simulated).signTransaction(algorithm, tx),
  };
}

function isLedgerHidEvent(event: Event): boolean {
  const device: unknown = Reflect.get(event, "device");
  return (
    typeof device === "object" &&
    device !== null &&
    Reflect.get(device, "vendorId") === LEDGER_USB_VENDOR_ID
  );
}

/** Closes the session when a Ledger is unplugged (`navigator.hid`) or the page goes away. */
export function watchLedgerDisconnects(
  selection: DeviceSelection,
  page: EventTarget,
  hid: EventTarget | null,
): void {
  page.addEventListener("pagehide", () => void selection.disconnect());
  hid?.addEventListener("disconnect", (event) => {
    if (isLedgerHidEvent(event)) void selection.disconnect();
  });
}
