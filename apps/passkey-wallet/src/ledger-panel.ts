// The Ledger part of the test app: the Stax as the account's classical key, then as its
// post-quantum root (ML-DSA-44). Chrome or Edge only: WebHID is not in Safari or Firefox.

import {
  type LedgerAccount,
  type LedgerXrp,
  connectLedger,
  getPqAccount,
  signWithLedger,
  signWithLedgerPq,
} from "@carbs/ledger";

import { element, guarded } from "./dom.ts";
import { type TxJson, accountInfo, autofill, read, submitAndWait } from "./ledger.ts";
import { explorerLink, log, logError } from "./log.ts";
import { type Connection, requestFunding } from "./account.ts";

const ASF_DISABLE_MASTER = 4;
const LSF_DISABLE_MASTER = 0x00100000;
const DROPS_PER_XRP = 1_000_000;

const ui = {
  info: element("ledger-info", HTMLElement),
  connect: element("ledger-connect", HTMLButtonElement),
  fund: element("ledger-fund", HTMLButtonElement),
  migrate: element("ledger-migrate", HTMLButtonElement),
  payForm: element("ledger-pay-form", HTMLFormElement),
  payDestination: element("ledger-pay-destination", HTMLInputElement),
  payAmount: element("ledger-pay-amount", HTMLInputElement),
  payPq: element("ledger-pay-pq", HTMLInputElement),
};

let ledger: LedgerXrp | undefined;
let pqKey: LedgerAccount | undefined;

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

async function signAndSubmit(connection: Connection, tx: TxJson, withPq: boolean): Promise<void> {
  if (ledger === undefined) throw new Error("connect the Ledger first");
  const filled = await autofill(connection.node, connection.defs, {
    ...tx,
    Account: ledger.account.address,
  });
  if (withPq && pqKey === undefined) throw new Error("no ML-DSA key read from the device");
  log(`${String(tx["TransactionType"])} : relisez et validez sur la Stax…`);
  const signed =
    withPq && pqKey !== undefined
      ? await signWithLedgerPq(ledger, connection.defs, pqKey, filled)
      : await signWithLedger(ledger, connection.defs, filled);
  const submitted = await submitAndWait(connection.node, connection.defs, signed);
  log(
    `${String(tx["TransactionType"])} signé ${withPq ? "en ML-DSA-44" : "avec la clé classique"} sur la Stax :`,
    submitted,
  );
}

export async function refreshLedgerPanel(connection: Connection | undefined): Promise<void> {
  const connected = ledger !== undefined && connection !== undefined;
  ui.connect.disabled = connection === undefined || ledger !== undefined;
  const state =
    connected && ledger !== undefined
      ? await accountState(connection, ledger.account.address)
      : undefined;
  const migrated =
    state !== undefined &&
    pqKey !== undefined &&
    state.regularKey === pqKey.address &&
    state.masterDisabled;
  ui.fund.disabled = !connected || state !== undefined;
  ui.migrate.disabled = !connected || state === undefined || migrated;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement)
      field.disabled = state === undefined;
  }
  ui.payPq.checked = migrated;
  ui.payPq.disabled = !migrated;

  if (ledger === undefined) {
    ui.info.textContent = "Stax non connectée (Chrome ou Edge, app XRP ouverte).";
    return;
  }
  ui.info.innerHTML = "";
  ui.info.append(
    "Compte : ",
    explorerLink(`accounts/${ledger.account.address}`, ledger.account.address),
    state === undefined ? " · pas encore financé" : ` · ${state.balance}`,
    document.createElement("br"),
    `Clé ML-DSA-44 de la Stax : ${pqKey?.address ?? "?"}`,
    migrated ? " · racine post-quantique active (clé maître désactivée)" : "",
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
      ledger = await connectLedger();
      pqKey = await getPqAccount(ledger);
      log(`Stax connectée : ${ledger.account.address} (clé ML-DSA : ${pqKey.address}).`);
    }),
  );

  ui.fund.addEventListener(
    "click",
    run(async () => {
      if (ledger === undefined) return;
      await requestFunding(ledger.account.address);
      log(`Compte Stax ${ledger.account.address} financé par le faucet.`);
    }),
  );

  ui.migrate.addEventListener(
    "click",
    run(async () => {
      const connection = getConnection();
      if (connection === undefined || pqKey === undefined) return;
      await signAndSubmit(
        connection,
        { TransactionType: "SetRegularKey", RegularKey: pqKey.address },
        false,
      );
      await signAndSubmit(
        connection,
        { TransactionType: "AccountSet", SetFlag: ASF_DISABLE_MASTER },
        false,
      );
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
      await signAndSubmit(
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
