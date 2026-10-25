import { describe, expect, it } from "vitest";
import {
  batchBaseFee,
  BatchParamsError,
  buildBatch,
  kMaxBatchTxCount,
  type BatchMode,
  type BatchParams,
} from "./batch.js";
import { decodeTx, encodeTx, type TxJson } from "./encode.js";
import type { TxCommonFields } from "./session.js";
import { standaloneDefinitions } from "./testing/simulated-definitions.js";

const defs = standaloneDefinitions();
const account = "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK";
const other = "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy";
const common: TxCommonFields = { Sequence: 5, Fee: "40", LastLedgerSequence: 250 };
const kInnerBatchTxn = 0x40000000;
const kFullyCanonicalSig = 0x80000000;

function payment(from: string = account): TxJson {
  return { TransactionType: "Payment", Account: from, Destination: other, Amount: "1000000" };
}

function params(inner: readonly TxJson[], mode: BatchMode = "all-or-nothing"): BatchParams {
  return { account, inner, mode, common };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(BatchParamsError);
    expect(error instanceof BatchParamsError && error.expectedCode).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("Batch builder (standalone node definitions)", () => {
  it("sets the outer flag of each mode", () => {
    const expected: readonly [BatchMode, number][] = [
      ["all-or-nothing", 0x00010000],
      ["only-one", 0x00020000],
      ["until-failure", 0x00040000],
      ["independent", 0x00080000],
    ];
    for (const [mode, flag] of expected) {
      const batch = buildBatch(params([payment(), payment()], mode), defs);
      expect(batch).toMatchObject({ TransactionType: "Batch", Account: account, Flags: flag });
    }
  });

  it("marks each inner transaction and keeps its own flags unsigned", () => {
    const batch = buildBatch(
      params([{ ...payment(), Flags: kFullyCanonicalSig }, payment()]),
      defs,
    );
    expect(batch["RawTransactions"]).toMatchObject([
      {
        RawTransaction: {
          Flags: (kFullyCanonicalSig | kInnerBatchTxn) >>> 0,
          Fee: "0",
          SigningPubKey: "",
        },
      },
      { RawTransaction: { Flags: kInnerBatchTxn, Fee: "0", SigningPubKey: "" } },
    ]);
  });

  it("gives the inner transactions the sequences after the outer one", () => {
    const inner = [payment(), payment(), payment()];
    const batch = buildBatch(params(inner), defs);
    expect(batch).toMatchObject({ Sequence: 5, Fee: "40", LastLedgerSequence: 250 });
    expect(batch["RawTransactions"]).toMatchObject([
      { RawTransaction: { Sequence: 6 } },
      { RawTransaction: { Sequence: 7 } },
      { RawTransaction: { Sequence: 8 } },
    ]);
    // The inputs are left as they were.
    expect(inner[0]?.["Sequence"]).toBeUndefined();
  });

  it("copies NetworkID to every inner transaction", () => {
    const batch = buildBatch(
      { ...params([payment(), payment()]), common: { ...common, NetworkID: 24100 } },
      defs,
    );
    expect(batch["NetworkID"]).toBe(24100);
    expect(batch["RawTransactions"]).toMatchObject([
      { RawTransaction: { NetworkID: 24100 } },
      { RawTransaction: { NetworkID: 24100 } },
    ]);
  });

  it("encodes with the node's definitions", () => {
    const batch = buildBatch(params([payment(), payment()]), defs);
    const decoded = decodeTx(encodeTx(batch, defs), defs);
    expect(decoded["TransactionType"]).toBe("Batch");
    expect(decoded["RawTransactions"]).toEqual(batch["RawTransactions"]);
  });

  it("accepts exactly the maximum number of inner transactions", () => {
    const inner = Array.from({ length: kMaxBatchTxCount }, () => payment());
    expect(buildBatch(params(inner), defs)["RawTransactions"]).toHaveLength(kMaxBatchTxCount);
  });

  it("refuses what the node refuses", () => {
    expectCode(() => buildBatch(params([]), defs), "temARRAY_EMPTY");
    expectCode(() => buildBatch(params([payment()]), defs), "temARRAY_EMPTY");
    const tooMany = Array.from({ length: kMaxBatchTxCount + 1 }, () => payment());
    expectCode(() => buildBatch(params(tooMany), defs), "temMALFORMED");
    const nested: TxJson = { ...payment(), TransactionType: "Batch" };
    expectCode(() => buildBatch(params([payment(), nested]), defs), "temMALFORMED");
    expectCode(() => buildBatch(params([payment(), payment(other)]), defs), "temBAD_SIGNER");
    expectCode(
      () => buildBatch(params([payment(), { ...payment(), TxnSignature: "AB" }]), defs),
      "temBAD_SIGNATURE",
    );
    expectCode(
      () => buildBatch(params([payment(), { ...payment(), TicketSequence: 9 }]), defs),
      "temSEQ_AND_TICKET",
    );
    expectCode(
      () => buildBatch(params([payment(), { ...payment(), Flags: -1 }]), defs),
      "temINVALID_FLAG",
    );
  });
});

describe("Batch base fee (Batch::calculateBaseFee)", () => {
  const base = 10n;

  it("is two base fees plus the inner base fees", () => {
    // jtx batch::calcBatchFee(env, 0, 2): (0 + 2) * base + 2 * base.
    expect(batchBaseFee({ baseFeeDrops: base, innerBaseFeesDrops: [base, base] })).toBe(40n);
  });

  it("adds one base fee per BatchSigner signature", () => {
    // jtx batch::calcBatchFee(env, 1, 3): (1 + 2) * base + 3 * base.
    const fee = batchBaseFee({
      baseFeeDrops: base,
      innerBaseFeesDrops: [base, base, base],
      batchSignerSignatures: 1,
    });
    expect(fee).toBe(60n);
  });

  it("takes each inner base fee as given and counts outer multi-signers", () => {
    const ownerReserve = 200_000n;
    expect(batchBaseFee({ baseFeeDrops: base, innerBaseFeesDrops: [base, ownerReserve] })).toBe(
      2n * base + base + ownerReserve,
    );
    expect(
      batchBaseFee({ baseFeeDrops: base, innerBaseFeesDrops: [base, base], outerSigners: 2 }),
    ).toBe(60n);
  });

  it("refuses negative inputs", () => {
    expect(() => batchBaseFee({ baseFeeDrops: -1n, innerBaseFeesDrops: [] })).toThrow(RangeError);
    expect(() => batchBaseFee({ baseFeeDrops: base, innerBaseFeesDrops: [-1n] })).toThrow(
      RangeError,
    );
    expect(() =>
      batchBaseFee({ baseFeeDrops: base, innerBaseFeesDrops: [], batchSignerSignatures: -1 }),
    ).toThrow(RangeError);
  });
});
