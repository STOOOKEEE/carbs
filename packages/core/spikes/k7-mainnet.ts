/**
 * Spike K7 (FIANSO-SPEC.md section 9): the exposure search on mainnet, read-only. It picks, from
 * the latest validated ledger, an account whose master key signed (known exposed) and an account
 * created by a payment in that ledger that has never sent anything (known safe), checks both, and
 * measures how many `account_tx` pages a busy account needs. It records the node's answers as test
 * fixtures (public data only; the client never sends a secret).
 *
 *   pnpm --filter @carbs/sessions exec tsx spikes/k7-mainnet.ts
 */

import { writeFile } from "node:fs/promises";
import {
  addressFromPublicKey,
  checkExposure,
  JsonRpcClient,
  kMainnetRpcUrl,
  loadDefinitions,
  type ExposureReport,
} from "../src/index.js";
import { RecordingNode } from "../src/testing/recorded-node.js";
import { line } from "./common.js";

const kFixturePageSize = 10;
const kFixturePageLimit = 3;
const kBusyPageSize = 200;
const kBusyPageLimit = 25;

const rpc = new JsonRpcClient(kMainnetRpcUrl);
const info = (await rpc.request("server_info", {})) as {
  info: { complete_ledgers: string; build_version: string };
};
line(
  "server",
  `${kMainnetRpcUrl} ${info.info.build_version} complete_ledgers ${info.info.complete_ledgers}`,
);
const defs = await loadDefinitions(rpc, { requireSessions: false });
line("definitions hash", defs.hash ?? "none");

type Tx = Record<string, unknown> & {
  Account?: string;
  SigningPubKey?: string;
  TransactionType?: string;
};
type LedgerTx = Tx & { metaData?: { AffectedNodes?: Record<string, Record<string, unknown>>[] } };

const kLedgersToSearch = 80;
const validated = (await rpc.request("ledger", { ledger_index: "validated" })) as {
  ledger_index: number;
};
let exposedCandidate: string | undefined;
let safeCandidate: string | undefined;
let ledgerIndex = validated.ledger_index;
const senders = new Map<string, number>();
for (let i = 0; i < kLedgersToSearch && (!exposedCandidate || !safeCandidate); i += 1) {
  const ledger = (await rpc.request("ledger", {
    ledger_index: validated.ledger_index - i,
    transactions: true,
    expand: true,
  })) as { ledger_index: number; ledger: { transactions: LedgerTx[] } };
  for (const tx of ledger.ledger.transactions) {
    const account = tx.Account;
    if (!account) continue;
    senders.set(account, (senders.get(account) ?? 0) + 1);
    if (
      !exposedCandidate &&
      tx.SigningPubKey &&
      addressFromPublicKey(tx.SigningPubKey) === account
    ) {
      exposedCandidate = account;
    }
    for (const node of tx.metaData?.AffectedNodes ?? []) {
      const created = node["CreatedNode"] as
        { LedgerEntryType?: string; NewFields?: { Account?: string } } | undefined;
      if (
        !safeCandidate &&
        created?.LedgerEntryType === "AccountRoot" &&
        created.NewFields?.Account
      ) {
        safeCandidate = created.NewFields.Account;
        ledgerIndex = ledger.ledger_index;
      }
    }
  }
}
line("ledger", `${ledgerIndex} (searched back from ${validated.ledger_index})`);
const busy = [...senders.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];

function summary(label: string, report: ExposureReport): void {
  line(label, `${report.address} → ${report.status}`);
  for (const reason of report.reasons) line("  reason", reason);
  for (const f of report.findings) {
    line(
      `  ${f.role}`,
      `${f.address} ${f.status} active=${f.active} type=${f.keyType ?? "?"} first=${f.firstReveal?.hash ?? "-"}`,
    );
  }
  line("  coverage", report.coverage);
}

async function record(address: string, file: string): Promise<ExposureReport> {
  const recording = new RecordingNode(rpc);
  const report = await checkExposure(address, recording, defs, {
    pageSize: kFixturePageSize,
    pageLimit: kFixturePageLimit,
    subCheckPageLimit: 1,
  });
  await writeFile(
    new URL(`../src/quantum/fixtures/${file}`, import.meta.url),
    JSON.stringify({ address, ledgerIndex, calls: recording.calls }),
  );
  return report;
}

if (!exposedCandidate || !safeCandidate || !busy) {
  console.log("K7: no candidate in this ledger; run again");
  process.exit(1);
}
summary("known exposed", await record(exposedCandidate, "mainnet-exposed.json"));
summary("known safe", await record(safeCandidate, "mainnet-safe.json"));

const started = Date.now();
const busyReport = await checkExposure(busy, rpc, defs, {
  pageSize: kBusyPageSize,
  pageLimit: kBusyPageLimit,
  subCheckPageLimit: 1,
});
const seconds = (Date.now() - started) / 1000;
summary(`busy (${senders.get(busy)} txs in one ledger)`, busyReport);
line(
  "busy account search",
  `${busyReport.coverage.pagesScanned} pages of ${kBusyPageSize} in ${seconds.toFixed(1)} s, truncated=${busyReport.coverage.truncated}`,
);
