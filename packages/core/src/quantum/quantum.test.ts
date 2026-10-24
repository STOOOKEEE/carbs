import { describe, expect, it } from "vitest";
import { addressFromPublicKey } from "../address.js";
import { bytesToHex } from "../bytes.js";
import { classicSignerFromSeed, generateClassicSeed } from "../keys/classic.js";
import { generateMlDsaSeed, mlDsaKeyPairFromSeed } from "../keys/mldsa.js";
import type { FinalResult } from "../node.js";
import { RecordedNode, type RecordedCall } from "../testing/recorded-node.js";
import { alphanetDefinitions } from "../testing/simulated-definitions.js";
import { checkExposure, type ExposureReport } from "./exposure.js";
import {
  accountInfo,
  accountObjects,
  accountTx,
  funding,
  noAuthorities,
  type FixtureTx,
} from "./fixtures.js";
import {
  buildPqMigration,
  disableMasterRefusals,
  MigrationError,
  type DisableMasterGuard,
} from "./migration.js";

const defs = alphanetDefinitions();
const disableMaster = defs.raw.LEDGER_ENTRY_FLAGS?.["AccountRoot"]?.["lsfDisableMaster"] ?? -1;

function keyPair() {
  const signer = classicSignerFromSeed(generateClassicSeed());
  return {
    publicKey: bytesToHex(signer.publicKey),
    address: addressFromPublicKey(signer.publicKey),
  };
}

const funder = keyPair();

function selfSigned(
  account: string,
  publicKey: string,
  hash: string,
  ledgerIndex: number,
  type = "AccountSet",
): FixtureTx {
  return {
    hash,
    ledgerIndex,
    tx: { TransactionType: type, Account: account, SigningPubKey: publicKey },
  };
}

function node(...calls: (RecordedCall | RecordedCall[])[]): RecordedNode {
  return new RecordedNode(calls.flat());
}

describe("checkExposure (rules 1, 2 and 6)", () => {
  it("reports the master key exposed, with the transaction that first revealed it", async () => {
    const alice = keyPair();
    const report = await checkExposure(
      alice.address,
      node(
        accountInfo(alice.address, {}),
        accountTx(
          alice.address,
          [
            funding(alice.address, funder.address, 10, "F".repeat(64), funder.publicKey),
            selfSigned(alice.address, alice.publicKey, "A".repeat(64), 11, "Payment"),
            selfSigned(alice.address, alice.publicKey, "B".repeat(64), 12),
          ],
          { min: 1, max: 100 },
        ),
        noAuthorities(alice.address),
      ),
      defs,
    );
    expect(report.status).toBe("exposed");
    const master = report.findings.find((f) => f.role === "master");
    expect(master).toMatchObject({
      status: "exposed",
      active: true,
      keyType: "secp256k1",
      quantumVulnerable: true,
    });
    expect(master?.firstReveal).toMatchObject({
      hash: "A".repeat(64),
      ledgerIndex: 11,
      transactionType: "Payment",
    });
  });

  it("claims no-exposure-found only when the history covers the account", async () => {
    const bob = keyPair();
    const calls = [
      accountInfo(bob.address, {}),
      accountTx(
        bob.address,
        [funding(bob.address, funder.address, 10, "F".repeat(64), funder.publicKey)],
        {
          min: 1,
          max: 100,
        },
      ),
      noAuthorities(bob.address),
    ];
    const report = await checkExposure(bob.address, node(...calls), defs);
    expect(report.status).toBe("no-exposure-found");
    expect(report.coverage.creationFound).toBe(true);
  });

  it("says unknown when the node's history starts after the account was created", async () => {
    const carol = keyPair();
    const report = await checkExposure(
      carol.address,
      node(
        accountInfo(carol.address, {}),
        accountTx(carol.address, [], { min: 50_000, max: 60_000 }),
        noAuthorities(carol.address),
      ),
      defs,
    );
    expect(report.status).toBe("unknown");
    expect(report.reasons.join(" ")).toMatch(/does not reach the creation of the account/);
  });

  it("says unknown, not found within N pages, when the search is cut short", async () => {
    const dave = keyPair();
    const others: FixtureTx[] = Array.from({ length: 5 }, (_, i) => ({
      hash: `${i}`.padStart(64, "0"),
      ledgerIndex: 20 + i,
      tx: {
        TransactionType: "Payment",
        Account: funder.address,
        Destination: dave.address,
        SigningPubKey: funder.publicKey,
      },
    }));
    const report = await checkExposure(
      dave.address,
      node(
        accountInfo(dave.address, {}),
        accountTx(
          dave.address,
          [funding(dave.address, funder.address, 10, "F".repeat(64), funder.publicKey), ...others],
          { min: 1, max: 100 },
          2,
        ),
        noAuthorities(dave.address),
      ),
      defs,
      { pageLimit: 2, pageSize: 2 },
    );
    expect(report.status).toBe("unknown");
    expect(report.coverage.truncated).toBe(true);
    expect(report.reasons.join(" ")).toMatch(/not found within 2 pages/);
  });

  it("does not count a regular key that signed with SigningPubKey as the master (rule 1)", async () => {
    const erin = keyPair();
    const regular = keyPair();
    const report = await checkExposure(
      erin.address,
      node(
        accountInfo(erin.address, { RegularKey: regular.address }),
        accountTx(
          erin.address,
          [
            funding(erin.address, funder.address, 10, "F".repeat(64), funder.publicKey),
            selfSigned(erin.address, regular.publicKey, "C".repeat(64), 11),
          ],
          { min: 1, max: 100 },
        ),
        noAuthorities(erin.address),
      ),
      defs,
    );
    expect(report.findings.find((f) => f.role === "master")?.status).toBe("no-exposure-found");
    expect(report.findings.find((f) => f.role === "regular-key")).toMatchObject({
      status: "exposed",
      firstReveal: { hash: "C".repeat(64) },
    });
    expect(report.status).toBe("exposed");
  });
});

describe("buildPqMigration (section 8.7)", () => {
  const account = keyPair().address;
  const mlDsa = mlDsaKeyPairFromSeed(generateMlDsaSeed());

  it("orders SetRegularKey (master), proof (ML-DSA), asfDisableMaster (master)", () => {
    const plan = buildPqMigration(account, mlDsa.publicKey, defs);
    expect(plan.mlDsaAddress).toBe(addressFromPublicKey(mlDsa.publicKey));
    expect(plan.steps.map((s) => [s.index, s.kind, s.signer])).toEqual([
      [1, "set-regular-key", "master"],
      [2, "proof", "ml-dsa"],
      [3, "disable-master", "master"],
    ]);
    expect(plan.steps[0].tx).toEqual({
      TransactionType: "SetRegularKey",
      Account: account,
      RegularKey: plan.mlDsaAddress,
    });
    expect(plan.steps[1].tx).toEqual({ TransactionType: "AccountSet", Account: account });
    expect(plan.steps[2].tx).toEqual({
      TransactionType: "AccountSet",
      Account: account,
      SetFlag: defs.accountSetFlag("asfDisableMaster"),
    });
  });

  it("refuses a key that is not ML-DSA-44", () => {
    expect(() => buildPqMigration(account, new Uint8Array(33), defs)).toThrow(MigrationError);
  });

  it("refuses step 3 unless the proof, recoverability and the review are all there", () => {
    const plan = buildPqMigration(account, mlDsa.publicKey, defs);
    const accepted: FinalResult = {
      hash: "P",
      result: "tesSUCCESS",
      validated: true,
      ledgerIndex: 5,
      submit: {
        engineResult: "tesSUCCESS",
        engineResultCode: 0,
        engineResultMessage: "",
        hash: "P",
        accepted: true,
      },
    };
    const report = { address: account } as ExposureReport;
    const good: DisableMasterGuard = {
      proofResult: accepted,
      recoverability: {
        kind: "derived-twice",
        first: mlDsa.publicKey,
        second: mlDsa.publicKey,
        afterReinstall: true,
        source: "software",
      },
      reviewedReport: report,
      authoritiesAcknowledged: true,
    };
    expect(disableMasterRefusals(plan, good)).toEqual([]);
    expect(disableMasterRefusals(plan, { ...good, proofResult: undefined })).toHaveLength(1);
    expect(
      disableMasterRefusals(plan, {
        ...good,
        proofResult: { ...accepted, result: "tefBAD_AUTH", validated: false },
      })[0],
    ).toMatch(/proof/);
    expect(disableMasterRefusals(plan, { ...good, recoverability: undefined })[0]).toMatch(
      /recoverable/,
    );
    expect(
      disableMasterRefusals(plan, {
        ...good,
        recoverability: {
          kind: "derived-twice",
          first: mlDsa.publicKey,
          second: new Uint8Array(1312),
          afterReinstall: true,
          source: "device",
        },
      })[0],
    ).toMatch(/differs/);
    expect(
      disableMasterRefusals(plan, {
        ...good,
        recoverability: {
          kind: "derived-twice",
          first: mlDsa.publicKey,
          second: mlDsa.publicKey,
          afterReinstall: false,
          source: "device",
        },
      })[0],
    ).toMatch(/reinstalling/);
    expect(
      disableMasterRefusals(plan, {
        ...good,
        recoverability: { kind: "pq-backup", description: "" },
      })[0],
    ).toMatch(/backup/);
    expect(disableMasterRefusals(plan, { ...good, reviewedReport: undefined })[0]).toMatch(
      /reviewed/,
    );
    expect(disableMasterRefusals(plan, { ...good, authoritiesAcknowledged: false })[0]).toMatch(
      /acknowledged/,
    );
  });
});

describe("fixtures", () => {
  it("know the AccountRoot flag from the definitions", () => {
    expect(disableMaster).toBe(0x00100000);
    expect(accountObjects("r", "delegate", []).params).toMatchObject({ type: "delegate" });
  });
});
