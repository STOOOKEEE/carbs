// The Ledger part of the test app: the Stax as the account's classical key, then as its
// post-quantum root (ML-DSA-44) once the account was migrated by the web app (Quantum screen).
// Chrome or Edge only: WebHID is not in Safari or Firefox.

import {
  type LedgerDevice,
  connectLedger,
  getClassicPublicKey,
  getMlDsaPublicKey,
  kDefaultXrpPath,
  signClassic,
  signMlDsa,
} from "@carbs/ledger";
import { type XrplDefinitions, encodeForSigning } from "ripple-binary-codec";
import { deriveAddress, verify } from "ripple-keypairs";

import { element, guarded } from "./dom.ts";
import { bytesToHex, hexToBytes } from "./hex.ts";
import {
  type SubmittedTx,
  type TxJson,
  accountInfo,
  autofill,
  read,
  submitAndWait,
} from "./ledger.ts";
import { explorerLink, log, logError } from "./log.ts";
import { type Connection, requestFunding } from "./account.ts";

const LSF_DISABLE_MASTER = 0x00100000;
const DROPS_PER_XRP = 1_000_000;
/** XRPL single-signing prefix STX\0: the classical path of the XRP app adds it itself. */
const SIGNING_PREFIX_BYTES = 4;
/** The device's classical account key (what the XRP app derives by default). */
const CLASSIC_CURVE = "secp256k1";

const ui = {
  info: element("ledger-info", HTMLElement),
  connect: element("ledger-connect", HTMLButtonElement),
  fund: element("ledger-fund", HTMLButtonElement),
  payForm: element("ledger-pay-form", HTMLFormElement),
  payDestination: element("ledger-pay-destination", HTMLInputElement),
  payAmount: element("ledger-pay-amount", HTMLInputElement),
  payPq: element("ledger-pay-pq", HTMLInputElement),
};

/** A key of the device: XRPL address and upper-case hex public key. */
interface DeviceKey {
  address: string;
  publicKey: string;
}

interface Stax {
  device: LedgerDevice;
  account: DeviceKey;
  pqKey: DeviceKey;
}

let stax: Stax | undefined;

interface AccountState {
  balance: string;
  regularKey: string | undefined;
  masterDisabled: boolean;
}

async function accountState(
  connection: Connection,
  address: string,
): Promise<AccountState | undefined> {
  const info = await accountInfo(connection.node, address);
  if (info === undefined) return undefined;
  const drops = read(info, ["account_data", "Balance"]);
  const regularKey = read(info, ["account_data", "RegularKey"]);
  const flags = read(info, ["account_data", "Flags"]);
  return {
    balance: typeof drops === "string" ? `${Number(drops) / DROPS_PER_XRP} XRP` : "?",
    regularKey: typeof regularKey === "string" ? regularKey : undefined,
    masterDisabled: typeof flags === "number" && (flags & LSF_DISABLE_MASTER) !== 0,
  };
}

/** The connected Stax account, and whether its account is now controlled by its ML-DSA key. */
export function staxAccount(): { address: string; postQuantum: boolean } | undefined {
  if (stax === undefined) return undefined;
  return { address: stax.account.address, postQuantum: ui.payPq.checked };
}

/** Signs with the account key; the device shows the transaction in clear. */
async function signClassicTx(
  device: LedgerDevice,
  account: DeviceKey,
  tx: TxJson,
  defs: XrplDefinitions,
): Promise<TxJson> {
  const unsigned: TxJson = { ...tx, SigningPubKey: account.publicKey };
  const signingData = encodeForSigning(unsigned, defs);
  const fields = hexToBytes(signingData).subarray(SIGNING_PREFIX_BYTES);
  const signature = bytesToHex(
    await signClassic(device, kDefaultXrpPath, CLASSIC_CURVE, fields),
  );
  if (!verify(signingData, signature, account.publicKey)) {
    throw new Error("the Ledger signature does not verify under the account key");
  }
  return { ...unsigned, TxnSignature: signature };
}

/**
 * Signs with the ML-DSA-44 root: the device parses the signing data (`STX\0` included) and
 * shows it in clear, then signs with pure ML-DSA and an empty context; the node verifies it.
 */
async function signMlDsaTx(
  device: LedgerDevice,
  pqKey: DeviceKey,
  tx: TxJson,
  defs: XrplDefinitions,
): Promise<TxJson> {
  const unsigned: TxJson = { ...tx, SigningPubKey: pqKey.publicKey };
  const signature = await signMlDsa(device, hexToBytes(encodeForSigning(unsigned, defs)));
  return { ...unsigned, TxnSignature: bytesToHex(signature) };
}

/** Signs a transaction of the Stax account on the device (classical or ML-DSA key) and submits it. */
export async function signAndSubmitWithStax(
  connection: Connection,
  tx: TxJson,
  withPq: boolean,
): Promise<SubmittedTx> {
  if (stax === undefined) throw new Error("connect the Ledger first");
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: stax.account.address,
  });
  log(`${String(tx["TransactionType"])} : relisez et validez sur la Stax…`);
  const signed = withPq
    ? await signMlDsaTx(stax.device, stax.pqKey, filled, connection.defs)
    : await signClassicTx(stax.device, stax.account, filled, connection.defs);
  const submitted = await submitAndWait(connection.node, connection.defs, signed);
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
  const migrated =
    state !== undefined &&
    stax !== undefined &&
    state.regularKey === stax.pqKey.address &&
    state.masterDisabled;
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
      : " · migration post-quantique : écran Quantum de l'app web",
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
      const device = await connectLedger();
      try {
        const classic = await getClassicPublicKey(device, kDefaultXrpPath, CLASSIC_CURVE);
        const pqPublicKey = bytesToHex(await getMlDsaPublicKey(device));
        stax = {
          device,
          account: { address: classic.address, publicKey: bytesToHex(classic.publicKey) },
          pqKey: { address: deriveAddress(pqPublicKey), publicKey: pqPublicKey },
        };
      } catch (error) {
        await device.close();
        throw error;
      }
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
