// The Ledger part of the test app: the Stax as the account's classical key, then as its
// post-quantum root (ML-DSA-44) once the account was migrated by the web app (Quantum screen).
// Chrome or Edge only: WebHID is not in Safari or Firefox.

import { describeLedgerError, getMlDsaPublicKey } from "@carbs/ledger";
import { deriveAddress } from "ripple-keypairs";

import { element, guarded } from "./dom.ts";
import { bytesToHex } from "./hex.ts";
import type { SubmittedTx, TxJson } from "./ledger.ts";
import { explorerLink, log, logError } from "./log.ts";
import { type Connection, requestFunding } from "./account.ts";
import {
  type DeviceKey,
  type Stax,
  accountState,
  connectStax,
  isPostQuantumRoot,
  submitSignedByStax,
} from "./stax.ts";

const DROPS_PER_XRP = 1_000_000;
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
  log("Reconnexion à la Stax (choisissez-la dans la fenêtre du navigateur si elle s'ouvre)…");
  const connecting = connectStax();
  if (stale !== undefined)
    stale.device
      .close()
      .catch((error: unknown) =>
        log(`Ancienne connexion à la Stax non fermée (${describeLedgerError(error)}).`),
      );
  return connecting.then(
    (next) => {
      stax = next;
      reconnectNeedsClick = false;
      log(`Stax reconnectée : ${next.account.address}.`);
      return { account: next.account.address, pqKey: next.pqKey };
    },
    (error: unknown) => {
      reconnectNeedsClick = true;
      throw new Error(
        `reconnexion à la Stax impossible (${describeLedgerError(error)}) : cliquez à nouveau sur « Relire la clé », la fenêtre du navigateur proposera la Stax`,
      );
    },
  );
}

async function readOnExistingConnection(current: Stax): Promise<Reread> {
  const publicKey = bytesToHex(
    await Promise.race([getMlDsaPublicKey(current.device), timeout(EXISTING_READ_TIMEOUT_MS)]),
  );
  log("Clé ML-DSA-44 relue sur la connexion existante.");
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
      `Lecture sur la connexion existante impossible (${describeLedgerError(error)}) : l'app a sans doute été réinstallée.`,
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
  log(`${String(tx["TransactionType"])} : relisez et validez sur la Stax…`);
  const submitted = await submitSignedByStax(connection, stax, tx, withPq);
  log(
    `${String(tx["TransactionType"])} signé ${withPq ? "en ML-DSA-44" : "avec la clé classique"} sur la Stax :`,
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
  ui.payPq.checked = migrated;
  ui.payPq.disabled = !migrated;

  if (stax === undefined) {
    ui.info.textContent = "Stax non connectée (Chrome ou Edge, app XRP ouverte).";
    return;
  }
  ui.info.innerHTML = "";
  ui.info.append(
    "Compte : ",
    explorerLink(`accounts/${stax.account.address}`, stax.account.address),
    state === undefined ? " · pas encore financé" : ` · ${state.balance}`,
    document.createElement("br"),
    `Clé ML-DSA-44 de la Stax : ${stax.pqKey.address}`,
    migrated
      ? " · racine post-quantique active (clé maître désactivée)"
      : " · pas encore migrée : voir « Migrer vers la racine ML-DSA-44 » ci-dessous",
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
      log("Connexion à la Stax (choisissez-la dans la fenêtre du navigateur)…");
      stax = await connectStax();
      log(`Stax connectée : ${stax.account.address} (clé ML-DSA : ${stax.pqKey.address}).`);
    }),
  );

  ui.fund.addEventListener(
    "click",
    run(async () => {
      if (stax === undefined) return;
      await requestFunding(stax.account.address);
      log(`Compte Stax ${stax.account.address} financé par le faucet.`);
    }),
  );

  ui.payForm.addEventListener("submit", (event) => {
    event.preventDefault();
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
    })();
  });
}
