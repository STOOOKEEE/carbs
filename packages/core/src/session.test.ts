import { describe, expect, it } from "vitest";
import { decodeAccountID } from "ripple-address-codec";
import { bytesToHex, concatBytes } from "./bytes.js";
import {
  kLastLedgerSequenceOffset,
  kMaxSessionDuration,
  kSessionMaxLedgerWindow,
} from "./constants.js";
import { decodeTx, encodeTx, sha512Half } from "./encode.js";
import { createSessionKey } from "./keys/p256-session.js";
import {
  buildSessionDelete,
  buildSessionSet,
  SessionParamsError,
  SessionSignError,
  signingSessionIndex,
  signWithSessionKey,
  type TxCommonFields,
} from "./session.js";
import { simulatedSessionDefinitions } from "./testing/simulated-definitions.js";

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
    await expect(signWithSessionKey(payment, key, defs)).rejects.toThrow(SessionSignError);
    await expect(
      signWithSessionKey(
        { ...payment, LastLedgerSequence: 10 + kSessionMaxLedgerWindow + 1 },
        key,
        defs,
        10,
      ),
    ).rejects.toThrow(/ledgers ahead/);
    await expect(
      signWithSessionKey({ ...payment, LastLedgerSequence: 20, Delegate: sessionKey }, key, defs),
    ).rejects.toThrow(/Delegate/);
    const signed = await signWithSessionKey({ ...payment, LastLedgerSequence: 20 }, key, defs, 10);
    expect(signed.tx["SigningPubKey"]).toBe(key.publicKeyHex);
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
