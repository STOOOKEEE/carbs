import { describe, expect, it } from "vitest";
import { decodeAccountID } from "ripple-address-codec";
import { verify as keypairsVerify } from "ripple-keypairs";
import { bytesToHex, concatBytes } from "./bytes.js";
import {
  kLastLedgerSequenceOffset,
  kMaxSessionDuration,
  kSessionMaxLedgerWindow,
} from "./constants.js";
import { DefinitionsError } from "./definitions.js";
import { decodeTx, encodeForSigning, encodeTx, sha512Half, type TxJson } from "./encode.js";
import { resultError, SessionNoWitnessError } from "./errors.js";
import { classicSignerFromSeed, generateClassicSeed } from "./keys/classic.js";
import { createSessionKey } from "./keys/p256-session.js";
import {
  buildSessionDelete,
  buildSessionSet,
  SessionParamsError,
  SessionSignError,
  signAsWitness,
  signingSessionIndex,
  signWithSessionKey,
  witnessSigningData,
  type TxCommonFields,
} from "./session.js";
import {
  simulatedSessionDefinitions,
  standaloneDefinitions,
} from "./testing/simulated-definitions.js";

const defs = simulatedSessionDefinitions();
const account = "rPV7gv7mxunHkt5wHniAmZZsiTH9CDdVZK";
const sessionKey = "rEmnmhwxmkDkj9jKiibNuXxP25VYHJ5Euy";
const common: TxCommonFields = {
  Sequence: 5,
  Fee: "12",
  LastLedgerSequence: 100 + kLastLedgerSequenceOffset,
};

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionParamsError);
    expect((error as SessionParamsError).expectedCode).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("SigningSessionSet builder (SIMULATED definitions)", () => {
  it("opens each mode with exactly one of the three fields", () => {
    const all = buildSessionSet(
      { account, sessionKey, durationSec: 600, mode: { kind: "all" }, common },
      defs,
    );
    expect(all).toMatchObject({ Flags: 0x00010000, SessionDuration: 600, LastLedgerSequence: 250 });
    expect(all["Permissions"]).toBeUndefined();
    expect(all["SessionCap"]).toBeUndefined();

    const p = buildSessionSet(
      {
        account,
        sessionKey,
        durationSec: 60,
        mode: { kind: "permissions", permissions: ["Payment", "OfferCreate"] },
        common,
      },
      defs,
    );
    expect(p["Flags"]).toBeUndefined();
    expect(p["Permissions"]).toEqual([
      { Permission: { PermissionValue: "Payment" } },
      { Permission: { PermissionValue: "OfferCreate" } },
    ]);
    // The encoder turns a permission name into its value: type + 1 (Payment is type 0).
    const decoded = decodeTx(encodeTx(p, defs), defs) as {
      Permissions: { Permission: { PermissionValue: string } }[];
    };
    expect(decoded.Permissions[0]?.Permission.PermissionValue).toBe("Payment");

    const c = buildSessionSet(
      { account, sessionKey, durationSec: 1, mode: { kind: "cap", capDrops: 20_000_000n }, common },
      defs,
    );
    expect(c).toMatchObject({ SessionCap: "20000000" });
    expect(c["Flags"]).toBeUndefined();
  });

  it("refuses what preflight refuses, with the node's code (cases 2 to 5)", () => {
    const base = { account, sessionKey, durationSec: 600, mode: { kind: "all" } as const, common };
    expectCode(() => buildSessionSet({ ...base, sessionKey: account }, defs), "temMALFORMED");
    expectCode(() => buildSessionSet({ ...base, durationSec: 0 }, defs), "temBAD_EXPIRATION");
    expectCode(
      () => buildSessionSet({ ...base, durationSec: kMaxSessionDuration + 1 }, defs),
      "temBAD_EXPIRATION",
    );
    expectCode(() => buildSessionSet({ ...base, durationSec: 1.5 }, defs), "temBAD_EXPIRATION");
    expectCode(
      () => buildSessionSet({ ...base, mode: { kind: "permissions", permissions: [] } }, defs),
      "temARRAY_EMPTY",
    );
    expectCode(
      () =>
        buildSessionSet(
          {
            ...base,
            mode: {
              kind: "permissions",
              permissions: Array.from({ length: 11 }, (_, i) => `P${i}`),
            },
          },
          defs,
        ),
      "temARRAY_TOO_LARGE",
    );
    expectCode(
      () =>
        buildSessionSet(
          { ...base, mode: { kind: "permissions", permissions: ["Payment", "Payment"] } },
          defs,
        ),
      "temMALFORMED",
    );
    expectCode(
      () => buildSessionSet({ ...base, mode: { kind: "cap", capDrops: 0n } }, defs),
      "temBAD_AMOUNT",
    );
    expectCode(() => buildSessionSet({ ...base, sessionKey: "nope" }, defs), "temMALFORMED");
    // Boundaries 1 and kMax open.
    expect(buildSessionSet({ ...base, durationSec: 1 }, defs)["SessionDuration"]).toBe(1);
    expect(
      buildSessionSet({ ...base, durationSec: kMaxSessionDuration }, defs)["SessionDuration"],
    ).toBe(600);
  });
});

describe("SigningSessionDelete builder", () => {
  it("closes by the owner or the session key, and by a third party with Owner", () => {
    expect(buildSessionDelete({ account, sessionKey, common })).toMatchObject({
      TransactionType: "SigningSessionDelete",
      SessionKey: sessionKey,
      LastLedgerSequence: common.LastLedgerSequence,
    });
    const third = "rawnHFk1gPQeEBC88cXbetXLqw3hnqk4pE";
    expect(
      buildSessionDelete({ account: third, sessionKey, owner: account, common })["Owner"],
    ).toBe(account);
    expectCode(
      () => buildSessionDelete({ account, sessionKey, owner: account, common }),
      "temMALFORMED",
    );
  });
});

describe("session keylet", () => {
  it("is SHA512Half(0x007A ‖ Account ‖ SessionKey)", () => {
    const expected = bytesToHex(
      sha512Half(
        concatBytes(Uint8Array.of(0, 0x7a), decodeAccountID(account), decodeAccountID(sessionKey)),
      ),
    );
    expect(signingSessionIndex(account, sessionKey)).toBe(expected);
    expect(signingSessionIndex(account, sessionKey)).not.toBe(
      signingSessionIndex(sessionKey, account),
    );
  });
});

describe("signing with a session key", () => {
  it("refuses a transaction without LastLedgerSequence: every session transaction carries one", async () => {
    const key = await createSessionKey();
    const payment = {
      TransactionType: "Payment",
      Account: account,
      Destination: sessionKey,
      Amount: "1",
      Fee: "12",
      Sequence: 1,
    };
    await expect(signWithSessionKey(payment, key, defs, 10)).rejects.toThrow(SessionSignError);
    await expect(
      signWithSessionKey(
        { ...payment, LastLedgerSequence: 10 + kSessionMaxLedgerWindow + 1 },
        key,
        defs,
        10,
      ),
    ).rejects.toThrow(/ledgers ahead/);
    await expect(
      signWithSessionKey(
        { ...payment, LastLedgerSequence: 20, Delegate: sessionKey },
        key,
        defs,
        10,
      ),
    ).rejects.toThrow(/Delegate/);
    const signed = await signWithSessionKey({ ...payment, LastLedgerSequence: 20 }, key, defs, 10);
    expect(signed.tx["SigningPubKey"]).toBe(key.publicKeyHex);
  });

  it("refuses without the current ledger: the LastLedgerSequence window cannot be checked", async () => {
    const key = await createSessionKey();
    const payment = {
      TransactionType: "Payment",
      Account: account,
      Destination: sessionKey,
      Amount: "1",
      Fee: "12",
      Sequence: 1,
      LastLedgerSequence: 1_000_000,
    };
    // A JavaScript caller can still omit it; the type no longer allows it.
    // @ts-expect-error currentLedger is required
    await expect(signWithSessionKey(payment, key, defs)).rejects.toThrow(/current ledger/);
    await expect(signWithSessionKey(payment, key, defs, Number.NaN)).rejects.toThrow(
      /current ledger/,
    );
  });

  it("gives every builder output a LastLedgerSequence", () => {
    const built = [
      buildSessionSet(
        { account, sessionKey, durationSec: 600, mode: { kind: "all" }, common },
        defs,
      ),
      buildSessionDelete({ account, sessionKey, common }),
    ];
    for (const tx of built) expect(typeof tx["LastLedgerSequence"]).toBe("number");
  });
});

describe("carbs protections: per-transaction bound and witness (SIMULATED definitions)", () => {
  const witness = "rawnHFk1gPQeEBC88cXbetXLqw3hnqk4pE";
  const capMode = { kind: "cap", capDrops: 20_000_000n } as const;
  const base = { account, sessionKey, durationSec: 600, mode: capMode, common };

  it("writes SessionMaxPerTx and SessionWitness, and the encoder keeps them", () => {
    const tx = buildSessionSet(
      { ...base, mode: { ...capMode, maxPerTxDrops: 5_000_000n }, witness },
      defs,
    );
    expect(tx).toMatchObject({
      SessionCap: "20000000",
      SessionMaxPerTx: "5000000",
      SessionWitness: witness,
    });
    expect(decodeTx(encodeTx(tx, defs), defs)).toMatchObject({
      SessionMaxPerTx: "5000000",
      SessionWitness: witness,
    });
    const plain = buildSessionSet(base, defs);
    expect(plain["SessionMaxPerTx"]).toBeUndefined();
    expect(plain["SessionWitness"]).toBeUndefined();
    const all = buildSessionSet({ ...base, mode: { kind: "all" }, witness }, defs);
    expect(all["SessionWitness"]).toBe(witness);
    // The bound may equal the cap.
    expect(
      buildSessionSet({ ...base, mode: { ...capMode, maxPerTxDrops: capMode.capDrops } }, defs)[
        "SessionMaxPerTx"
      ],
    ).toBe("20000000");
  });

  it("refuses what preflight refuses, with the node's code", () => {
    expectCode(
      () => buildSessionSet({ ...base, mode: { ...capMode, maxPerTxDrops: 0n } }, defs),
      "temBAD_AMOUNT",
    );
    expectCode(
      () =>
        buildSessionSet(
          { ...base, mode: { ...capMode, maxPerTxDrops: capMode.capDrops + 1n } },
          defs,
        ),
      "temBAD_AMOUNT",
    );
    expectCode(() => buildSessionSet({ ...base, witness: account }, defs), "temMALFORMED");
    expectCode(() => buildSessionSet({ ...base, witness: sessionKey }, defs), "temMALFORMED");
    expectCode(() => buildSessionSet({ ...base, witness: "nope" }, defs), "temMALFORMED");
  });

  it("refuses a protection the node does not serve", () => {
    const node = standaloneDefinitions();
    expect(() =>
      buildSessionSet({ ...base, mode: { ...capMode, maxPerTxDrops: 1n } }, node),
    ).toThrow(DefinitionsError);
    expect(() => buildSessionSet({ ...base, witness }, node)).toThrow(DefinitionsError);
  });

  const payment: TxJson = {
    TransactionType: "Payment",
    Account: account,
    Destination: witness,
    Amount: "1000000",
    Fee: "12",
    Sequence: 9,
    LastLedgerSequence: 120,
  };

  for (const algorithm of ["ecdsa-secp256k1", "ed25519"] as const) {
    it(`co-signs WTS\\0 ‖ the session-signed fields with a ${algorithm} witness`, async () => {
      const key = await createSessionKey();
      const sessionSigned = await signWithSessionKey(payment, key, defs, 100);
      const witnessKey = classicSignerFromSeed(generateClassicSeed(algorithm));
      const cosigned = await signAsWitness(sessionSigned.tx, witnessKey, defs);

      const expectedData = concatBytes(
        Uint8Array.of(0x57, 0x54, 0x53, 0x00),
        encodeForSigning(sessionSigned.tx, defs).subarray(4),
      );
      expect(witnessSigningData(sessionSigned.tx, defs)).toEqual(expectedData);
      const witnessSignature = cosigned.tx["WitnessSignature"] as {
        SigningPubKey: string;
        TxnSignature: string;
      };
      expect(witnessSignature.SigningPubKey).toBe(bytesToHex(witnessKey.publicKey));
      expect(
        keypairsVerify(
          bytesToHex(expectedData),
          witnessSignature.TxnSignature,
          witnessSignature.SigningPubKey,
        ),
      ).toBe(true);

      // WitnessSignature is not a signing field: the session key's signing data is unchanged.
      expect(encodeForSigning(cosigned.tx, defs)).toEqual(encodeForSigning(sessionSigned.tx, defs));
      expect(cosigned.tx["TxnSignature"]).toBe(sessionSigned.tx["TxnSignature"]);
      expect(decodeTx(cosigned.blob, defs)["WitnessSignature"]).toEqual(witnessSignature);
      expect(cosigned.hash).not.toBe(sessionSigned.hash);
    });
  }

  it("co-signs only a session-signed transaction, never with the session key", async () => {
    const key = await createSessionKey();
    const witnessKey = classicSignerFromSeed(generateClassicSeed());
    await expect(signAsWitness(payment, witnessKey, defs)).rejects.toThrow(SessionSignError);
    await expect(
      signAsWitness({ ...payment, SigningPubKey: key.publicKeyHex }, witnessKey, defs),
    ).rejects.toThrow(SessionSignError);
    const sessionSigned = await signWithSessionKey(payment, key, defs, 100);
    await expect(signAsWitness(sessionSigned.tx, key, defs)).rejects.toThrow(/own witness/);
  });

  it("maps tefSESSION_NO_WITNESS, read by name from the definitions", () => {
    const code = defs.resultCode("tefSESSION_NO_WITNESS");
    expect(code).toBe(defs.resultCode("tefFIREWALL_BLOCK") + 4);
    expect(defs.resultName(code)).toBe("tefSESSION_NO_WITNESS");
    const error = resultError("tefSESSION_NO_WITNESS", "");
    expect(error).toBeInstanceOf(SessionNoWitnessError);
    expect(error.included).toBe(false);
  });
});
