/**
 * The simulated node against the cases of spec 6.15. SIMULATED: these tests prove that the
 * simulation follows the spec; they prove nothing about rippled (those are the jtx suites).
 */
import { describe, expect, it } from "vitest";
import {
  ASF_DISABLE_MASTER,
  MAX_SESSION_DURATION_SEC,
  SIM_LEDGER_CLOSE_SEC,
  TF_ALL_TRANSACTIONS,
} from "../constants";
import { fundedAccount, openSession, pay, rig, send } from "./test-helpers";
import { accountIdOf } from "./keys";
import { ALL_TYPES, DELEGABLE_TYPES, NON_DELEGABLE_TYPES, SESSION_EXCLUDED_TYPES } from "./types";

const SET = "SigningSessionSet";
const DEL = "SigningSessionDelete";

describe("session open (cases 1 to 7)", () => {
  it("opens each mode, takes one reserve, sets Expiration and SessionSpent (case 1)", async () => {
    const r = await rig();
    const before = await r.node.accountInfo(r.account);
    const closeTime = (await r.node.serverInfo()).closeTime;
    const a = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const p = await openSession(r, { Permissions: ["Payment"] });
    const c = await openSession(r, { SessionCap: "20000000" });
    expect([a.result.code, p.result.code, c.result.code]).toEqual([
      "tesSUCCESS",
      "tesSUCCESS",
      "tesSUCCESS",
    ]);
    const after = await r.node.accountInfo(r.account);
    expect(after?.ownerCount).toBe((before?.ownerCount ?? 0) + 3);
    const objects = await r.node.accountObjects(r.account);
    expect(objects.sessions.map((s) => s.mode).sort()).toEqual(["A", "C", "P"]);
    const mode = objects.sessions.find((s) => s.mode === "C");
    expect(mode?.spentDrops).toBe(0);
    expect(mode?.expiration).toBe(closeTime + MAX_SESSION_DURATION_SEC);
  });

  it("refuses none or two modes with temMALFORMED (case 2)", async () => {
    const r = await rig();
    expect((await openSession(r, {})).result.code).toBe("temMALFORMED");
    expect(
      (await openSession(r, { Permissions: ["Payment"], SessionCap: "1000000" })).result.code,
    ).toBe("temMALFORMED");
    expect(
      (await openSession(r, { Flags: TF_ALL_TRANSACTIONS, SessionCap: "1000000" })).result.code,
    ).toBe("temMALFORMED");
  });

  it("refuses the account's own key, a regular key and a duplicate (case 3)", async () => {
    const r = await rig();
    const own = await send(r.node, r.master, {
      TransactionType: SET,
      Account: r.account,
      SessionKey: r.account,
      SessionDuration: 60,
      Flags: TF_ALL_TRANSACTIONS,
    });
    expect(own.code).toBe("temMALFORMED");

    const regular = await r.wallet.createSessionKey("p256");
    await send(r.node, r.master, {
      TransactionType: "SetRegularKey",
      Account: r.account,
      RegularKey: regular.address,
    });
    const asRegular = await send(r.node, r.master, {
      TransactionType: SET,
      Account: r.account,
      SessionKey: regular.address,
      SessionDuration: 60,
      Flags: TF_ALL_TRANSACTIONS,
    });
    expect(asRegular.code).toBe("tecNO_PERMISSION");

    const first = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const again = await send(r.node, r.master, {
      TransactionType: SET,
      Account: r.account,
      SessionKey: first.key.address,
      SessionDuration: 60,
      Flags: TF_ALL_TRANSACTIONS,
    });
    expect(again.code).toBe("tecDUPLICATE");
  });

  it("checks the duration boundaries (case 4)", async () => {
    const r = await rig();
    const flags = { Flags: TF_ALL_TRANSACTIONS };
    expect((await openSession(r, { ...flags, SessionDuration: 0 })).result.code).toBe(
      "temBAD_EXPIRATION",
    );
    expect(
      (await openSession(r, { ...flags, SessionDuration: MAX_SESSION_DURATION_SEC + 1 })).result
        .code,
    ).toBe("temBAD_EXPIRATION");
    expect((await openSession(r, { ...flags, SessionDuration: 1 })).result.code).toBe("tesSUCCESS");
    expect(
      (await openSession(r, { ...flags, SessionDuration: MAX_SESSION_DURATION_SEC })).result.code,
    ).toBe("tesSUCCESS");
  });

  it("validates Permissions (case 5)", async () => {
    const r = await rig();
    for (const type of [
      "AccountSet",
      "SetRegularKey",
      "SignerListSet",
      "DelegateSet",
      "Batch",
      "PasskeyListSet",
      SET,
      DEL,
      "NotAType",
    ]) {
      expect((await openSession(r, { Permissions: [type] })).result.code).toBe("temMALFORMED");
    }
    expect((await openSession(r, { Permissions: [] })).result.code).toBe("temARRAY_EMPTY");
    expect((await openSession(r, { Permissions: ["Payment", "Payment"] })).result.code).toBe(
      "temMALFORMED",
    );
    const eleven = Array.from({ length: 11 }, (_, i) => `T${i}`);
    expect((await openSession(r, { Permissions: eleven })).result.code).toBe("temARRAY_TOO_LARGE");
  });

  it("refuses unknown flag bits (preflight)", async () => {
    const r = await rig();
    expect((await openSession(r, { Flags: TF_ALL_TRANSACTIONS | 0x4 })).result.code).toBe(
      "temINVALID_FLAG",
    );
  });

  it("does not let a session key open a session (case 6)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const other = await r.wallet.createSessionKey("p256");
    const result = await send(r.node, key, {
      TransactionType: SET,
      Account: r.account,
      SessionKey: other.address,
      SessionDuration: 60,
      Flags: TF_ALL_TRANSACTIONS,
    });
    expect(result.code).toBe("tefSESSION_TX_NOT_ALLOWED");
    expect(result.feeClaimed).toBe(false);
  });

  it("answers temDISABLED when the amendment is off (case 7)", async () => {
    const r = await rig({ amendmentEnabled: false });
    expect((await openSession(r, { Flags: TF_ALL_TRANSACTIONS })).result.code).toBe("temDISABLED");
  });
});

describe("authorization by mode (cases 8, 9b, 12)", () => {
  it("mode P: a listed type succeeds, an unlisted one is refused (case 8)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Permissions: ["Payment"] });
    const sink = accountIdOf("sink");
    expect((await send(r.node, key, pay(r.account, sink, 2_000_000))).code).toBe("tesSUCCESS");
    const ticket = await send(r.node, key, { TransactionType: "TicketCreate", Account: r.account });
    expect(ticket.code).toBe("tefSESSION_TX_NOT_ALLOWED");
    expect(ticket.feeClaimed).toBe(false);
  });

  it("enumerates every type in mode A and P (case 9b)", async () => {
    expect(new Set([...DELEGABLE_TYPES, ...NON_DELEGABLE_TYPES]).size).toBe(ALL_TYPES.length);
    const r = await rig();
    const a = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const p = await openSession(r, { Permissions: ["Payment"] });
    // The two session types are rejected at preflight when bare; case 6 covers them.
    for (const type of ALL_TYPES.filter((t) => t !== SET && t !== DEL)) {
      const shouldPassA = DELEGABLE_TYPES.includes(type) && !SESSION_EXCLUDED_TYPES.includes(type);
      const tx = {
        TransactionType: type,
        Account: r.account,
        Destination: accountIdOf("sink"),
        Amount: "2000000",
      };
      const resultA = await send(r.node, a.key, tx);
      expect(resultA.code === "tefSESSION_TX_NOT_ALLOWED", `mode A, ${type}`).toBe(!shouldPassA);
      if (type !== "Payment") {
        const resultP = await send(r.node, p.key, tx);
        expect(resultP.code, `mode P, ${type}`).toBe("tefSESSION_TX_NOT_ALLOWED");
      }
    }
  });

  it("mode C allows a plain XRP payment and nothing else (case 12)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { SessionCap: "50000000" });
    const sink = accountIdOf("sink");
    const base = {
      TransactionType: "Payment",
      Account: r.account,
      Destination: sink,
      Amount: "2000000",
    };
    expect((await send(r.node, key, base)).code).toBe("tesSUCCESS");
    const forbidden: Record<string, unknown>[] = [
      { Amount: { currency: "USD", issuer: sink, value: "1" } },
      { SendMax: "5000000" },
      { Paths: [] },
      { DeliverMin: "1" },
      { InvoiceID: "00" },
      { Flags: 0x00020000 },
      { Memos: [] },
    ];
    for (const extra of forbidden) {
      expect((await send(r.node, key, base, extra)).code, JSON.stringify(extra)).toBe(
        "tefSESSION_TX_NOT_ALLOWED",
      );
    }
    const other = await send(r.node, key, { TransactionType: "TicketCreate", Account: r.account });
    expect(other.code).toBe("tefSESSION_TX_NOT_ALLOWED");
  });
});

describe("expiry, cap, fee (cases 10, 11, 13)", () => {
  it("stops at Expiration and still lets the key close (case 10)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS, SessionDuration: 60 });
    const sink = accountIdOf("sink");
    const expiration = (await r.node.accountObjects(r.account)).sessions[0]?.expiration ?? 0;
    while ((await r.node.serverInfo()).closeTime + SIM_LEDGER_CLOSE_SEC < expiration)
      r.node.closeLedger();
    expect((await r.node.serverInfo()).closeTime).toBeLessThan(expiration);
    expect((await send(r.node, key, pay(r.account, sink, 2_000_000))).code).toBe("tesSUCCESS");
    r.node.closeLedger();
    expect((await r.node.serverInfo()).closeTime).toBeGreaterThanOrEqual(expiration);
    expect((await send(r.node, key, pay(r.account, sink, 2_000_000))).code).toBe(
      "tefSESSION_EXPIRED",
    );
    const close = await send(r.node, key, {
      TransactionType: DEL,
      Account: r.account,
      SessionKey: key.address,
    });
    expect(close.code).toBe("tesSUCCESS");
  });

  it("counts fee and amount against the cap (case 11)", async () => {
    const r = await rig();
    const cap = 10_000_000;
    const { key } = await openSession(r, { SessionCap: String(cap) });
    const sink = accountIdOf("sink");
    const over = await send(r.node, key, pay(r.account, sink, cap - 12 + 1));
    expect(over.code).toBe("tefSESSION_LIMIT");
    const exact = await send(r.node, key, pay(r.account, sink, cap - 12));
    expect(exact.code).toBe("tesSUCCESS");
    expect((await r.node.accountObjects(r.account)).sessions[0]?.spentDrops).toBe(cap);
  });

  it("charges only the fee after tecNO_DST_INSUF_XRP (case 11, 23)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { SessionCap: "10000000" });
    const result = await send(r.node, key, pay(r.account, accountIdOf("poor"), 10));
    expect(result.code).toBe("tecNO_DST_INSUF_XRP");
    expect(result.feeClaimed).toBe(true);
    expect((await r.node.accountObjects(r.account)).sessions[0]?.spentDrops).toBe(12);
  });

  it("caps the fee at the ceiling in every mode and burns nothing on refusals (case 13)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Permissions: ["TicketCreate"] });
    const before = (await r.node.accountInfo(r.account))?.balanceDrops;
    const ticket = { TransactionType: "TicketCreate", Account: r.account };
    expect((await send(r.node, key, ticket, { Fee: "10011" })).code).toBe("tefSESSION_LIMIT");
    for (let i = 0; i < 5; i += 1) {
      await send(r.node, key, { TransactionType: "AccountSet", Account: r.account });
    }
    expect((await r.node.accountInfo(r.account))?.balanceDrops).toBe(before);
    expect((await send(r.node, key, ticket, { Fee: "10010" })).code).toBe("tesSUCCESS");
  });
});

describe("whose key it is (cases 14, 15, 17b)", () => {
  it("falls back to the ordinary check for a session key with Delegate or Signers (case 14)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const sink = accountIdOf("sink");
    const delegated = await send(r.node, key, pay(r.account, sink, 2_000_000), { Delegate: sink });
    expect(delegated.code).toBe("tefBAD_AUTH");
    const multisigned = await send(r.node, key, pay(r.account, sink, 2_000_000), { Signers: [] });
    expect(multisigned.code).toBe("tefBAD_AUTH");
  });

  it("refuses a session key signing for another account (case 15)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const stranger = await fundedAccount(r);
    const result = await send(r.node, key, pay(stranger.address, accountIdOf("sink"), 2_000_000));
    expect(result.code).toBe("tefBAD_AUTH");
  });

  it("requires a near LastLedgerSequence (case 17b)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const tx = pay(r.account, accountIdOf("sink"), 2_000_000);
    expect((await send(r.node, key, tx, { LastLedgerSequence: undefined })).code).toBe(
      "tefSESSION_TX_NOT_ALLOWED",
    );
    const far = (await r.node.serverInfo()).ledgerIndex + 1 + 257;
    expect((await send(r.node, key, tx, { LastLedgerSequence: far })).code).toBe(
      "tefSESSION_TX_NOT_ALLOWED",
    );
    const edge = (await r.node.serverInfo()).ledgerIndex + 1 + 256;
    expect((await send(r.node, key, tx, { LastLedgerSequence: edge })).code).toBe("tesSUCCESS");
  });
});

describe("closing (case 18)", () => {
  it("lets the owner and the key close, strangers only after expiry", async () => {
    const r = await rig();
    const stranger = await fundedAccount(r);
    const a = await openSession(r, { Flags: TF_ALL_TRANSACTIONS, SessionDuration: 60 });
    const live = {
      TransactionType: DEL,
      Account: stranger.address,
      SessionKey: a.key.address,
      Owner: r.account,
    };
    expect((await send(r.node, stranger, live)).code).toBe("tecNO_PERMISSION");
    r.node.advance(61);
    expect((await send(r.node, stranger, live)).code).toBe("tesSUCCESS");
    expect((await send(r.node, stranger, live)).code).toBe("tecNO_ENTRY");

    const b = await openSession(r, { Flags: TF_ALL_TRANSACTIONS });
    const byOwner = await send(r.node, r.master, {
      TransactionType: DEL,
      Account: r.account,
      SessionKey: b.key.address,
    });
    expect(byOwner.code).toBe("tesSUCCESS");
    expect((await r.node.accountInfo(r.account))?.ownerCount).toBe(0);

    const self = await send(r.node, r.master, {
      TransactionType: DEL,
      Account: r.account,
      SessionKey: r.account,
      Owner: r.account,
    });
    expect(self.code).toBe("temMALFORMED");
  });

  it("lets the key close a session whose cap is spent (own close is exempt)", async () => {
    const r = await rig();
    const { key } = await openSession(r, { SessionCap: "2000000" });
    const sink = accountIdOf("sink");
    expect((await send(r.node, key, pay(r.account, sink, 2_000_000 - 12))).code).toBe("tesSUCCESS");
    expect((await send(r.node, key, pay(r.account, sink, 1))).code).toBe("tefSESSION_LIMIT");
    const close = await send(r.node, key, {
      TransactionType: DEL,
      Account: r.account,
      SessionKey: key.address,
    });
    expect(close.code).toBe("tesSUCCESS");
  });
});

describe("ordinary authority and the passkey list", () => {
  it("refuses a second passkey list with tefEXCEPTION (spec 6.14, P6)", async () => {
    const r = await rig();
    const passkey = await r.wallet.createPasskey();
    const list = {
      TransactionType: "PasskeyListSet",
      Account: r.account,
      Passkeys: [passkey.publicKey],
    };
    expect((await send(r.node, r.master, list)).code).toBe("tesSUCCESS");
    const second = await send(r.node, r.master, list);
    expect(second.code).toBe("tefEXCEPTION");
    expect(second.feeClaimed).toBe(false);
  });

  it("lets a passkey sign, and refuses a session key equal to a passkey", async () => {
    const r = await rig();
    const passkey = await r.wallet.createPasskey();
    await send(r.node, r.master, {
      TransactionType: "PasskeyListSet",
      Account: r.account,
      Passkeys: [passkey.publicKey],
    });
    expect((await send(r.node, passkey, pay(r.account, accountIdOf("sink"), 2_000_000))).code).toBe(
      "tesSUCCESS",
    );
    const asSession = await send(r.node, passkey, {
      TransactionType: SET,
      Account: r.account,
      SessionKey: passkey.address,
      SessionDuration: 60,
      Flags: TF_ALL_TRANSACTIONS,
    });
    expect(asSession.code).toBe("tecNO_PERMISSION");
  });

  it("asfDisableMaster needs the master key and an alternative key", async () => {
    const r = await rig();
    const disable = {
      TransactionType: "AccountSet",
      Account: r.account,
      SetFlag: ASF_DISABLE_MASTER,
    };
    expect((await send(r.node, r.master, disable)).code).toBe("tecNO_ALTERNATIVE_KEY");
    const regular = await r.wallet.createSessionKey("mldsa44");
    await send(r.node, r.master, {
      TransactionType: "SetRegularKey",
      Account: r.account,
      RegularKey: regular.address,
    });
    expect((await send(r.node, regular, disable)).code).toBe("tecNEED_MASTER_KEY");
    expect((await send(r.node, r.master, disable)).code).toBe("tesSUCCESS");
    expect(
      (await send(r.node, r.master, pay(r.account, accountIdOf("sink"), 2_000_000))).code,
    ).toBe("tefMASTER_DISABLED");
    expect((await send(r.node, regular, pay(r.account, accountIdOf("sink"), 2_000_000))).code).toBe(
      "tesSUCCESS",
    );
  });

  it("refuses a tampered transaction with temBAD_SIGNATURE", async () => {
    const r = await rig();
    const signed = await r.master.sign({
      ...pay(r.account, accountIdOf("sink"), 2_000_000),
      Sequence: 1,
      LastLedgerSequence: 99999,
    });
    const tampered = { ...signed, Amount: "9000000" };
    expect((await r.node.submit(tampered)).code).toBe("temBAD_SIGNATURE");
  });

  it("accepts an ML-DSA-44 session key (case 20)", async () => {
    const r = await rig();
    const { key, result } = await openSession(r, { Flags: TF_ALL_TRANSACTIONS }, "mldsa44");
    expect(result.code).toBe("tesSUCCESS");
    expect(key.publicKey.length / 2).toBe(1312);
    expect((await send(r.node, key, pay(r.account, accountIdOf("sink"), 2_000_000))).code).toBe(
      "tesSUCCESS",
    );
  });
});
