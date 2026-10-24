# 0010. How sessions use tickets, which serve multisig coordination

**Status:** Proposed (2026-10-24). This is a design only: nothing is implemented, and none of the codes below is allocated until the owner adopts an option.

**Context.** Decision D15: tickets serve multisig coordination, that is, collecting signatures out of order without blocking the account sequence. A multi-signed transaction fixes its `Sequence` or its `TicketSequence` before the first signer signs.

- **On `Sequence`,** any other transaction of the account makes it fail with `tefPAST_SEQ` (`rippled/src/libxrpl/tx/Transactor.cpp:740-743`).
- **On a ticket,** it blocks nothing, and it fails only if the ticket is gone: `tefNO_TICKET` (`rippled/src/libxrpl/tx/Transactor.cpp:746-767`).
- **`TicketCreate`** makes 1 to 250 tickets at the next sequence numbers, each one an owner reserve, and is the only transaction that moves `Sequence` by more than one (`rippled/src/libxrpl/tx/transactors/system/TicketCreate.cpp:34-36`, `:51-62`, `:87-132`; `rippled/include/xrpl/tx/transactors/system/TicketCreate.h:21`, `:43`, `:51`).
- **A co-signer** signs with its master key, if the master is not disabled, or with its regular key, and with nothing else (`rippled/src/libxrpl/tx/Transactor.cpp:1264-1330`). The signers' weights must reach the quorum (`:1335-1340`). A Ledger account co-signs with its ML-DSA-44 regular key, on the device (D13).

Sessions meet this in three places of `FIANSO-SPEC.md`:

1. Session-signed transactions share the account sequence (§12). An open session therefore keeps invalidating a multi-signed transaction prepared on `Sequence`.
2. A session-signed transaction may carry any ticket of the account (case 13: "a mode-C payment using `TicketSequence` applies"). A session key, leaked or not, can therefore consume the ticket that an in-flight multi-signed transaction depends on.
3. A session key never co-signs (§6.4, ADR 0005, case 14). Every co-signature of a Ledger account therefore needs the device.

## Options

The options are alternatives. Their codes are listed for review only.

### Option 1: a ticket budget mode

A fourth exclusive mode, T. The session may sign `TicketCreate` only, and it creates at most `SessionTicketBudget` tickets in total. An app that coordinates signers can then keep tickets in stock without a device prompt, and the reserve the session can lock is bounded. Today a mode P session holding the `TicketCreate` permission can lock reserves up to the 250-ticket threshold.

- **New fields:**
  - `SessionTicketBudget`, UINT32 115, on `SigningSessionSet` and on the entry, from 1 to 250;
  - `SessionTicketsCreated`, UINT32 116, on the entry; it starts at 0 and only increases.
- **New flags:** none.
- **New result codes:** none.
  - Over the budget: `tefSESSION_LIMIT`.
  - Any other transaction type: `tefSESSION_TX_NOT_ALLOWED`.
  - A budget next to another mode: `temMALFORMED`.
  - A budget of 0 or above 250: `temINVALID_COUNT`, as in `TicketCreate`.
- **Invariant (§6.7):**
  - Rule 2 makes the budget immutable and counts four modes.
  - A new rule: `SessionTicketsCreated` only increases, never above the budget, and only through a session-signed `TicketCreate`, by that transaction's `TicketCount`. The owner count rises by the same number.
- **Tests:**
  - opening in mode T adds one owner reserve;
  - tickets up to the exact budget give `tesSUCCESS`, and one more gives `tefSESSION_LIMIT`;
  - any other type gives `tefSESSION_TX_NOT_ALLOWED`;
  - a budget with another mode gives `temMALFORMED`; budgets of 0 and 251 give `temINVALID_COUNT`;
  - a multi-signed transaction on a ticket that the session created, signed out of order while the session acts, gives `tesSUCCESS`;
  - one invariant test per new rule.
- **Device:** a new field (UINT32 115) and the lines "Allows: Tickets only" and "Ticket budget: N".
- **Cost:** a fourth mode on the screen, in the invariant and in the enumeration test. It does not stop a session from consuming tickets that a multi-signed transaction needs.

### Option 2: a session key co-signs as its account

A session opened with a new flag lets its key sign inside `Signers`, as the session's account, for multi-signed transactions of one named account. Mode P permissions and expiry bound what it may co-sign. A co-signature then needs no device prompt.

- **New fields:** `SessionSignerFor`, ACCOUNT 35, required with the flag.
- **New flags:** `tfSessionCoSign` = `0x00020000` on `SigningSessionSet`, mirrored as `lsfSessionCoSign` on the entry. Mode A and mode C sessions cannot carry it.
- **New result codes:** none. A refused co-signature keeps `tefBAD_SIGNATURE`, the code of every bad signer (`rippled/src/libxrpl/tx/Transactor.cpp:1240-1330`). If a distinct code were wanted, `tef` -169 is free.
- **Rule:** `checkMultiSign` gains a fourth signer rule. The key hashes to the `SessionKey` of a live session of the signer account that carries the flag, whose `SessionSignerFor` is the transaction's account, and whose permissions allow the transaction type.
- **Invariant:** no new state. The signer check itself now reads a session entry for each signer.
- **Tests:**
  - a co-signature with the flag reaches the quorum;
  - without the flag, after expiry, for another account, or for a type the session does not permit: `tefBAD_SIGNATURE`;
  - the session key signing alone still follows §6.4.
- **Device:** a new field (ACCOUNT 35), the flag, and the line "May co-sign for rTreasury…".
- **Cost:**
  - It reverses ADR 0005 and case 14.
  - It changes the signer rules that every multi-signed transaction runs.
  - The independence of the signers, which is the point of a quorum, becomes the independence of their session keys in a web page.
  - On a Ledger account, an approval with the account's authority would no longer be made on the device, against D13.

### Option 3: tickets bound at opening

`SigningSessionSet` names a range of tickets that the account already holds. A session-signed transaction must use one of them: never `Sequence`, and never another ticket. A session without a range may use `Sequence` only, never a ticket. Session activity then leaves the account sequence, and every ticket outside the range, to multi-signed transactions.

- **New fields:**
  - `SessionFirstTicket`, UINT32 115, new;
  - `TicketCount`, UINT32 40, reused (`rippled/include/xrpl/protocol/detail/sfields.macro:97`).

  Both go on `SigningSessionSet` and on the entry, both or neither, with `1 ≤ TicketCount ≤ 250`.

- **New flags:** none.
- **New result codes:** none.
  - A ticket outside the range, `Sequence` when a range is set, or a ticket when none is: `tefSESSION_TX_NOT_ALLOWED`.
  - A ticket of the range already used: the existing `tefNO_TICKET` (`rippled/src/libxrpl/tx/Transactor.cpp:761-766`).
  - One field without the other: `temMALFORMED`.
  - A count of 0 or above 250: `temINVALID_COUNT`.
- **Rule:** the session creates no ticket. `TicketCreate` therefore stays the only transaction that moves `Sequence` by more than one (`rippled/src/libxrpl/tx/transactors/system/TicketCreate.cpp:130-132`), and `SigningSessionSet` stays O(1). The tickets of the range stay ordinary tickets: a key with full authority may still use them, and deleting the session leaves them in place.
- **Invariant (§6.7):**
  - Rule 2 makes both fields immutable.
  - A new rule: a session-signed transaction that deletes a ticket deletes one of its own range, and one that consumes `Sequence` belongs to a session without a range.
  - Rule 4 is unchanged: consuming a ticket may lower the owner count by one.
- **Tests:**
  - opening with a range of three existing tickets gives `tesSUCCESS`;
  - three session transactions on those tickets, submitted in reverse order, each give `tesSUCCESS`;
  - a session transaction on `Sequence`, or on a ticket outside the range: `tefSESSION_TX_NOT_ALLOWED`;
  - a used ticket of the range: `tefNO_TICKET`;
  - a multi-signed transaction on `Sequence`, signed out of order while the session acts: `tesSUCCESS`;
  - a session without a range using a ticket: `tefSESSION_TX_NOT_ALLOWED` (case 13 changes);
  - one field alone: `temMALFORMED`; counts of 0 and 251: `temINVALID_COUNT`.
- **Device:** the app already parses and names `TicketCount` (`ledger-app/src/xrp/fields.h:79`, `ledger-app/src/xrp/fields.c:100`). It needs one new field (UINT32 115) and a line "Tickets: 3 from #N".
- **Cost:**
  - One new field.
  - A client must hold tickets before it opens such a session: one `TicketCreate`, signed on the device for a Ledger account.
  - How the transaction queue orders ticketed session transactions is **UNVERIFIED** and needs a TxQ test (case 22).

## Free codes

Checked at 20:59 UTC on 2026-10-24. The public AlphaNet returns the `hash` of spike K5, `34614C84ACCFD2AB3BB9C0813F69F963DE7A587609BAD2FEAB562DA45D69C3C5`.

```sh
curl -s -X POST https://rpc.alphanet.xrpl.org -H 'Content-Type: application/json' \
  -d '{"method":"server_definitions","params":[{}]}' > alphanet_defs.json
python3 - alphanet_defs.json <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))["result"]
used = {(f["type"], f["nth"]): n for n, f in d["FIELDS"]}
for t, n in [("UInt32", 115), ("UInt32", 116), ("AccountID", 35), ("UInt32", 40)]:
    print(t, n, used.get((t, n), "free"))
codes = {v: k for k, v in d["TRANSACTION_RESULTS"].items()}
print("result -169", codes.get(-169, "free"))
print("SigningSessionSet flags defined:", "SigningSessionSet" in d["TRANSACTION_FLAGS"])
print("SigningSession entry flags defined:", "SigningSession" in d["LEDGER_ENTRY_FLAGS"])
names = {n for n, _ in d["FIELDS"]}
for c in ("SessionTicketBudget", "SessionTicketsCreated", "SessionFirstTicket", "SessionSignerFor"):
    print(c, "taken" if c in names else "free")
PY
```

```text
UInt32 115 free
UInt32 116 free
AccountID 35 free
UInt32 40 TicketCount
result -169 free
SigningSessionSet flags defined: False
SigningSession entry flags defined: False
SessionTicketBudget free
SessionTicketsCreated free
SessionFirstTicket free
SessionSignerFor free
```

Run in the imported tree, with no output from the first two commands (both free):

```sh
D=rippled/include/xrpl/protocol/detail
grep -nE "TYPED_SFIELD\(sf[A-Za-z0-9]+, *(UINT32, *11[4-7]|ACCOUNT, *3[45])\b" $D/sfields.macro
grep -rnE "SessionTicketBudget|SessionTicketsCreated|SessionFirstTicket|SessionSignerFor|tfSessionCoSign|lsfSessionCoSign" rippled/include rippled/src
grep -n "tefFIREWALL_BLOCK" rippled/include/xrpl/protocol/TER.h
```

- **Fields.** The highest serialized UINT32 is 113, `sfNextClaimTime` (`rippled/include/xrpl/protocol/detail/sfields.macro:576`), and the highest ACCOUNT is 33, `sfBeneficiary` (`:560`). UINT32 114 and ACCOUNT 34 belong to §6.1, so 115, 116 and ACCOUNT 35 are the next free codes.
- **Result codes.** `tefFIREWALL_BLOCK` is the last `tef` code (`rippled/include/xrpl/protocol/TER.h:187`). The three `tefSESSION_*` codes of §6.1 take -172 to -170, so -169 would be next.
- **Flags.** Transaction flags are per type. Only `tfFullyCanonicalSig` and `tfInnerBatchTxn` are universal (`rippled/include/xrpl/protocol/TxFlags.h:43-45`; the AlphaNet's `universal` list agrees), so `0x00020000` is free on `SigningSessionSet`, next to `tfAllTransactions` `0x00010000`.

For the device-track owner: options 1 and 3 add the UINT32 field 115, option 1 also adds 116 (entry only), and option 2 adds ACCOUNT 35 and the flag `0x00020000`. None of them renumbers anything in `ledger-app/src/xrp/signing_session.h`.

## Recommendation

**Option 3**, together with its rule for sessions without a range: a session-signed transaction never carries a ticket outside its own range, and never any ticket when it has no range.

- **Why option 3.**
  - It is the only option that keeps both the account sequence and the other tickets free for multi-signed transactions, which is the purpose D15 gives tickets.
  - It leaves the signer rules and the sequence rules of the ledger untouched.
  - It adds one field and reuses one the device already shows.
- **The rule needs no new code.** It can land alone in N4 if the owner wants protection before deciding on the range. It changes the ticket clause of case 13 and is compatible with adding the range later.
- **Option 1** helps to keep tickets in stock but does not protect them.
- **Option 2** is rejected: it weakens what a quorum means, and it moves approvals made with a Ledger account's authority off the device.

**If adopted.**

- If the range is adopted before N2, N2's macro batch adds `SessionFirstTicket` (UINT32 115) and adds `TicketCount` to the formats of `SigningSessionSet` and of the `SigningSession` entry.
- Sections 6.1, 6.2, 6.3, 6.5, 6.7, 6.13 and case 13 of 6.15 change.
- The device-track owner adds field 115 to `ledger-app/src/xrp/signing_session.h`.
- Adopting the rule alone changes no code number.
