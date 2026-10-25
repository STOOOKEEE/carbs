import { describe, expect, it } from "vitest";
import { addressFromPublicKey } from "../address.js";
import { bytesToHex } from "../bytes.js";
import { classicSignerFromSeed, generateClassicSeed } from "../keys/classic.js";
import { generateMlDsaSeed, mlDsaKeyPairFromSeed } from "../keys/mldsa.js";
import { SoftwareAuthenticator } from "../keys/passkey.js";
import { NodeClientError, type NodeClient } from "../node.js";
import { RecordedNode, type RecordedCall } from "../testing/recorded-node.js";
import { alphanetDefinitions } from "../testing/simulated-definitions.js";
import { checkExposure } from "./exposure.js";
import {
  accountInfo,
  accountObjects,
  accountTx,
  funding,
  noAuthorities,
  type FixtureTx,
} from "./fixtures.js";

const defs = alphanetDefinitions();
const kDisableMaster = 0x00100000;

function keyPair() {
  const signer = classicSignerFromSeed(generateClassicSeed());
  return {
    publicKey: bytesToHex(signer.publicKey),
    address: addressFromPublicKey(signer.publicKey),
  };
}
const funder = keyPair();
let counter = 0;
function hash(): string {
  counter += 1;
  return counter.toString(16).toUpperCase().padStart(64, "0");
}
function created(address: string, ledgerIndex = 10): FixtureTx {
  return funding(address, funder.address, ledgerIndex, hash(), funder.publicKey);
}
function signed(
  account: string,
  publicKey: string,
  ledgerIndex: number,
  extra: Record<string, unknown> = {},
): FixtureTx {
  return {
    hash: hash(),
    ledgerIndex,
    tx: { TransactionType: "AccountSet", Account: account, SigningPubKey: publicKey, ...extra },
  };
}
const range = { min: 1, max: 1000 };
const node = (...calls: (RecordedCall | RecordedCall[])[]) => new RecordedNode(calls.flat());

describe("checkExposure edge cases (section 8.7)", () => {
  it("pseudo-account: no key can sign, reported without a master finding", async () => {
    const amm = keyPair();
    const report = await checkExposure(
      amm.address,
      node(
        accountInfo(amm.address, { AMMID: "AB".repeat(32), Flags: kDisableMaster }),
        accountTx(amm.address, [], { min: 50, max: 100 }),
        noAuthorities(amm.address),
      ),
      defs,
    );
    expect(report.pseudoAccount).toBe(true);
    expect(report.findings.find((f) => f.role === "master")).toBeUndefined();
    expect(report.status).toBe("no-exposure-found");
  });

  it("tickets: a transaction with Sequence 0 and TicketSequence still reveals the master", async () => {
    const t = keyPair();
    const report = await checkExposure(
      t.address,
      node(
        accountInfo(t.address, {}),
        accountTx(
          t.address,
          [
            created(t.address),
            signed(t.address, t.publicKey, 12, { Sequence: 0, TicketSequence: 7 }),
          ],
          range,
        ),
        noAuthorities(t.address),
      ),
      defs,
    );
    expect(report.status).toBe("exposed");
    expect(report.findings.find((f) => f.role === "master")?.firstReveal?.ledgerIndex).toBe(12);
  });

  it("a session key that signed is reported as bounded by its session while the session lives, not as a key without authority", async () => {
    const owner = keyPair();
    const session = keyPair();
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, {}),
        accountTx(
          owner.address,
          [created(owner.address), signed(owner.address, session.publicKey, 20)],
          range,
        ),
        noAuthorities(owner.address),
      ),
      defs,
    );
    const former = report.findings.find((f) => f.address === session.address);
    expect(former?.role).toBe("former-key");
    const reason = former?.reasons.join(" ") ?? "";
    expect(reason).toMatch(/live signing session/);
    expect(reason).toMatch(/bounded by that session/);
  });

  it("a regular key shared by several accounts: revealed elsewhere is unknown here, revealed as its own master is exposed", async () => {
    const owner = keyPair();
    const shared = keyPair();
    // The shared key never signed for `owner`; its own account history is empty within range.
    const unseen = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, { RegularKey: shared.address }),
        accountTx(owner.address, [created(owner.address)], range),
        accountTx(shared.address, [], range),
        noAuthorities(owner.address),
      ),
      defs,
    );
    const regular = unseen.findings.find((f) => f.role === "regular-key");
    expect(regular?.status).toBe("unknown");
    expect(regular?.reasons.join(" ")).toMatch(/other accounts, which this history does not show/);
    expect(unseen.status).toBe("unknown");

    // The same key signed for its own account: exposed.
    const seen = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, { RegularKey: shared.address }),
        accountTx(owner.address, [created(owner.address)], range),
        accountTx(
          shared.address,
          [created(shared.address), signed(shared.address, shared.publicKey, 30)],
          range,
        ),
        noAuthorities(owner.address),
      ),
      defs,
    );
    expect(seen.findings.find((f) => f.role === "regular-key")?.status).toBe("exposed");
    expect(seen.status).toBe("exposed");
  });

  it("a passkey is exposed by construction, and one that signed is attributed to the passkey, not the master", async () => {
    const owner = keyPair();
    const authenticator = new SoftwareAuthenticator("https://localhost");
    const passkey = bytesToHex(authenticator.credential.publicKey);
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, {}),
        accountTx(
          owner.address,
          [created(owner.address), signed(owner.address, passkey, 15)],
          range,
        ),
        accountObjects(owner.address, "passkey_list", [
          {
            LedgerEntryType: "PasskeyList",
            PreviousTxnID: "CC".repeat(32),
            Passkeys: [{ Passkey: { PasskeyID: "01", PublicKey: passkey } }],
          },
        ]),
        accountObjects(owner.address, "beneficiary", []),
        accountObjects(owner.address, "delegate", []),
        accountObjects(owner.address, "signer_list", []),
      ),
      defs,
    );
    expect(report.findings.find((f) => f.role === "master")?.status).toBe("no-exposure-found");
    const pk = report.findings.find((f) => f.role === "passkey");
    expect(pk).toMatchObject({ status: "exposed", keyType: "p256", survivesDisableMaster: true });
    expect(pk?.firstReveal?.hash).toBe("CC".repeat(32));
    expect(report.status).toBe("exposed");
  });

  it("a migrated account (master disabled, ML-DSA regular key) is not quantum-exposed", async () => {
    const owner = keyPair();
    const mlDsa = mlDsaKeyPairFromSeed(generateMlDsaSeed());
    const mlDsaHex = bytesToHex(mlDsa.publicKey);
    const mlDsaAddress = addressFromPublicKey(mlDsa.publicKey);
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, { RegularKey: mlDsaAddress, Flags: kDisableMaster }),
        accountTx(
          owner.address,
          [
            created(owner.address),
            signed(owner.address, owner.publicKey, 11),
            signed(owner.address, mlDsaHex, 12),
          ],
          range,
        ),
        noAuthorities(owner.address),
      ),
      defs,
    );
    expect(report.masterDisabled).toBe(true);
    expect(report.findings.find((f) => f.role === "master")).toMatchObject({
      status: "exposed",
      active: false,
    });
    expect(report.findings.find((f) => f.role === "regular-key")).toMatchObject({
      status: "exposed",
      keyType: "ml-dsa-44",
      quantumVulnerable: false,
    });
    expect(report.status).toBe("no-exposure-found");
    expect(report.reasons).toContain("the master key is exposed but disabled");
  });

  it("signer list: exposed at the quorum, not below it, unknown when unknown weight could reach it", async () => {
    const owner = keyPair();
    const s1 = keyPair();
    const s2 = keyPair();
    const s3 = keyPair();
    const multisigned: FixtureTx = {
      hash: hash(),
      ledgerIndex: 20,
      tx: {
        TransactionType: "AccountSet",
        Account: owner.address,
        SigningPubKey: "",
        Signers: [
          { Signer: { Account: s1.address, SigningPubKey: s1.publicKey, TxnSignature: "00" } },
        ],
      },
    };
    const signerAccounts = (s3History: FixtureTx[]) => [
      accountInfo(s2.address, {}),
      accountTx(s2.address, [created(s2.address)], range),
      accountInfo(s3.address, {}),
      accountTx(s3.address, s3History, range),
    ];
    const list = (quorum: number) =>
      accountObjects(owner.address, "signer_list", [
        {
          SignerQuorum: quorum,
          SignerEntries: [
            { SignerEntry: { Account: s1.address, SignerWeight: 1 } },
            { SignerEntry: { Account: s2.address, SignerWeight: 1 } },
            { SignerEntry: { Account: s3.address, SignerWeight: 1 } },
          ],
        },
      ]);
    const base = (quorum: number, s3History: FixtureTx[]) =>
      node(
        accountInfo(owner.address, { Flags: kDisableMaster }),
        accountTx(owner.address, [created(owner.address), multisigned], range),
        accountObjects(owner.address, "passkey_list", []),
        accountObjects(owner.address, "beneficiary", []),
        accountObjects(owner.address, "delegate", []),
        list(quorum),
        ...signerAccounts(s3History),
      );
    // s1 exposed (signed here), s2 never signed (full history), s3 created before the node's history.
    const atQuorum = await checkExposure(owner.address, base(1, []), defs);
    expect(atQuorum.findings.find((f) => f.role === "signer-list")?.status).toBe("exposed");
    const unknown = await checkExposure(owner.address, base(2, []), defs);
    const unknownList = unknown.findings.find((f) => f.role === "signer-list");
    expect(unknownList?.status).toBe("unknown");
    expect(unknownList?.signers?.map((s) => s.status)).toEqual([
      "exposed",
      "no-exposure-found",
      "unknown",
    ]);
    const below = await checkExposure(owner.address, base(2, [created(s3.address)]), defs);
    expect(below.findings.find((f) => f.role === "signer-list")?.status).toBe("no-exposure-found");
  });

  it("a signer that is itself a multi-signed account counts only its own master or regular key", async () => {
    const owner = keyPair();
    const inner = keyPair(); // a signer account whose own transactions are multi-signed
    const innerSigner = keyPair();
    const innerMultisigned: FixtureTx = {
      hash: hash(),
      ledgerIndex: 40,
      tx: {
        TransactionType: "AccountSet",
        Account: inner.address,
        SigningPubKey: "",
        Signers: [
          {
            Signer: {
              Account: innerSigner.address,
              SigningPubKey: innerSigner.publicKey,
              TxnSignature: "00",
            },
          },
        ],
      },
    };
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, { Flags: kDisableMaster }),
        accountTx(owner.address, [created(owner.address)], range),
        accountObjects(owner.address, "passkey_list", []),
        accountObjects(owner.address, "beneficiary", []),
        accountObjects(owner.address, "delegate", []),
        accountObjects(owner.address, "signer_list", [
          {
            SignerQuorum: 1,
            SignerEntries: [{ SignerEntry: { Account: inner.address, SignerWeight: 1 } }],
          },
        ]),
        accountInfo(inner.address, { Flags: kDisableMaster }),
        accountTx(inner.address, [created(inner.address), innerMultisigned], range),
      ),
      defs,
    );
    const list = report.findings.find((f) => f.role === "signer-list");
    // The inner account's own signer list plays no part: its master is disabled and it has no regular key.
    expect(list?.signers?.[0]?.status).toBe("no-exposure-found");
    expect(list?.status).toBe("no-exposure-found");
  });

  it("delegates are reported as authorities that survive asfDisableMaster", async () => {
    const owner = keyPair();
    const delegate = keyPair();
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, {}),
        accountTx(owner.address, [created(owner.address)], range),
        accountObjects(owner.address, "passkey_list", []),
        accountObjects(owner.address, "beneficiary", []),
        accountObjects(owner.address, "delegate", [
          { Account: owner.address, Authorize: delegate.address },
        ]),
        accountObjects(owner.address, "signer_list", []),
        accountInfo(delegate.address, {}),
        accountTx(
          delegate.address,
          [created(delegate.address), signed(delegate.address, delegate.publicKey, 50)],
          range,
        ),
      ),
      defs,
    );
    expect(report.findings.find((f) => f.role === "delegate")).toMatchObject({
      status: "exposed",
      survivesDisableMaster: true,
    });
    expect(report.status).toBe("exposed");
  });

  it("lists other places a key appears (PaymentChannelCreate.PublicKey, rule 5)", async () => {
    const owner = keyPair();
    const channelKey = keyPair();
    const report = await checkExposure(
      owner.address,
      node(
        accountInfo(owner.address, {}),
        accountTx(
          owner.address,
          [
            created(owner.address),
            {
              hash: hash(),
              ledgerIndex: 11,
              tx: {
                TransactionType: "PaymentChannelCreate",
                Account: owner.address,
                SigningPubKey: owner.publicKey,
                PublicKey: channelKey.publicKey,
              },
            },
          ],
          range,
        ),
        noAuthorities(owner.address),
      ),
      defs,
    );
    expect(report.otherKeys).toEqual([
      expect.objectContaining({
        field: "PaymentChannelCreate.PublicKey",
        publicKey: channelKey.publicKey,
        keyType: "secp256k1",
      }),
    ]);
  });

  it("falls back to newest first when the node refuses `forward`, and keeps the oldest reveal", async () => {
    const owner = keyPair();
    const recorded = node(
      accountInfo(owner.address, {}),
      noAuthorities(owner.address),
      // Newest first: the reveal at ledger 30 comes before the one at ledger 12.
      [
        {
          method: "account_tx",
          params: {
            account: owner.address,
            ledger_index_min: -1,
            ledger_index_max: -1,
            limit: 200,
          },
          result: {
            ledger_index_min: 1,
            ledger_index_max: 1000,
            transactions: [
              signed(owner.address, owner.publicKey, 30),
              signed(owner.address, owner.publicKey, 12),
              created(owner.address),
            ].map((t) => ({
              meta: {
                AffectedNodes: t.createsAccount
                  ? [
                      {
                        CreatedNode: {
                          LedgerEntryType: "AccountRoot",
                          NewFields: { Account: owner.address },
                        },
                      },
                    ]
                  : [],
              },
              tx: { ...t.tx, hash: t.hash, ledger_index: t.ledgerIndex },
              validated: true,
            })),
          },
        },
      ],
    );
    const refusingForward: NodeClient = {
      request: async (method, params) => {
        if (method === "account_tx" && "forward" in params)
          throw new NodeClientError("account_tx: HTTP 403");
        return recorded.request(method, params);
      },
    };
    const report = await checkExposure(owner.address, refusingForward, defs);
    expect(report.coverage.order).toBe("newest-first");
    expect(report.findings.find((f) => f.role === "master")?.firstReveal?.ledgerIndex).toBe(12);
    expect(report.status).toBe("exposed");
  });
});
