#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/batch.h>
#include <test/jtx/flags.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/owners.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>

#include <xrpld/app/ledger/OpenLedger.h>
#include <xrpld/app/main/Application.h>

#include <xrpl/beast/unit_test.h>
#include <xrpl/json/json_value.h>
#include <xrpl/ledger/OpenView.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/tx/SigningSession.h>
#include <xrpl/tx/apply.h>

#include <cstdint>
#include <memory>

namespace xrpl::test {

// Signing sessions and XRPL Batch (BatchV1_1). An owner may open and revoke
// sessions inside a Batch; a session key never authorizes a Batch, neither as
// the outer signer nor as a BatchSigner, and a session-signed transaction
// cannot pose as a Batch inner transaction.
//
// A Batch answers tesSUCCESS as soon as the outer transaction is valid: its
// doApply does nothing, and the inner transactions are applied afterwards
// (applyBatchTransactions, rippled/src/libxrpl/tx/apply.cpp). Under
// tfAllOrNothing one inner result other than tesSUCCESS discards every inner
// change, while the outer keeps its tesSUCCESS, its fee and its sequence.
class SigningSessionsBatch_test : public beast::unit_test::Suite
{
    static std::shared_ptr<SLE const>
    sessionEntry(jtx::Env& env, jtx::Account const& account, jtx::Account const& sessionKey)
    {
        return env.le(keylet::signingSession(account.id(), sessionKey.id()));
    }

    // A mode-C SigningSessionSet as JSON: session::Cap works on a JTx, and a
    // Batch inner transaction is JSON.
    static json::Value
    capSessionSet(
        jtx::Account const& account,
        jtx::Account const& sessionKey,
        std::uint32_t duration,
        STAmount const& cap)
    {
        auto jv = jtx::session::set(account, sessionKey, duration);
        jv[sfSessionCap.jsonName] = cap.getJson(JsonOptions::Values::None);
        return jv;
    }

    // (a) The owner opens a mode-C session and pays in one all-or-nothing
    // Batch: both are applied.
    void
    testOpenAndPay(FeatureBitset features)
    {
        testcase("open a session and pay in one Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"};
        env.fund(XRP(10000), alice, bob);
        env.close();

        auto const aliceBalance = env.balance(alice);
        auto const bobBalance = env.balance(bob);
        auto const seq = env.seq(alice);
        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
            batch::Inner(capSessionSet(alice, key, 600, XRP(50)), seq + 1),
            batch::Inner(pay(alice, bob, XRP(1)), seq + 2));
        env.close();

        auto const sle = sessionEntry(env, alice, key);
        if (!BEAST_EXPECT(sle))
            return;
        BEAST_EXPECT((*sle)[sfSessionCap] == XRP(50));
        BEAST_EXPECT((*sle)[sfSessionSpent] == XRP(0));
        env.require(Owners(alice, 1));
        BEAST_EXPECT(env.seq(alice) == seq + 3);
        BEAST_EXPECT(env.balance(alice) == aliceBalance - batchFee - XRP(1));
        BEAST_EXPECT(env.balance(bob) == bobBalance + XRP(1));
    }

    // (b) The same Batch with a failing payment (a new account below the
    // reserve, tecNO_DST_INSUF_XRP): the outer succeeds, nothing inner is
    // applied, so no session is opened.
    void
    testOpenAndFailingPay(FeatureBitset features)
    {
        testcase("open a session with a failing payment in one Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, carol{"carol"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        auto const aliceBalance = env.balance(alice);
        auto const seq = env.seq(alice);
        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
            batch::Inner(capSessionSet(alice, key, 600, XRP(50)), seq + 1),
            batch::Inner(pay(alice, carol, XRP(1)), seq + 2));
        env.close();

        BEAST_EXPECT(!sessionEntry(env, alice, key));
        env.require(Owners(alice, 0));
        BEAST_EXPECT(!env.le(keylet::account(carol.id())));
        // Only the outer sequence and the outer fee are consumed.
        BEAST_EXPECT(env.seq(alice) == seq + 1);
        BEAST_EXPECT(env.balance(alice) == aliceBalance - batchFee);
    }

    // (c) The owner revokes three sessions, one per mode, in one Batch.
    void
    testRevokeThree(FeatureBitset features)
    {
        testcase("revoke three sessions in one Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const keyA{"keyA"}, keyC{"keyC"}, keyP{"keyP"};
        env.fund(XRP(10000), alice);
        env.close();

        env(session::set(alice, keyA, 600), Txflags(tfAllTransactions));
        env(session::set(alice, keyC, 600), session::Cap(XRP(50)));
        env(session::set(alice, keyP, 600), session::Permissions({"Payment"}));
        env.close();
        env.require(Owners(alice, 3));

        auto const seq = env.seq(alice);
        env(batch::outer(alice, seq, batch::calcBatchFee(env, 0, 3), tfAllOrNothing),
            batch::Inner(session::del(alice, keyA), seq + 1),
            batch::Inner(session::del(alice, keyC), seq + 2),
            batch::Inner(session::del(alice, keyP), seq + 3));
        env.close();

        BEAST_EXPECT(!sessionEntry(env, alice, keyA));
        BEAST_EXPECT(!sessionEntry(env, alice, keyC));
        BEAST_EXPECT(!sessionEntry(env, alice, keyP));
        env.require(Owners(alice, 0));
        BEAST_EXPECT(env.seq(alice) == seq + 4);
    }

    // (d) A session key signs the outer Batch for the owner. Batch overrides
    // checkSign, so invokeCheckSession refuses it before any mode rule, in
    // mode A as in mode C: tefSESSION_TX_NOT_ALLOWED, not the tefBAD_AUTH of
    // a key without a session.
    void
    testSessionSignsOuter(FeatureBitset features)
    {
        testcase("session key signs the outer Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"};
        Account const keyA{"keyA"}, keyC{"keyC"}, noSession{"noSession"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, keyA, 600), Txflags(tfAllTransactions));
        env(session::set(alice, keyC, 600), session::Cap(XRP(50)));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        auto const balance = env.balance(alice);
        auto const seq = env.seq(alice);
        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        auto const submit = [&](Account const& signer, TER expected) {
            env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
                batch::Inner(pay(alice, bob, XRP(1)), seq + 1),
                batch::Inner(pay(alice, bob, XRP(2)), seq + 2),
                Sig(signer),
                lls(),
                Ter(expected));
        };

        submit(keyA, tefSESSION_TX_NOT_ALLOWED);
        submit(keyC, tefSESSION_TX_NOT_ALLOWED);
        submit(noSession, tefBAD_AUTH);
        env.close();

        BEAST_EXPECT(env.seq(alice) == seq);
        BEAST_EXPECT(env.balance(alice) == balance);
    }

    // (e) A session key as the BatchSigner of its owner. Batch::checkBatchSign
    // runs the ordinary signature check for each BatchSigner, which never
    // consults sessions: tefBAD_AUTH, although the same key signs the same
    // payment on its own.
    void
    testSessionAsBatchSigner(FeatureBitset features)
    {
        testcase("session key as a BatchSigner");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, carol{"carol"}, key{"key"};
        env.fund(XRP(10000), alice, bob, carol);
        env.close();
        env(session::set(alice, key, 600), session::Cap(XRP(50)));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // On its own, the payment is within the session.
        env(pay(alice, carol, XRP(1)), Sig(key), lls());
        env.close();

        auto const aliceSeq = env.seq(alice);
        auto const bobSeq = env.seq(bob);
        auto const bobBalance = env.balance(bob);
        env(batch::outer(bob, bobSeq, batch::calcBatchFee(env, 1, 2), tfAllOrNothing),
            batch::Inner(pay(alice, carol, XRP(1)), aliceSeq),
            batch::Inner(pay(bob, carol, XRP(1)), bobSeq + 1),
            batch::Sig(Reg{alice, key}),
            lls(),
            Ter(tefBAD_AUTH));
        env.close();

        BEAST_EXPECT(env.seq(alice) == aliceSeq);
        BEAST_EXPECT(env.seq(bob) == bobSeq);
        BEAST_EXPECT(env.balance(bob) == bobBalance);
    }

    // (f) A session-signed transaction with tfInnerBatchTxn. It is not
    // session-signed by the predicate (spec 6.4), the submit RPC refuses it
    // (checkValidity marks every inner flag SigBad), and applied directly
    // preflight1 refuses it with temINVALID_INNER_BATCH (no parent Batch).
    void
    testInnerFlag(FeatureBitset features)
    {
        testcase("session-signed transaction with tfInnerBatchTxn");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        auto const balance = env.balance(alice);
        auto const seq = env.seq(alice);
        auto const jt = env.jt(pay(alice, bob, XRP(1)), Txflags(tfInnerBatchTxn), Sig(key), lls());
        if (!BEAST_EXPECT(jt.stx))
            return;
        BEAST_EXPECT(!isSessionSigned(*env.current(), *jt.stx));

        env.app().getOpenLedger().modify([&](OpenView& view, beast::Journal j) {
            auto const result = xrpl::apply(env.app(), view, *jt.stx, TapNone, j);
            BEAST_EXPECT(result.ter == temINVALID_INNER_BATCH);
            BEAST_EXPECT(!result.applied);
            return false;
        });

        env(pay(alice, bob, XRP(1)),
            Txflags(tfInnerBatchTxn),
            Sig(key),
            lls(),
            Ter(telENV_RPC_FAILED));
        env.close();

        BEAST_EXPECT(env.seq(alice) == seq);
        BEAST_EXPECT(env.balance(alice) == balance);
    }

    // The AlphaNet observation of the device track: a key migration in one
    // all-or-nothing Batch answers tesSUCCESS and applies nothing. An inner
    // transaction has an empty SigningPubKey, so AccountSet asfDisableMaster
    // fails its master-key check with tecNEED_MASTER_KEY, and all-or-nothing
    // discards the SetRegularKey before it. Another AccountSet flag applies.
    void
    testKeyMigration(FeatureBitset features)
    {
        testcase("key migration in one Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, newKey{"newKey"};
        env.fund(XRP(10000), alice);
        env.close();

        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        {
            auto const balance = env.balance(alice);
            auto const seq = env.seq(alice);
            env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
                batch::Inner(regkey(alice, newKey), seq + 1),
                batch::Inner(fset(alice, asfDisableMaster), seq + 2));
            env.close();

            auto const sle = env.le(keylet::account(alice.id()));
            if (!BEAST_EXPECT(sle))
                return;
            BEAST_EXPECT(!sle->isFieldPresent(sfRegularKey));
            BEAST_EXPECT(!sle->isFlag(lsfDisableMaster));
            BEAST_EXPECT(env.seq(alice) == seq + 1);
            BEAST_EXPECT(env.balance(alice) == balance - batchFee);
        }

        {
            auto const seq = env.seq(alice);
            env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
                batch::Inner(regkey(alice, newKey), seq + 1),
                batch::Inner(fset(alice, asfDefaultRipple), seq + 2));
            env.close();

            auto const sle = env.le(keylet::account(alice.id()));
            if (!BEAST_EXPECT(sle))
                return;
            BEAST_EXPECT((*sle)[~sfRegularKey] == newKey.id());
            BEAST_EXPECT(sle->isFlag(lsfDefaultRipple));
            BEAST_EXPECT(env.seq(alice) == seq + 3);
        }
    }

public:
    void
    run() override
    {
        using namespace jtx;
        auto const all = testableAmendments();
        testOpenAndPay(all);
        testOpenAndFailingPay(all);
        testRevokeThree(all);
        testSessionSignsOuter(all);
        testSessionAsBatchSigner(all);
        testInnerFlag(all);
        testKeyMigration(all);
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessionsBatch, app, xrpl);

}  // namespace xrpl::test
