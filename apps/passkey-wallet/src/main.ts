// Page wiring: the passkey wallet (no device), the Ledger, session and AI agent panels,
// one shared node connection.

import { refreshAgentPanel, setupAgentPanel } from "./agent-panel.ts";
import { NODE_URL } from "./config.ts";
import { element, guarded } from "./dom.ts";
import { accountInfo, loadDefinitions, read } from "./ledger.ts";
import { refreshLedgerPanel, setupLedgerPanel } from "./ledger-panel.ts";
import { explorerLink, log, logError } from "./log.ts";
import { NodeClient } from "./rpc.ts";
import { refreshSessionPanel, setupSessionPanel } from "./session-panel.ts";
import { type StoredWallet, clearWallet, loadWallet, saveWallet } from "./storage.ts";
import {
  type Connection,
  lockToPasskey,
  openAccount,
  payWithPasskey,
  registerPasskey,
} from "./account.ts";

const DROPS_PER_XRP = 1_000_000;

const ui = {
  nodeStatus: element("node-status", HTMLElement),
  accountInfo: element("account-info", HTMLElement),
  passkeyInfo: element("passkey-info", HTMLElement),
  openAccount: element("open-account", HTMLButtonElement),
  forgetAccount: element("forget-account", HTMLButtonElement),
  registerPasskey: element("register-passkey", HTMLButtonElement),
  lockAccount: element("lock-account", HTMLButtonElement),
  payForm: element("pay-form", HTMLFormElement),
  payDestination: element("pay-destination", HTMLInputElement),
  payAmount: element("pay-amount", HTMLInputElement),
};

let connection: Connection | undefined;
let wallet: StoredWallet | undefined = loadWallet();

async function refreshPasskeyWallet(): Promise<void> {
  const ready = connection !== undefined;
  ui.openAccount.disabled = !ready || wallet !== undefined;
  ui.forgetAccount.disabled = wallet === undefined;
  ui.registerPasskey.disabled =
    !ready || wallet?.masterSeed === undefined || wallet.passkey !== undefined;
  ui.lockAccount.disabled = !ready || wallet?.passkey === undefined || wallet.passkeyOnly;
  for (const field of ui.payForm.elements) {
    if (field instanceof HTMLInputElement || field instanceof HTMLButtonElement) {
      field.disabled = !ready || wallet?.passkey === undefined;
    }
  }

  if (wallet === undefined) {
    ui.accountInfo.textContent = "Aucun compte dans ce navigateur.";
  } else {
    let balance = "pas encore financé";
    if (connection !== undefined) {
      const drops = read(await accountInfo(connection.node, wallet.address), [
        "account_data",
        "Balance",
      ]);
      if (typeof drops === "string") balance = `${Number(drops) / DROPS_PER_XRP} XRP`;
    }
    const mode = wallet.passkeyOnly
      ? "passkey uniquement (clé maître désactivée)"
      : "clé maître + passkey";
    ui.accountInfo.innerHTML = "";
    ui.accountInfo.append(
      explorerLink(`accounts/${wallet.address}`, wallet.address),
      ` · ${balance} · ${mode}`,
    );
  }
  ui.passkeyInfo.textContent =
    wallet?.passkey === undefined
      ? "Pas de passkey."
      : `PasskeyID ${wallet.passkey.id.slice(0, 16)}… · clé publique P-256 ${wallet.passkey.publicKey.slice(0, 12)}…`;
}

async function refresh(): Promise<void> {
  await refreshPasskeyWallet();
  await refreshLedgerPanel(connection);
  await refreshSessionPanel(connection);
  await refreshAgentPanel(connection);
}

const run = (action: () => Promise<void>) => guarded(action, logError, refresh);

function store(next: StoredWallet | undefined): void {
  wallet = next;
  if (next === undefined) clearWallet();
  else saveWallet(next);
}

ui.openAccount.addEventListener(
  "click",
  run(async () => {
    log("Création du compte et financement par le faucet…");
    const opened = await openAccount();
    store(opened);
    log(`Compte ${opened.address} créé.`);
  }),
);

ui.forgetAccount.addEventListener("click", () => {
  if (
    confirm(
      "Oublier ce compte dans ce navigateur ? Sans la passkey ni la clé maître, il sera inaccessible.",
    )
  ) {
    store(undefined);
    void refresh().catch(logError);
  }
});

ui.registerPasskey.addEventListener(
  "click",
  run(async () => {
    if (connection === undefined || wallet === undefined) return;
    log("Création de la passkey (Touch ID)…");
    const { passkey, tx } = await registerPasskey(connection, wallet);
    log("PasskeyListSet signé par la clé maître :", tx);
    if (tx.result === "tesSUCCESS") store({ ...wallet, passkey });
  }),
);

ui.lockAccount.addEventListener(
  "click",
  run(async () => {
    if (connection === undefined || wallet === undefined) return;
    const results = await lockToPasskey(connection, wallet);
    for (const tx of results) log("Verrouillage :", tx);
    if (results.length === 2 && results.every((tx) => tx.result === "tesSUCCESS")) {
      const { masterSeed: _discarded, ...rest } = wallet;
      store({ ...rest, passkeyOnly: true });
      log("La clé maître est désactivée et oubliée : seule la passkey signe désormais.");
    }
  }),
);

ui.payForm.addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    if (connection === undefined || wallet === undefined) return;
    const amount = Number(ui.payAmount.value);
    log(`Paiement de ${amount} XRP : validez avec Touch ID…`);
    const tx = await payWithPasskey(connection, wallet, ui.payDestination.value.trim(), amount);
    log(`Paiement signé par la passkey (${amount} XRP) :`, tx);
  })();
});

setupLedgerPanel(() => connection, refresh);
setupSessionPanel(
  () => connection,
  () => wallet,
  refresh,
);
setupAgentPanel(() => connection, refresh);

async function start(): Promise<void> {
  const node = await NodeClient.connect(NODE_URL);
  const defs = await loadDefinitions(node);
  connection = { node, defs };
  const server = await node.request("server_info");
  ui.nodeStatus.textContent = `Nœud : ${NODE_URL} · ${String(read(server, ["info", "build_version"]))} · ledger ${String(read(server, ["info", "validated_ledger", "seq"]))}`;
}

start()
  .catch((error: unknown) => {
    ui.nodeStatus.textContent = `Nœud : injoignable (${NODE_URL})`;
    logError(error);
  })
  .finally(() => void refresh().catch(logError));
