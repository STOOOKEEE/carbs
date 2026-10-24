/**
 * SIMULATED exposure check over the simulated node's history. It follows rules 1 to 6
 * of spec 8.7 on the data the simulated node holds; it is a stand-in for
 * `checkExposure` of packages/core (M2). `no-exposure-found` is claimed only when the
 * node's history covers the account.
 */
import type {
  ExposurePort,
  ExposureReason,
  ExposureReport,
  HistoryEntry,
  NetworkName,
  NodePort,
} from "../ports";
import { accountIdOf, algorithmOfPublicKey } from "./keys";

function applied(entry: HistoryEntry): boolean {
  return entry.result.startsWith("tes") || entry.result.startsWith("tec");
}

function signerOf(entry: HistoryEntry): string {
  return accountIdOf(entry.tx.SigningPubKey ?? "");
}

export class SimulatedExposure implements ExposurePort {
  readonly mode = "simulated" as const;

  constructor(private readonly node: NodePort) {}

  async check(address: string, network: NetworkName): Promise<ExposureReport> {
    const info = await this.node.accountInfo(address);
    if (info === null) {
      return {
        address,
        network,
        status: "unknown",
        reasons: [],
        survivingAuthorities: [],
        coverage: "The node does not know this account.",
        simulated: true,
      };
    }
    const page = await this.node.accountTx(address);
    const objects = await this.node.accountObjects(address);
    const own = page.transactions.filter((e) => e.tx.Account === address && applied(e));
    const reasons: ExposureReason[] = [];

    // Rule 1: the master key. A disabled master key no longer authorizes anything.
    const byMaster = own.find((e) => signerOf(e) === address);
    const masterLive = !info.masterDisabled;
    reasons.push({
      source: "master",
      exposed: byMaster !== undefined && masterLive,
      text:
        byMaster === undefined
          ? "The master key has not signed any transaction in the history searched."
          : masterLive
            ? "The master public key has been on the ledger since it signed this transaction."
            : "The master public key is on the ledger, but the master key is disabled: it no longer authorizes transactions.",
      firstTxHash: byMaster?.hash ?? null,
      firstLedger: byMaster?.ledgerIndex ?? null,
    });

    // Rule 2: the regular key. An ML-DSA-44 key is post-quantum: seeing it is no risk.
    if (info.regularKey !== null) {
      const byRegular = own.find((e) => signerOf(e) === info.regularKey);
      const postQuantum =
        byRegular !== undefined &&
        algorithmOfPublicKey(byRegular.tx.SigningPubKey ?? "") === "mldsa44";
      reasons.push({
        source: "regular-key",
        exposed: byRegular !== undefined && !postQuantum,
        text:
          byRegular === undefined
            ? "The regular key has not signed for this account. A key revealed only while signing for other accounts does not appear in this account's history."
            : postQuantum
              ? "The regular key has signed, and it is an ML-DSA-44 key: post-quantum, so its public key on the ledger is no risk."
              : "The regular key has signed for this account.",
        firstTxHash: byRegular?.hash ?? null,
        firstLedger: byRegular?.ledgerIndex ?? null,
      });
    }

    // Rule 3: authorities that survive asfDisableMaster.
    const surviving: string[] = [];
    if (objects.passkeys.length > 0) {
      surviving.push(
        `Passkey list (${objects.passkeys.length}): full authority, survives disabling the master key`,
      );
      reasons.push({
        source: "passkey",
        exposed: true,
        text: "Passkey public keys are stored on the ledger, so they are exposed by construction.",
        firstTxHash: null,
        firstLedger: null,
      });
    }
    if (info.regularKey !== null) surviving.push("Regular key: full authority");

    // Rule 4: the signer list.
    if (objects.signerList !== null) {
      surviving.push(`Signer list (quorum ${objects.signerList.quorum})`);
      let exposedWeight = 0;
      let first: HistoryEntry | undefined;
      for (const entry of objects.signerList.entries) {
        const signerPage = await this.node.accountTx(entry.account);
        const revealed = signerPage.transactions.find(
          (e) =>
            e.tx.Account === entry.account &&
            applied(e) &&
            (signerOf(e) === entry.account || signerOf(e) === undefined),
        );
        if (revealed !== undefined) {
          exposedWeight += entry.weight;
          first ??= revealed;
        }
      }
      const atQuorum = exposedWeight >= objects.signerList.quorum;
      reasons.push({
        source: "signer-list",
        exposed: atQuorum,
        text: `Signers whose keys are on the ledger carry weight ${exposedWeight} of a quorum of ${objects.signerList.quorum}.`,
        firstTxHash: atQuorum ? (first?.hash ?? null) : null,
        firstLedger: atQuorum ? (first?.ledgerIndex ?? null) : null,
      });
    }

    // Rule 6: `unknown` is a result.
    const covered =
      !page.truncated && page.createdLedger !== null && page.ledgerIndexMin <= page.createdLedger;
    const exposed = reasons.some((r) => r.exposed);
    const coverage = covered
      ? `The simulated node's history covers this account (from ledger ${page.ledgerIndexMin}).`
      : `The simulated node's history starts at ledger ${page.ledgerIndexMin}, after this account was created: absence of exposure cannot be claimed.`;

    return {
      address,
      network,
      status: exposed ? "exposed" : covered ? "no-exposure-found" : "unknown",
      reasons,
      survivingAuthorities: surviving,
      coverage,
      simulated: true,
    };
  }
}
