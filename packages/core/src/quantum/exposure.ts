/**
 * Quantum exposure check (FIANSO-SPEC.md section 8.7). A public key is visible on the ledger once
 * something has signed with it; this module reports, per account, which keys with authority are
 * visible and the transaction that first revealed each one. Only per-account results, never totals.
 *
 * The six rules of section 8.7:
 * 1. master key: exposed when a validated transaction of the account has a `SigningPubKey` whose
 *    AccountID is the address (a non-empty `SigningPubKey` alone proves nothing);
 * 2. regular key: exposed when it signed for this account; a key revealed only while signing for
 *    other accounts does not show in this history, and the report says so;
 * 3. authorities that survive `asfDisableMaster` are reported separately: passkeys (stored on the
 *    ledger, so exposed by construction), the beneficiary key, XLS-75 delegates, signer lists;
 * 4. signer list: exposed when signers whose keys appeared carry at least the quorum;
 * 5. other places a key appears (`PaymentChannelCreate.PublicKey`) are listed;
 * 6. `unknown` is a result: `no-exposure-found` needs a history that covers the account and a
 *    search that was not cut short.
 */

import { addressFromPublicKey, isQuantumVulnerable, keyTypeOf, type KeyType } from "../address.js";
import {
  kExposureDefaultPageLimit,
  kExposurePageSize,
  kExposureSubCheckPageLimit,
} from "../constants.js";
import type { Definitions } from "../definitions.js";
import { RpcError } from "../errors.js";
import { getAccountObjects, NodeClientError, type NodeClient } from "../node.js";

export type ExposureStatus = "exposed" | "no-exposure-found" | "unknown";

export type AuthorityRole =
  | "master"
  | "regular-key"
  | "passkey"
  | "beneficiary"
  | "delegate"
  | "signer-list"
  /**
   * A key that signed for the account and is none of its standing authorities: a former regular
   * key, or a session key, which holds the authority of its session, and only that, while the
   * session lives.
   */
  | "former-key";

/** The transaction that first revealed a key. */
export interface Reveal {
  hash: string;
  ledgerIndex: number | undefined;
  transactionType: string;
  publicKey: string;
}

export interface KeyFinding {
  role: AuthorityRole;
  /** The key's AccountID as an address (or the delegate / signer account). */
  address: string;
  status: ExposureStatus;
  keyType: KeyType | undefined;
  /** False only for a key known to be ML-DSA. */
  quantumVulnerable: boolean | undefined;
  /** The key or account has authority over the account now. */
  active: boolean;
  /** Disabling the master key does not remove this authority (rule 3). */
  survivesDisableMaster: boolean;
  firstReveal: Reveal | undefined;
  reasons: string[];
  /** For a signer list: the signers and their weights. */
  signers?: SignerFinding[];
  quorum?: number;
}

export interface SignerFinding {
  account: string;
  weight: number;
  status: ExposureStatus;
  firstReveal: Reveal | undefined;
  reasons: string[];
}

/** Rule 5: another field where a public key appears. */
export interface OtherKeyAppearance {
  field: string;
  publicKey: string;
  keyType: KeyType | undefined;
  hash: string;
  transactionType: string;
}

export interface HistoryCoverage {
  /** The ledger range the node searched (`ledger_index_min` / `_max` of `account_tx`). */
  ledgerIndexMin: number | undefined;
  ledgerIndexMax: number | undefined;
  /** The transaction that created the account root was found in the searched history. */
  creationFound: boolean;
  pagesScanned: number;
  pageLimit: number;
  /** The page bound was hit before the end of the history. */
  truncated: boolean;
  transactionsScanned: number;
  /** `oldest-first` (`forward: true`), or `newest-first` when the node refused `forward`. */
  order: "oldest-first" | "newest-first";
}

export interface ExposureReport {
  address: string;
  status: ExposureStatus;
  reasons: string[];
  accountExists: boolean;
  pseudoAccount: boolean;
  masterDisabled: boolean;
  findings: KeyFinding[];
  otherKeys: OtherKeyAppearance[];
  coverage: HistoryCoverage;
}

export interface ExposureOptions {
  /** Pages of `account_tx` for the account itself (default `kExposureDefaultPageLimit`). */
  pageLimit?: number;
  pageSize?: number;
  /** Pages for each regular-key, signer or delegate account looked at (default `kExposureSubCheckPageLimit`). */
  subCheckPageLimit?: number;
}

/**
 * Account-root fields that mark a pseudo-account (`rippled/include/xrpl/protocol/detail/ledger_entries.macro:153-155`,
 * read by `getPseudoAccountFields`, `rippled/src/libxrpl/ledger/helpers/AccountRootHelpers.cpp:545-568`).
 * Field names, not codes: `server_definitions` does not carry the pseudo-account marker.
 */
export const kPseudoAccountFields = ["AMMID", "VaultID", "LoanBrokerID"] as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** What one walk of an account's history found. */
interface HistoryScan {
  /** First reveal of each key that signed for the account, by the key's AccountID. */
  keyReveals: Map<string, Reveal>;
  /** First reveal of each multi-signer's key, by signer account. */
  signerReveals: Map<string, Reveal>;
  otherKeys: OtherKeyAppearance[];
  coverage: HistoryCoverage;
}

function transactionOf(
  entry: JsonObject,
): { tx: JsonObject; hash: string; ledgerIndex: number | undefined } | undefined {
  // API v2 writes `tx_json` and `hash` beside it; API v1 writes `tx` with `hash` inside.
  const tx = isObject(entry["tx_json"])
    ? entry["tx_json"]
    : isObject(entry["tx"])
      ? entry["tx"]
      : undefined;
  if (!tx) return undefined;
  const hash = asString(entry["hash"]) ?? asString(tx["hash"]);
  if (hash === undefined) return undefined;
  const ledgerIndex =
    typeof entry["ledger_index"] === "number"
      ? entry["ledger_index"]
      : typeof tx["ledger_index"] === "number"
        ? tx["ledger_index"]
        : undefined;
  return { tx, hash, ledgerIndex };
}

function createsAccountRoot(meta: unknown, address: string): boolean {
  if (!isObject(meta) || !Array.isArray(meta["AffectedNodes"])) return false;
  return meta["AffectedNodes"].some((node) => {
    if (!isObject(node) || !isObject(node["CreatedNode"])) return false;
    const created = node["CreatedNode"];
    return (
      created["LedgerEntryType"] === "AccountRoot" &&
      isObject(created["NewFields"]) &&
      created["NewFields"]["Account"] === address
    );
  });
}

/**
 * Keep the oldest reveal of a key. Oldest first, the first one seen wins a tie; newest first, the
 * last one seen does (it came earlier in its ledger).
 */
function recordFirst(
  map: Map<string, Reveal>,
  key: string,
  reveal: Reveal,
  oldestFirst: boolean,
): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, reveal);
    return;
  }
  const a = reveal.ledgerIndex ?? Number.MAX_SAFE_INTEGER;
  const b = existing.ledgerIndex ?? Number.MAX_SAFE_INTEGER;
  if (a < b || (a === b && !oldestFirst)) map.set(key, reveal);
}

/** Walk the account's validated history from the oldest transaction, bounded by `pageLimit`. */
async function scanHistory(
  node: NodeClient,
  address: string,
  pageLimit: number,
  pageSize: number,
): Promise<HistoryScan> {
  const keyReveals = new Map<string, Reveal>();
  const signerReveals = new Map<string, Reveal>();
  const otherKeys: OtherKeyAppearance[] = [];
  const coverage: HistoryCoverage = {
    ledgerIndexMin: undefined,
    ledgerIndexMax: undefined,
    creationFound: false,
    pagesScanned: 0,
    pageLimit,
    truncated: false,
    transactionsScanned: 0,
    order: "oldest-first",
  };
  let marker: unknown;
  for (;;) {
    if (coverage.pagesScanned >= pageLimit) {
      coverage.truncated = true;
      break;
    }
    const params: JsonObject = {
      account: address,
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: pageSize,
    };
    if (coverage.order === "oldest-first") params["forward"] = true;
    if (marker !== undefined) params["marker"] = marker;
    let result: unknown;
    try {
      result = await node.request("account_tx", params);
    } catch (error) {
      if (error instanceof RpcError && error.error === "actNotFound") break;
      // Some public proxies refuse `forward` (the AlphaNet answers HTTP 403 to any request that
      // carries it): search newest first instead, which needs the whole history for the oldest reveal.
      if (
        error instanceof NodeClientError &&
        /HTTP 403/.test(error.message) &&
        coverage.order === "oldest-first" &&
        coverage.pagesScanned === 0
      ) {
        coverage.order = "newest-first";
        continue;
      }
      throw error;
    }
    coverage.pagesScanned += 1;
    if (!isObject(result) || !Array.isArray(result["transactions"])) break;
    if (typeof result["ledger_index_min"] === "number")
      coverage.ledgerIndexMin = result["ledger_index_min"];
    if (typeof result["ledger_index_max"] === "number")
      coverage.ledgerIndexMax = result["ledger_index_max"];
    for (const entry of result["transactions"]) {
      if (!isObject(entry) || entry["validated"] === false) continue;
      const found = transactionOf(entry);
      if (!found) continue;
      coverage.transactionsScanned += 1;
      const { tx, hash, ledgerIndex } = found;
      const meta = entry["meta"] ?? entry["metaData"];
      if (createsAccountRoot(meta, address)) coverage.creationFound = true;
      const transactionType = asString(tx["TransactionType"]) ?? "Unknown";
      if (tx["Account"] === address) {
        const spk = asString(tx["SigningPubKey"]);
        if (spk !== undefined && spk.length > 0 && keyTypeOf(spk) !== undefined) {
          recordFirst(
            keyReveals,
            addressFromPublicKey(spk),
            {
              hash,
              ledgerIndex,
              transactionType,
              publicKey: spk,
            },
            coverage.order === "oldest-first",
          );
        }
        if (Array.isArray(tx["Signers"])) {
          for (const wrapped of tx["Signers"]) {
            const signer =
              isObject(wrapped) && isObject(wrapped["Signer"]) ? wrapped["Signer"] : undefined;
            const account = asString(signer?.["Account"]);
            const signerKey = asString(signer?.["SigningPubKey"]);
            if (account !== undefined && signerKey !== undefined && signerKey.length > 0) {
              recordFirst(
                signerReveals,
                account,
                {
                  hash,
                  ledgerIndex,
                  transactionType,
                  publicKey: signerKey,
                },
                coverage.order === "oldest-first",
              );
            }
          }
        }
        const channelKey = asString(tx["PublicKey"]);
        if (transactionType === "PaymentChannelCreate" && channelKey !== undefined) {
          otherKeys.push({
            field: "PaymentChannelCreate.PublicKey",
            publicKey: channelKey,
            keyType: keyTypeOf(channelKey),
            hash,
            transactionType,
          });
        }
      }
    }
    marker = result["marker"];
    if (marker === undefined) break;
  }
  return { keyReveals, signerReveals, otherKeys, coverage };
}

/**
 * `account_objects` of one entry type, or none when the node's definitions do not list the type
 * (mainnet has no passkey list or beneficiary entry, and refuses the filter with `invalidParams`).
 */
async function objectsIfKnown(
  node: NodeClient,
  defs: Definitions,
  address: string,
  rpcType: string,
  entryType: string,
): Promise<JsonObject[]> {
  if (defs.raw.LEDGER_ENTRY_TYPES[entryType] === undefined) return [];
  return getAccountObjects(node, address, rpcType);
}

/** The history covers the account: its creation was found and the search was not cut short. */
function covers(coverage: HistoryCoverage): boolean {
  return coverage.creationFound && !coverage.truncated;
}

async function readAccount(node: NodeClient, address: string): Promise<JsonObject | undefined> {
  try {
    const result = await node.request("account_info", {
      account: address,
      ledger_index: "validated",
    });
    return isObject(result) && isObject(result["account_data"])
      ? result["account_data"]
      : undefined;
  } catch (error) {
    if (error instanceof RpcError && error.error === "actNotFound") return undefined;
    throw error;
  }
}

function disableMasterFlag(defs: Definitions): number {
  const flag = defs.raw.LEDGER_ENTRY_FLAGS?.["AccountRoot"]?.["lsfDisableMaster"];
  if (flag === undefined) {
    throw new Error(
      "server_definitions: LEDGER_ENTRY_FLAGS.AccountRoot.lsfDisableMaster is missing",
    );
  }
  return flag;
}

/**
 * Whether a key designated by AccountID (a regular key, a beneficiary, the keys of a signer or a
 * delegate account) is visible. Looks in this account's history first, then in the history of the
 * key's own account, where the same key is that account's master key.
 */
async function keyStatus(
  node: NodeClient,
  keyAddress: string,
  seenHere: Reveal | undefined,
  pageLimit: number,
  pageSize: number,
): Promise<{ status: ExposureStatus; reveal: Reveal | undefined; reasons: string[] }> {
  if (seenHere) {
    return {
      status: "exposed",
      reveal: seenHere,
      reasons: ["it signed a transaction of this account"],
    };
  }
  const own = await scanHistory(node, keyAddress, pageLimit, pageSize);
  const ownReveal = own.keyReveals.get(keyAddress);
  if (ownReveal) {
    return {
      status: "exposed",
      reveal: ownReveal,
      reasons: [`it signed for its own account ${keyAddress}`],
    };
  }
  return {
    status: "unknown",
    reveal: undefined,
    reasons: [
      "not seen signing for this account or its own account; a key may also sign for other accounts, which this history does not show",
    ],
  };
}

/**
 * Whether a signer or delegate account can sign with a visible key: its master key (if enabled) or
 * its regular key revealed in its own history, or its key revealed as a signer of this account.
 */
async function accountKeysStatus(
  node: NodeClient,
  account: string,
  seenAsSigner: Reveal | undefined,
  defs: Definitions,
  pageLimit: number,
  pageSize: number,
): Promise<{ status: ExposureStatus; reveal: Reveal | undefined; reasons: string[] }> {
  if (seenAsSigner && keyTypeOf(seenAsSigner.publicKey) !== "ml-dsa-44") {
    return {
      status: "exposed",
      reveal: seenAsSigner,
      reasons: ["its key signed a transaction of this account"],
    };
  }
  const data = await readAccount(node, account);
  if (!data) {
    return {
      status: "unknown",
      reveal: undefined,
      reasons: [`account ${account} not found on this node`],
    };
  }
  const masterDisabled = (Number(data["Flags"] ?? 0) & disableMasterFlag(defs)) !== 0;
  const regularKey = asString(data["RegularKey"]);
  const own = await scanHistory(node, account, pageLimit, pageSize);
  const masterReveal = own.keyReveals.get(account);
  if (!masterDisabled && masterReveal && keyTypeOf(masterReveal.publicKey) !== "ml-dsa-44") {
    return {
      status: "exposed",
      reveal: masterReveal,
      reasons: ["its master key signed for its own account"],
    };
  }
  const regularReveal = regularKey !== undefined ? own.keyReveals.get(regularKey) : undefined;
  if (regularReveal && keyTypeOf(regularReveal.publicKey) !== "ml-dsa-44") {
    return {
      status: "exposed",
      reveal: regularReveal,
      reasons: ["its regular key signed for its own account"],
    };
  }
  if (
    covers(own.coverage) &&
    (masterDisabled || masterReveal === undefined) &&
    regularKey === undefined
  ) {
    return {
      status: "no-exposure-found",
      reveal: undefined,
      reasons: ["no key of that account appears in its full history, nor as a signer here"],
    };
  }
  return {
    status: "unknown",
    reveal: undefined,
    reasons: [
      "its keys could not be ruled out (partial history, or a key that may sign elsewhere)",
    ],
  };
}

function quantumVulnerability(type: KeyType | undefined): boolean | undefined {
  return type === undefined ? undefined : isQuantumVulnerable(type);
}

/** Does this finding put the account at risk now? */
function counts(finding: KeyFinding): ExposureStatus | undefined {
  if (!finding.active || finding.quantumVulnerable === false) return undefined;
  return finding.status;
}

/** Check one account. `defs` are the definitions of the same node (for the account flags). */
export async function checkExposure(
  address: string,
  node: NodeClient,
  defs: Definitions,
  options: ExposureOptions = {},
): Promise<ExposureReport> {
  const pageLimit = options.pageLimit ?? kExposureDefaultPageLimit;
  const pageSize = options.pageSize ?? kExposurePageSize;
  const subLimit = options.subCheckPageLimit ?? kExposureSubCheckPageLimit;

  const data = await readAccount(node, address);
  const scan = await scanHistory(node, address, pageLimit, pageSize);
  const reasons: string[] = [];
  const findings: KeyFinding[] = [];
  const covered = covers(scan.coverage);

  if (!covered) {
    if (scan.coverage.truncated) {
      reasons.push(`the search stopped after ${pageLimit} pages of ${pageSize} transactions`);
    }
    if (!scan.coverage.creationFound) {
      reasons.push(
        `the node's history (ledgers ${scan.coverage.ledgerIndexMin ?? "?"} to ${scan.coverage.ledgerIndexMax ?? "?"}) does not reach the creation of the account`,
      );
    }
  }

  const masterDisabled = data
    ? (Number(data["Flags"] ?? 0) & disableMasterFlag(defs)) !== 0
    : false;
  const pseudoAccount = data
    ? kPseudoAccountFields.some((field) => data[field] !== undefined)
    : false;

  // Rule 1: the master key.
  const masterReveal = scan.keyReveals.get(address);
  const masterType = masterReveal ? keyTypeOf(masterReveal.publicKey) : undefined;
  if (pseudoAccount) {
    reasons.push("pseudo-account: no key can sign for it");
  } else {
    findings.push({
      role: "master",
      address,
      status: masterReveal ? "exposed" : covered ? "no-exposure-found" : "unknown",
      keyType: masterType,
      quantumVulnerable: quantumVulnerability(masterType),
      active: data !== undefined && !masterDisabled,
      survivesDisableMaster: false,
      firstReveal: masterReveal,
      reasons: masterReveal
        ? [`the master key signed ${masterReveal.transactionType} ${masterReveal.hash}`]
        : covered
          ? ["the master key never signed in the account's full history"]
          : ["the master key was not seen in the part of the history the node keeps"],
    });
  }

  // Rule 2: the regular key.
  const regularKey = data ? asString(data["RegularKey"]) : undefined;
  if (regularKey !== undefined) {
    const seen = scan.keyReveals.get(regularKey);
    const status = await keyStatus(node, regularKey, seen, subLimit, pageSize);
    const type = status.reveal ? keyTypeOf(status.reveal.publicKey) : undefined;
    findings.push({
      role: "regular-key",
      address: regularKey,
      status: status.status,
      keyType: type,
      quantumVulnerable: quantumVulnerability(type),
      active: true,
      survivesDisableMaster: true,
      firstReveal: status.reveal,
      reasons: status.reasons,
    });
  }

  // Rule 3: authorities that survive asfDisableMaster.
  if (data) {
    const passkeyLists = await objectsIfKnown(node, defs, address, "passkey_list", "PasskeyList");
    for (const list of passkeyLists) {
      const passkeys = Array.isArray(list["Passkeys"]) ? list["Passkeys"] : [];
      for (const wrapped of passkeys) {
        const passkey =
          isObject(wrapped) && isObject(wrapped["Passkey"]) ? wrapped["Passkey"] : undefined;
        const publicKey = asString(passkey?.["PublicKey"]);
        if (publicKey === undefined) continue;
        const type = keyTypeOf(publicKey);
        const previous = asString(list["PreviousTxnID"]);
        findings.push({
          role: "passkey",
          address: addressFromPublicKey(publicKey),
          status: "exposed",
          keyType: type,
          quantumVulnerable: quantumVulnerability(type),
          active: true,
          survivesDisableMaster: true,
          firstReveal: previous
            ? {
                hash: previous,
                ledgerIndex: undefined,
                transactionType: "PasskeyListSet",
                publicKey,
              }
            : undefined,
          reasons: [
            "a passkey's public key is stored on the ledger (exposed by construction) and has full authority",
          ],
        });
      }
    }

    for (const entry of await objectsIfKnown(node, defs, address, "beneficiary", "Beneficiary")) {
      const beneficiary = asString(entry["Beneficiary"]);
      if (beneficiary === undefined) continue;
      const status = await keyStatus(
        node,
        beneficiary,
        scan.keyReveals.get(beneficiary),
        subLimit,
        pageSize,
      );
      const type = status.reveal ? keyTypeOf(status.reveal.publicKey) : undefined;
      findings.push({
        role: "beneficiary",
        address: beneficiary,
        status: status.status,
        keyType: type,
        quantumVulnerable: quantumVulnerability(type),
        active: true,
        survivesDisableMaster: true,
        firstReveal: status.reveal,
        reasons: ["the beneficiary key signs after its time lock", ...status.reasons],
      });
    }

    for (const entry of await objectsIfKnown(node, defs, address, "delegate", "Delegate")) {
      const delegate = asString(entry["Authorize"]);
      if (delegate === undefined || entry["Account"] !== address) continue;
      const status = await accountKeysStatus(node, delegate, undefined, defs, subLimit, pageSize);
      const type = status.reveal ? keyTypeOf(status.reveal.publicKey) : undefined;
      findings.push({
        role: "delegate",
        address: delegate,
        status: status.status,
        keyType: type,
        quantumVulnerable: quantumVulnerability(type),
        active: true,
        survivesDisableMaster: true,
        firstReveal: status.reveal,
        reasons: [
          "an XLS-75 delegate signs with its own keys, within its permissions",
          ...status.reasons,
        ],
      });
    }

    // Rule 4: signer lists.
    for (const list of await objectsIfKnown(node, defs, address, "signer_list", "SignerList")) {
      const quorum = Number(list["SignerQuorum"] ?? 0);
      const entries = Array.isArray(list["SignerEntries"]) ? list["SignerEntries"] : [];
      const signers: SignerFinding[] = [];
      for (const wrapped of entries) {
        const entry =
          isObject(wrapped) && isObject(wrapped["SignerEntry"])
            ? wrapped["SignerEntry"]
            : undefined;
        const account = asString(entry?.["Account"]);
        if (account === undefined) continue;
        const weight = Number(entry?.["SignerWeight"] ?? 0);
        const status = await accountKeysStatus(
          node,
          account,
          scan.signerReveals.get(account),
          defs,
          subLimit,
          pageSize,
        );
        signers.push({
          account,
          weight,
          status: status.status,
          firstReveal: status.reveal,
          reasons: status.reasons,
        });
      }
      const exposedWeight = signers
        .filter((s) => s.status === "exposed")
        .reduce((sum, s) => sum + s.weight, 0);
      const unknownWeight = signers
        .filter((s) => s.status === "unknown")
        .reduce((sum, s) => sum + s.weight, 0);
      const status: ExposureStatus =
        exposedWeight >= quorum
          ? "exposed"
          : exposedWeight + unknownWeight >= quorum
            ? "unknown"
            : "no-exposure-found";
      findings.push({
        role: "signer-list",
        address,
        status,
        keyType: undefined,
        quantumVulnerable: true,
        active: true,
        survivesDisableMaster: true,
        firstReveal: undefined,
        reasons: [
          `signers with visible keys carry weight ${exposedWeight} of quorum ${quorum}` +
            (unknownWeight > 0 ? `; weight ${unknownWeight} could not be ruled out` : ""),
        ],
        signers,
        quorum,
      });
    }
  } else {
    reasons.push("the account does not exist in the validated ledger of this node");
  }

  // Keys that signed for the account but are none of its standing authorities (a former regular
  // key, a session key, a passkey that is no longer listed): reported, not counted. A session key
  // keeps the authority of its session until the session ends or expires, bounded by it.
  const known = new Set(findings.map((f) => f.address));
  for (const [keyAddress, reveal] of scan.keyReveals) {
    if (known.has(keyAddress) || keyAddress === address) continue;
    const type = keyTypeOf(reveal.publicKey);
    findings.push({
      role: "former-key",
      address: keyAddress,
      status: "exposed",
      keyType: type,
      quantumVulnerable: quantumVulnerability(type),
      active: false,
      survivesDisableMaster: false,
      firstReveal: reveal,
      reasons: [
        "a key that signed for this account and is not one of its standing authorities; if it is the key of a live signing session, it holds an authority bounded by that session (its mode, cap and expiry) until the session ends",
      ],
    });
  }

  const counted = findings.map(counts).filter((s): s is ExposureStatus => s !== undefined);
  let status: ExposureStatus;
  if (counted.includes("exposed")) status = "exposed";
  else if (counted.includes("unknown") || (!covered && !pseudoAccount) || data === undefined)
    status = "unknown";
  else status = "no-exposure-found";
  if (status !== "exposed" && scan.coverage.truncated) {
    reasons.push(`not found within ${pageLimit} pages of ${pageSize} transactions`);
  }

  for (const finding of findings) {
    if (finding.status === "exposed" && finding.active && finding.quantumVulnerable !== false) {
      reasons.push(`${finding.role} ${finding.address} is exposed`);
    }
  }
  if (masterDisabled && masterReveal) reasons.push("the master key is exposed but disabled");

  return {
    address,
    status,
    reasons,
    accountExists: data !== undefined,
    pseudoAccount,
    masterDisabled,
    findings,
    otherKeys: scan.otherKeys,
    coverage: scan.coverage,
  };
}
