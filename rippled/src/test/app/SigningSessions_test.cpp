#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/acctdelete.h>
#include <test/jtx/amount.h>
#include <test/jtx/fee.h>
#include <test/jtx/flags.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/noop.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>

#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/tx/transactors/session/SigningSession.h>

#include <chrono>
#include <optional>

namespace xrpl {

/**
 * SigningSessions (FIANSO-SPEC 6): mode C sessions, with the carbs protections
 * (cap per transaction, optional witness).
 */
class SigningSessions_test : public beast::unit_test::Suite
{
    struct Rules
    {
        std::uint32_t duration = 600;
        std::optional<STAmount> cap = test::jtx::XRP(100);
        std::optional<STAmount> maxPerTx;
        std::optional<test::jtx::Account> witness;
    };

    static json::Value
    open(test::jtx::Account const& owner, test::jtx::Account const& sessionKey, Rules const& rules)
    {
        json::Value jv;
        jv[jss::TransactionType] = "SigningSessionSet";
        jv[jss::Account] = owner.human();
        jv[sfSessionKey.jsonName] = sessionKey.human();
        jv[sfSessionDuration.jsonName] = rules.duration;
        if (rules.cap)
            jv[sfSessionCap.jsonName] = rules.cap->getJson(JsonOptions::Values::None);
        if (rules.maxPerTx)
            jv[sfSessionMaxPerTx.jsonName] = rules.maxPerTx->getJson(JsonOptions::Values::None);
        if (rules.witness)
            jv[sfSessionWitness.jsonName] = rules.witness->human();
        return jv;
    }

    static json::Value
    close(test::jtx::Account const& account, test::jtx::Account const& sessionKey, std::optional<test::jtx::Account> owner = {})
    {
        json::Value jv;
        jv[jss::TransactionType] = "SigningSessionDelete";
        jv[jss::Account] = account.human();
        jv[sfSessionKey.jsonName] = sessionKey.human();
        if (owner)
            jv[sfOwner.jsonName] = owner->human();
        return jv;
    }

    static std::shared_ptr<SLE const>
    session(test::jtx::Env& env, test::jtx::Account const& owner, test::jtx::Account const& sessionKey)
    {
        return env.le(keylet::signingSession(owner.id(), sessionKey.id()));
    }

    /** A LastLedgerSequence close enough for a session transaction. */
    static test::jtx::LastLedgerSeq
    soon(test::jtx::Env& env)
    {
        return test::jtx::LastLedgerSeq(env.current()->seq() + 10);
    }

    void
    testOpenAndValidation(FeatureBitset features)
    {
        testcase("open a session, and what SigningSessionSet refuses");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice);
        env.memoize(sess);
        env.close();

        env(open(alice, alice, {}), Ter(temMALFORMED));
        env(open(alice, sess, {.duration = 0}), Ter(temBAD_EXPIRATION));
        env(open(alice, sess, {.duration = kMaxSessionDuration + 1}), Ter(temBAD_EXPIRATION));
        env(open(alice, sess, {.cap = std::nullopt}), Ter(temMALFORMED));
        env(open(alice, sess, {.cap = XRP(-1)}), Ter(temBAD_AMOUNT));
        env(open(alice, sess, {.cap = alice["USD"](10)}), Ter(temBAD_AMOUNT));
        env(open(alice, sess, {.cap = XRP(10), .maxPerTx = XRP(11)}), Ter(temBAD_AMOUNT));
        env(open(alice, sess, {.witness = alice}), Ter(temMALFORMED));

        auto const before = env.ownerCount(alice);
        env(open(alice, sess, {}));
        env.close();
        auto const sle = session(env, alice, sess);
        BEAST_EXPECT(sle && (*sle)[sfSessionSpent] == XRP(0) && (*sle)[sfSessionCap] == XRP(100));
        BEAST_EXPECT(env.ownerCount(alice) == before + 1);

        env(open(alice, sess, {}), Ter(tecDUPLICATE));

        // A key with full authority already cannot be bounded by a session.
        Account const regular{"regular"};
        env.memoize(regular);
        env(regkey(alice, regular));
        env.close();
        env(open(alice, regular, {}), Ter(tecNO_PERMISSION));
    }

    void
    testDisabled(FeatureBitset features)
    {
        testcase("amendment disabled");
        using namespace test::jtx;

        Env env{*this, features - featureSigningSessions};
        Account const alice{"alice"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice);
        env.close();
        env(open(alice, sess, {}), Ter(temDISABLED));
    }

    void
    testSessionPayments(FeatureBitset features)
    {
        testcase("session payments: caps, eligibility and accounting");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {.cap = XRP(30), .maxPerTx = XRP(15)}));
        env.close();

        auto const fee = env.current()->fees().base;

        // A payment signed by the session key, within the bounds.
        env(pay(alice, bob, XRP(10)), Sig(sess), Fee(fee), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1010));
        BEAST_EXPECT((*session(env, alice, sess))[sfSessionSpent] == XRP(10) + fee);

        // Over the per-transaction cap, then over what is left of the session.
        env(pay(alice, bob, XRP(16)), Sig(sess), Fee(fee), soon(env), Ter(tefSESSION_LIMIT));
        env(pay(alice, bob, XRP(15)), Sig(sess), Fee(fee), soon(env));
        env.close();
        env(pay(alice, bob, XRP(5)), Sig(sess), Fee(fee), soon(env), Ter(tefSESSION_LIMIT));

        // Not a plain XRP payment, or no LastLedgerSequence: refused, no fee.
        env(noop(alice), Sig(sess), Fee(fee), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(regkey(alice, sess), Sig(sess), Fee(fee), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(pay(alice, bob, XRP(1)), Sig(sess), Fee(fee), Ter(tefSESSION_TX_NOT_ALLOWED));
        // A token payment: mode C only bounds XRP.
        env(pay(alice, bob, alice["USD"](1)), Sig(sess), Fee(fee), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));

        // A fee far above what is required is refused.
        env(pay(alice, bob, drops(1)), Sig(sess), Fee(fee * (kSessionFeeMultiple + 10)), soon(env), Ter(tefSESSION_LIMIT));
    }

    void
    testFailedPaymentChargesFee(FeatureBitset features)
    {
        testcase("a tec claims only the fee from the session");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const nobody{"nobody"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice);
        env.memoize(sess);
        env.memoize(nobody);
        env.close();
        env(open(alice, sess, {}));
        env.close();

        auto const fee = env.current()->fees().base;
        // Below the reserve, to an account that does not exist.
        env(pay(alice, nobody, drops(1)), Sig(sess), Fee(fee), soon(env), Ter(tecNO_DST_INSUF_XRP));
        env.close();
        BEAST_EXPECT((*session(env, alice, sess))[sfSessionSpent] == STAmount{fee});
    }

    void
    testExpiry(FeatureBitset features)
    {
        testcase("expiry, own close and cleanup by a third party");
        using namespace test::jtx;
        using namespace std::chrono_literals;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const carol{"carol"};
        Account const sess{"sess"};
        Account const sess2{"sess2"};
        env.fund(XRP(1000), alice, bob, carol);
        env.memoize(sess);
        env.memoize(sess2);
        env.close();
        env(open(alice, sess, {.duration = 60}));
        env(open(alice, sess2, {}));
        env.close();

        // Before expiry, a third party may not clean up.
        env(close(carol, sess, alice), Ter(tecNO_PERMISSION));
        env.close(70s);
        env(pay(alice, bob, XRP(1)), Sig(sess), soon(env), Ter(tefSESSION_EXPIRED));
        env(close(carol, sess, alice));
        env.close();
        BEAST_EXPECT(!session(env, alice, sess));

        // The session key closes its own session.
        env(close(alice, sess2), Sig(sess2), soon(env));
        env.close();
        BEAST_EXPECT(!session(env, alice, sess2));
        env(pay(alice, bob, XRP(1)), Sig(sess2), soon(env), Ter(tefBAD_AUTH));
    }

    void
    testWitness(FeatureBitset features)
    {
        testcase("witness co-signature");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const witness{"witness"};
        Account const mallory{"mallory"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob, witness, mallory);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {.witness = witness}));
        env.close();

        env(pay(alice, bob, XRP(1)), Sig(sess), soon(env), Ter(tefSESSION_NO_WITNESS));
        env(pay(alice, bob, XRP(1)), Sig(sess), Sig(sfWitnessSignature, mallory), soon(env), Ter(tefSESSION_NO_WITNESS));
        env(pay(alice, bob, XRP(1)), Sig(sess), Sig(sfWitnessSignature, witness), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1001));

        // The witness's regular key may co-sign too.
        Account const witnessRegular{"witnessRegular"};
        env.memoize(witnessRegular);
        env(regkey(witness, witnessRegular));
        env.close();
        env(pay(alice, bob, XRP(1)), Sig(sess), Sig(sfWitnessSignature, witnessRegular), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1002));
    }

    void
    testAccountDelete(FeatureBitset features)
    {
        testcase("AccountDelete removes sessions");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {}));
        env.close();
        incLgrSeqForAccDel(env, alice);
        env(acctdelete(alice, bob), Fee(env.current()->fees().increment));
        env.close();
        BEAST_EXPECT(!session(env, alice, sess));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();
        testOpenAndValidation(all);
        testDisabled(all);
        testSessionPayments(all);
        testFailedPaymentChargesFee(all);
        testExpiry(all);
        testWitness(all);
        testAccountDelete(all);
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessions, app, xrpl);

}  // namespace xrpl
