// "Migrate to the ML-DSA-44 root", in the Ledger Stax section: the three steps of
// pq-migration.ts on the connected Stax, each logged with its result code. The proof and the
// reference key come from the ledger (account_tx, RegularKey), so a reload loses nothing;
// step 3 stays off until the guard of pq-migration.ts has no reason left.

import type { Connection } from "./account.ts";
import { element, guarded } from "./dom.ts";
import { type SubmittedTx, read } from "./ledger.ts";
import { connectedStax, rereadMlDsaKey, signAndSubmitWithStax } from "./ledger-panel.ts";
import { log, logError } from "./log.ts";
import {
  type DisableMasterGuard,
  type HistoryEntry,
  MIGRATION_PREVIEWS,
  disableMasterRefusals,
  disableMasterTx,
  findProof,
  proofTx,
  regularKeyTx,
} from "./pq-migration.ts";
import { type AccountState, type Stax, accountState, isPostQuantumRoot } from "./stax.ts";

const SUCCESS = "tesSUCCESS";
/** account_tx pages read to find the proof (newest first), and their size. */
const HISTORY_PAGES = 2;
const HISTORY_PAGE_SIZE = 100;

const ui = {
  status: element("ledger-migration-status", HTMLElement),
  regularKey: element("ledger-migrate-regular-key", HTMLButtonElement),
  proof: element("ledger-migrate-proof", HTMLButtonElement),
  reread: element("ledger-migrate-reread", HTMLButtonElement),
  checked: element("ledger-migrate-checked", HTMLInputElement),
  disableMaster: element("ledger-migrate-disable-master", HTMLButtonElement),
};

/** What this page read on the Stax for one account (the ledger holds the rest). */
interface Reads {
  account: string;
  /** The ML-DSA-44 key when this page signed step 1 or 2. */
  firstRead: string | undefined;
  secondRead: { publicKey: string; address: string } | undefined;
}

let reads: Reads | undefined;

/** The reads of the connected account (new ones when the Stax account changed). */
function readsOf(account: string): Reads {
  if (reads?.account !== account) reads = { account, firstRead: undefined, secondRead: undefined };
  return reads;
}

function historyEntry(entry: unknown): HistoryEntry {
  // API v1 answers `tx` (hash inside), v2 `tx_json` (hash next to it).
  const tx = read(entry, ["tx"]) ?? read(entry, ["tx_json"]);
  const hash = read(tx, ["hash"]) ?? read(entry, ["hash"]);
  return {
    hash: typeof hash === "string" ? hash : undefined,
    transactionType: read(tx, ["TransactionType"]),
    account: read(tx, ["Account"]),
    signingPubKey: read(tx, ["SigningPubKey"]),
    regularKey: read(tx, ["RegularKey"]),
    result: read(entry, ["meta", "TransactionResult"]),
  };
}

/** The hash of the proof in the account's validated history, if it is there. */
async function proofOnLedger(connection: Connection, stax: Stax): Promise<string | undefined> {
  let marker: unknown;
  for (let page = 0; page < HISTORY_PAGES; page++) {
    const answer = await connection.node.request("account_tx", {
      account: stax.account.address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      forward: false,
      limit: HISTORY_PAGE_SIZE,
      ...(marker === undefined ? {} : { marker }),
    });
    const transactions = read(answer, ["transactions"]);
    const entries = Array.isArray(transactions) ? transactions.map(historyEntry) : [];
    const found = findProof(
      entries,
      stax.account.address,
      stax.pqKey.publicKey,
      stax.pqKey.address,
    );
    if (found.done) return found.hash;
    marker = read(answer, ["marker"]);
    if (marker === undefined) return undefined;
  }
  return undefined;
}

async function guardOf(
  connection: Connection,
  stax: Stax,
  state: AccountState | undefined,
): Promise<DisableMasterGuard> {
  const current = readsOf(stax.account.address);
  return {
    regularKey: state?.regularKey,
    mlDsaAddress: stax.pqKey.address,
    proofHash: await proofOnLedger(connection, stax),
    firstRead: current.firstRead,
    secondRead: current.secondRead,
    keyChecked: ui.checked.checked,
  };
}

function disableAll(): void {
  for (const button of [ui.regularKey, ui.proof, ui.reread, ui.disableMaster])
    button.disabled = true;
  ui.checked.disabled = true;
}

export async function refreshMigrationPanel(connection: Connection | undefined): Promise<void> {
  const stax = connectedStax();
  disableAll();
  if (stax === undefined || connection === undefined) {
    ui.status.textContent = "Stax not connected.";
    return;
  }
  const state = await accountState(connection, stax.account.address);
  if (state === undefined) {
    ui.status.textContent = "Stax account not funded yet.";
    return;
  }
  if (isPostQuantumRoot(stax, state)) {
    ui.status.textContent = `Account migrated: only the ML-DSA-44 key ${stax.pqKey.address} signs (master key disabled).`;
    return;
  }
  if (state.masterDisabled) {
    ui.status.textContent =
      "The master key is already disabled, but the regular key is not this Stax's ML-DSA-44 key.";
    return;
  }
  const regularKeyIsMlDsa = state.regularKey === stax.pqKey.address;
  ui.regularKey.disabled = regularKeyIsMlDsa;
  if (!regularKeyIsMlDsa) {
    ui.status.textContent = "Step 1 to do: the regular key is not the ML-DSA-44 key yet.";
    return;
  }
  const guard = await guardOf(connection, stax, state);
  const refusals = disableMasterRefusals(guard);
  ui.proof.disabled = guard.proofHash !== undefined;
  ui.reread.disabled = false;
  ui.checked.disabled = false;
  ui.disableMaster.disabled = refusals.length > 0;
  const proof =
    guard.proofHash === undefined ? "" : `Proof on the ledger: ${guard.proofHash.slice(0, 12)}…. `;
  ui.status.textContent =
    refusals.length === 0
      ? `${proof}Step 3 available: after it, only the ML-DSA-44 key signs for this account.`
      : `${proof}Step 3 blocked: ${refusals.join("; ")}.`;
}

function logStep(label: string, submitted: SubmittedTx): void {
  log(`Migration, ${label}:`, submitted);
}

export function setupMigrationPanel(
  getConnection: () => Connection | undefined,
  refreshAll: () => Promise<void>,
): void {
  const run = (action: () => Promise<void>) => guarded(action, logError, refreshAll);
  const ready = () => {
    const connection = getConnection();
    const stax = connectedStax();
    if (connection === undefined || stax === undefined)
      throw new Error("connect the node and the Stax first");
    return { connection, stax, current: readsOf(stax.account.address) };
  };

  ui.regularKey.addEventListener(
    "click",
    run(async () => {
      log("Click: migration, step 1.");
      const { connection, stax, current } = ready();
      current.firstRead = stax.pqKey.publicKey;
      log(MIGRATION_PREVIEWS.regularKey);
      logStep(
        "step 1 (SetRegularKey, classical key)",
        await signAndSubmitWithStax(
          connection,
          regularKeyTx(stax.account.address, stax.pqKey.address),
          false,
        ),
      );
    }),
  );

  ui.proof.addEventListener(
    "click",
    run(async () => {
      log("Click: migration, step 2.");
      const { connection, stax, current } = ready();
      current.firstRead ??= stax.pqKey.publicKey;
      log(MIGRATION_PREVIEWS.proof);
      const submitted = await signAndSubmitWithStax(
        connection,
        proofTx(stax.account.address),
        true,
      );
      logStep("step 2 (AccountSet proof, ML-DSA-44)", submitted);
      if (submitted.result !== SUCCESS)
        log(`Migration stopped: the ML-DSA-44 proof failed (${submitted.result}).`);
    }),
  );

  ui.reread.addEventListener(
    "click",
    run(async () => {
      log("Click: reading the ML-DSA-44 key on the Stax again.");
      const { current } = ready();
      // No await before this call: a reconnection may need this click's user activation.
      const reread = await rereadMlDsaKey();
      if (reread.account !== current.account)
        throw new Error(`this Stax answers ${reread.account}, not ${current.account}`);
      current.secondRead = { publicKey: reread.pqKey.publicKey, address: reread.pqKey.address };
      log(
        `ML-DSA-44 key read again: address ${reread.pqKey.address} (compared with the ledger's regular key).`,
      );
    }),
  );

  ui.checked.addEventListener("change", () => {
    log(`"Key checked" box ${ui.checked.checked ? "ticked" : "unticked"}.`);
    void refreshMigrationPanel(getConnection()).catch(logError);
  });

  ui.disableMaster.addEventListener(
    "click",
    run(async () => {
      log("Click: migration, step 3.");
      const { connection, stax } = ready();
      const state = await accountState(connection, stax.account.address);
      const guard = await guardOf(connection, stax, state);
      const refusals = disableMasterRefusals(guard);
      if (refusals.length > 0) throw new Error(`step 3 refused: ${refusals.join("; ")}`);
      log(`Proof used: ${guard.proofHash ?? "?"}.`);
      log(MIGRATION_PREVIEWS.disableMaster);
      logStep(
        "step 3 (asfDisableMaster, classical key)",
        await signAndSubmitWithStax(connection, disableMasterTx(stax.account.address), false),
      );
    }),
  );
}
