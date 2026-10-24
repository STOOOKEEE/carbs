/**
 * The live exposure check: `checkExposure` of `@carbs/sessions` on the real node of a
 * network, mapped to the report the Quantum screen shows. Read-only. Mainnet is only ever
 * read. Nothing here is simulated.
 */
import {
  checkExposure,
  type AuthorityRole,
  type ExposureReport as CoreReport,
  type KeyFinding,
} from "@carbs/sessions/quantum";
import type { ExposurePort, ExposureReason, ExposureReport, NetworkName } from "../ports";
import type { LiveClients } from "./clients";

function sourceOf(role: AuthorityRole): ExposureReason["source"] {
  switch (role) {
    case "master":
    case "regular-key":
    case "passkey":
    case "signer-list":
      return role;
    default:
      return "other";
  }
}

function reasonOf(finding: KeyFinding): ExposureReason {
  const postQuantum = finding.quantumVulnerable === false;
  const exposed = finding.status === "exposed" && finding.active && !postQuantum;
  const notes = [...finding.reasons];
  if (postQuantum)
    notes.push("It is an ML-DSA-44 key: post-quantum, so its public key on the ledger is no risk.");
  if (!finding.active) notes.push("It holds no authority over the account now.");
  return {
    source: sourceOf(finding.role),
    exposed,
    text: notes.length > 0 ? notes.join(" ") : `${finding.role}: ${finding.status}`,
    firstTxHash: finding.firstReveal?.hash ?? null,
    firstLedger: finding.firstReveal?.ledgerIndex ?? null,
  };
}

function coverageText(report: CoreReport): string {
  const c = report.coverage;
  const range = `ledgers ${c.ledgerIndexMin ?? "?"} to ${c.ledgerIndexMax ?? "?"}`;
  const parts = [
    `The node searched ${range}: ${c.transactionsScanned} transactions in ${c.pagesScanned} of at most ${c.pageLimit} pages.`,
    c.creationFound
      ? "The creation of the account is in that history."
      : "The creation of the account is not in that history.",
  ];
  if (c.truncated) parts.push("The search was cut short.");
  return [...parts, ...report.reasons.map((reason) => `${reason}.`)].join(" ");
}

/** Core's report in the shape of the Quantum screen. */
export function fromCoreReport(report: CoreReport, network: NetworkName): ExposureReport {
  const reasons = report.findings.map(reasonOf);
  for (const other of report.otherKeys) {
    reasons.push({
      source: "other",
      exposed: other.keyType !== "ml-dsa-44",
      text: `A public key appears in ${other.field} of a ${other.transactionType} (${other.keyType ?? "unknown type"}).`,
      firstTxHash: other.hash,
      firstLedger: null,
    });
  }
  const surviving = report.findings
    .filter((f) => f.active && f.survivesDisableMaster)
    .map((f) => {
      const kind = f.quantumVulnerable === false ? " (ML-DSA-44, post-quantum)" : "";
      return `${f.role} ${f.address}${kind}`;
    });
  return {
    address: report.address,
    network,
    status: report.status,
    reasons,
    survivingAuthorities: surviving,
    coverage: coverageText(report),
    simulated: false,
  };
}

export class LiveExposure implements ExposurePort {
  readonly mode = "live" as const;

  constructor(private readonly clients: LiveClients) {}

  async check(address: string, network: NetworkName): Promise<ExposureReport> {
    const defs = await this.clients.definitions(network);
    const report = await checkExposure(address, this.clients.client(network), defs);
    return fromCoreReport(report, network);
  }
}
