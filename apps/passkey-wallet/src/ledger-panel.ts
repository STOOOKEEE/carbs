// The Ledger part of the test app: the Stax as the account's classical key, then as its
// post-quantum root (ML-DSA-44) once the account was migrated by the web app (Quantum screen).
// Chrome or Edge only: WebHID is not in Safari or Firefox.

import { describeLedgerError, getMlDsaPublicKey } from "@carbs/ledger";
import { isValidClassicAddress } from "ripple-address-codec";
import { deriveAddress } from "ripple-keypairs";

import { element, guarded } from "./dom.ts";
import { bytesToHex } from "./hex.ts";
import type { SubmittedTx, TxJson } from "./ledger.ts";
import { explorerLink, log, logError, logOutcome } from "./log.ts";
import { type Connection, requestFunding } from "./account.ts";
import { paymentTx } from "./session.ts";
import {
  type DeviceKey,
  type Stax,
  accountState,
  connectStax,
  isPostQuantumRoot,
  submitSignedByStax,
} from "./stax.ts";

const DROPS_PER_XRP = 1_000_000;
/** The payment signed with the old classical key once the master key is disabled. */
const CLASSIC_ATTEMPT_XRP = 1;
/** What the ledger answers to the classical key of a migrated account. */
const MASTER_DISABLED = "tefMASTER_DISABLED";
/**
 * How long a read on the existing connection may take before the device counts as gone. Short:
 * the reconnection that follows still needs the click's user activation (5 s in Chrome) for
 * the browser's device chooser.
 */
const EXISTING_READ_TIMEOUT_MS = 2_500;

const ui = {
  info: element("ledger-info", HTMLElement),
  connect: element("ledger-connect", HTMLButtonElement),
  fund: element("ledger-fund", HTMLButtonElement),
  payForm: element("ledger-pay-form", HTMLFormElement),
  payDestination: element("ledger-pay-destination", HTMLInputElement),
  payAmount: element("ledger-pay-amount", HTMLInputElement),
  payPq: element("ledger-pay-pq", HTMLInputElement),
  tryClassic: element("ledger-try-classic", HTMLButtonElement),
};

let stax: Stax | undefined;
/** The last reconnection failed (chooser closed, or the click's activation expired). */
let reconnectNeedsClick = false;

/** The connected Stax account, and whether its account is now controlled by its ML-DSA key. */
export function staxAccount(): { address: string; postQuantum: boolean } | undefined {
  if (stax === undefined) return undefined;
  return { address: stax.account.address, postQuantum: ui.payPq.checked };
}

/** The connected device (the migration panel reads its keys). */
export function connectedStax(): Stax | undefined {
  return stax;
}

/** The ML-DSA-44 key read again from the device, and the account it answered for. */
export interface Reread {
  account: string;
  pqKey: DeviceKey;
}

/** Rejects once ms have passed: a device gone mid-connection never answers. */
function timeout(ms: number): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>();
  setTimeout(() => reject(new Error(`no answer from the Stax after ${ms / 1_000} s`)), ms);
  return promise;
}

/**
 * Opens the device again. connectStax() starts first, inside the click (WebHID's chooser needs
 * its user activation); the stale connection is closed afterwards, its error only logged.
 */
function reconnect(stale: Stax | undefined): Promise<Reread> {
  log("Reconnecting to the Stax (pick it in the browser window if it opens)…");
  const connecting = connectStax();
  if (stale !== undefined)
    stale.device
      .close()
      .catch((error: unknown) =>
        log(`Old Stax connection not closed (${describeLedgerError(error)}).`),
      );
  return connecting.then(
    (next) => {
      stax = next;
      reconnectNeedsClick = false;
      log(`Stax reconnected: ${next.account.address}.`);
      return { account: next.account.address, pqKey: next.pqKey };
    },
    (error: unknown) => {
      reconnectNeedsClick = true;
      throw new Error(
        `cannot reconnect to the Stax (${describeLedgerError(error)}): click "Read the ML-DSA key on the Stax again" once more, the browser window will offer the Stax`,
      );
    },
  );
}

async function readOnExistingConnection(current: Stax): Promise<Reread> {
  const publicKey = bytesToHex(
    await Promise.race([getMlDsaPublicKey(current.device), timeout(EXISTING_READ_TIMEOUT_MS)]),
  );
  log("ML-DSA-44 key read again on the existing connection.");
  return {
    account: current.account.address,
    pqKey: { address: deriveAddress(publicKey), publicKey },
  };
}

/**
 * Reads the ML-DSA-44 key from the device again: on the existing connection when it answers
 * (the app was not reinstalled), otherwise over a new connection. Call it straight from the
 * click, with no await before: the reconnection may need the click's user activation.
 */
export function rereadMlDsaKey(): Promise<Reread> {
  const current = stax;
  if (current === undefined || reconnectNeedsClick) return reconnect(current);
  return readOnExistingConnection(current).catch((error: unknown) => {
    log(
      `Cannot read on the existing connection (${describeLedgerError(error)}): the app was probably reinstalled.`,
    );
    return reconnect(current);
  });
}

/** Signs a transaction of the Stax account on the device (classical or ML-DSA key) and submits it. */
export async function signAndSubmitWithStax(
  connection: Connection,
  tx: TxJson,
  withPq: boolean,
): Promise<SubmittedTx> {
  if (stax === undefined) throw new Error("connect the Ledger first");
  log(`${String(tx["TransactionType"])}: review and approve on the Stax…`);
  const submitted = await submitSignedByStax(connection, stax, tx, withPq);
  log(
    `${String(tx["TransactionType"])} signed ${withPq ? "with ML-DSA-44" : "with the classical key"} on the Stax:`,
    submitted,
  );
  return submitted;
}

export async function refreshLedgerPanel(connection: Connection | undefined): Promise<void> {
  ui.connect.disabled = connection === undefined || stax !== undefined;
  const state =
    stax !== undefined && connection !== undefined
      ? await accountState(connection, stax.account.address)
      : undefined;
  const migrated = stax !== undefined && isPostQuantumRoot(stax, state);
  ui.fund.disabled = stax === undefined || connection === undefined || state !== undefined;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement)
      field.disabled = state === undefined;
  }
  // Never chosen by hand: the account decides, ML-DSA-44 once the master key is disabled.
  ui.payPq.checked = migrated;
  ui.payPq.disabled = true;
  ui.tryClassic.hidden = !migrated;

  if (stax === undefined) {
    ui.info.textContent = "Stax not connected (Chrome or Edge, XRP app open).";
    return;
  }
  ui.info.innerHTML = "";
  ui.info.append(
    "Account: ",
    explorerLink(`accounts/${stax.account.address}`, stax.account.address),
    state === undefined ? " · not funded yet" : ` · ${state.balance}`,
    document.createElement("br"),
    `Stax ML-DSA-44 key: ${stax.pqKey.address}`,
    migrated
      ? " · post-quantum root active (master key disabled)"
      : " · not migrated yet: see 'Migrate to the ML-DSA-44 root' below",
  );
}

export function setupLedgerPanel(
  getConnection: () => Connection | undefined,
  refreshAll: () => Promise<void>,
): void {
  const run = (action: () => Promise<void>) => guarded(action, logError, refreshAll);

  ui.connect.addEventListener(
    "click",
    run(async () => {
      log("Connecting to the Stax (pick it in the browser window)…");
      stax = await connectStax();
      log(`Stax connected: ${stax.account.address} (ML-DSA key: ${stax.pqKey.address}).`);
    }),
  );

  ui.fund.addEventListener(
    "click",
    run(async () => {
      if (stax === undefined) return;
      await requestFunding(stax.account.address);
      log(`Stax account ${stax.account.address} funded by the faucet.`);
    }),
  );

  ui.payForm.addEventListener(
    "submit",
    run(async () => {
      const connection = getConnection();
      if (connection === undefined) return;
      const amount = Number(ui.payAmount.value);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("the amount must be a positive number of XRP");
      await signAndSubmitWithStax(
        connection,
        {
          TransactionType: "Payment",
          Destination: ui.payDestination.value.trim(),
          Amount: String(Math.round(amount * DROPS_PER_XRP)),
        },
        ui.payPq.checked,
      );
    }),
  );

  ui.tryClassic.addEventListener(
    "click",
    run(async () => {
      const connection = getConnection();
      if (connection === undefined || stax === undefined) return;
      await tryClassicKey(connection, stax);
    }),
  );
}

/**
 * Signs a payment with the classical key of a migrated account: the ledger must refuse it
 * (tefMASTER_DISABLED), the demo's proof that the old key no longer controls the account.
 */
async function tryClassicKey(connection: Connection, current: Stax): Promise<void> {
  // The ledger refuses the signature before looking at the destination, so with an empty
  // field any valid other address will do: the Stax's own ML-DSA address.
  const typed = ui.payDestination.value.trim();
  const destination = typed === "" ? current.pqKey.address : typed;
  if (!isValidClassicAddress(destination))
    throw new Error("enter a valid destination (r… address) above");
  log(`Payment of ${CLASSIC_ATTEMPT_XRP} XRP with the old classical key: approve on the Stax…`);
  const submitted = await submitSignedByStax(
    connection,
    current,
    paymentTx(current.account.address, destination, CLASSIC_ATTEMPT_XRP),
    false,
  );
  const refused = submitted.result === MASTER_DISABLED;
  logOutcome(
    refused
      ? "Old classical key refused as expected: the master key is disabled."
      : `Expected ${MASTER_DISABLED} for the old classical key, got:`,
    submitted,
    refused,
  );
}
