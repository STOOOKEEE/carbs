#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/noop.h>
#include <test/jtx/offer.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>

#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STArray.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/tx/transactors/session/SigningSession.h>

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace xrpl {

/**
 * SigningSessions modes A (tfAllTransactions) and P (Permissions), FIANSO-SPEC
 * 6.3, 6.5 and 6.8: exactly one mode per session, eligibility per mode, and the
 * bounds every mode keeps (expiry, witness).
 */
class SigningSessionsModes_test : public beast::unit_test::Suite
{
    /** Flag bit SigningSessionSet does not define. */
    static constexpr std::uint32_t kUnknownFlag = 0x00020000;

    struct Rules
    {
        std::uint32_t duration = 600;
        std::optional<STAmount> cap;
        std::optional<STAmount> maxPerTx;
        std::optional<test::jtx::Account> witness;
        bool allTransactions = false;
        std::optional<std::vector<std::string>> permissions;
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
        if (rules.allTransactions)
            jv[jss::Flags] = tfAllTransactions;
        if (rules.permissions)
        {
            json::Value permissions(json::ValueType::Array);
            for (auto const& name : *rules.permissions)
            {
                json::Value value;
                value[sfPermissionValue.jsonName] = name;
                json::Value permission;
                permission[sfPermission.jsonName] = value;
                permissions.append(permission);
            }
            jv[sfPermissions.jsonName] = permissions;
        }
        return jv;
    }

    static std::shared_ptr<SLE const>
    session(
        test::jtx::Env& env,
        test::jtx::Account const& owner,
        test::jtx::Account const& sessionKey)
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
    testOpenModes(FeatureBitset features)
    {
        testcase("open a session in mode A and in mode P");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const sessA{"sessA"};
        Account const sessP{"sessP"};
        env.fund(XRP(1000), alice);
        env.memoize(sessA);
        env.memoize(sessP);
        env.close();

        auto const before = env.ownerCount(alice);
        env(open(alice, sessA, {.allTransactions = true}));
        env(open(
            alice,
            sessP,
            {.permissions = std::vector<std::string>{"Payment", "TrustlineAuthorize"}}));
        env.close();
        BEAST_EXPECT(env.ownerCount(alice) == before + 2);

        auto const sleA = session(env, alice, sessA);
        BEAST_EXPECT(
            sleA && sleA->isFlag(lsfAllTransactions) && !sleA->isFieldPresent(sfSessionCap) &&
            !sleA->isFieldPresent(sfSessionSpent) && !sleA->isFieldPresent(sfPermissions));

        auto const sleP = session(env, alice, sessP);
        BEAST_EXPECT(
            sleP && !sleP->isFlag(lsfAllTransactions) && !sleP->isFieldPresent(sfSessionCap) &&
            !sleP->isFieldPresent(sfSessionSpent) &&
            sleP->getFieldArray(sfPermissions).size() == 2);
    }

    void
    testModeValidation(FeatureBitset features)
    {
        testcase("exactly one mode, and valid Permissions");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice);
        env.memoize(sess);
        env.close();

        // No mode, then two or three modes at once.
        env(open(alice, sess, {}), Ter(temMALFORMED));
        env(open(alice, sess, {.cap = XRP(10), .allTransactions = true}), Ter(temMALFORMED));
        env(open(alice, sess, {.cap = XRP(10), .permissions = std::vector<std::string>{"Payment"}}),
            Ter(temMALFORMED));
        env(open(
                alice,
                sess,
                {.allTransactions = true, .permissions = std::vector<std::string>{"Payment"}}),
            Ter(temMALFORMED));
        env(open(
                alice,
                sess,
                {.cap = XRP(10),
                 .allTransactions = true,
                 .permissions = std::vector<std::string>{"Payment"}}),
            Ter(temMALFORMED));

        // A flag SigningSessionSet does not know.
        env(open(alice, sess, {.cap = XRP(10)}), Txflags(kUnknownFlag), Ter(temINVALID_FLAG));

        // Permissions: empty, too many, duplicated.
        env(open(alice, sess, {.permissions = std::vector<std::string>{}}), Ter(temARRAY_EMPTY));
        env(open(
                alice,
                sess,
                {.permissions =
                     std::vector<std::string>{
                         "Payment",
                         "OfferCreate",
                         "OfferCancel",
                         "EscrowCreate",
                         "EscrowFinish",
                         "EscrowCancel",
                         "PaymentChannelCreate",
                         "PaymentChannelFund",
                         "PaymentChannelClaim",
                         "CheckCreate",
                         "CheckCash",
                     }}),
            Ter(temARRAY_TOO_LARGE));
        env(open(alice, sess, {.permissions = std::vector<std::string>{"Payment", "Payment"}}),
            Ter(temMALFORMED));

        // Non-delegable, then excluded although delegable.
        env(open(alice, sess, {.permissions = std::vector<std::string>{"AccountSet"}}),
            Ter(temMALFORMED));
        env(open(alice, sess, {.permissions = std::vector<std::string>{"SetRegularKey"}}),
            Ter(temMALFORMED));
        env(open(alice, sess, {.permissions = std::vector<std::string>{"PasskeyListSet"}}),
            Ter(temMALFORMED));
        env(open(alice, sess, {.permissions = std::vector<std::string>{"SubscriptionSet"}}),
            Ter(temMALFORMED));
        env(open(alice, sess, {.permissions = std::vector<std::string>{"SponsorshipSet"}}),
            Ter(temMALFORMED));

        // SessionMaxPerTx belongs to mode C.
        env(open(alice, sess, {.maxPerTx = XRP(1), .allTransactions = true}), Ter(temMALFORMED));
        env(open(
                alice,
                sess,
                {.maxPerTx = XRP(1), .permissions = std::vector<std::string>{"Payment"}}),
            Ter(temMALFORMED));

        BEAST_EXPECT(!session(env, alice, sess));
    }

    void
    testModeAEligibility(FeatureBitset features)
    {
        testcase("mode A: delegable types pass, the others are refused");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const gw{"gw"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob, gw);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {.allTransactions = true}));
        env.close();

        env(pay(alice, bob, XRP(10)), Sig(sess), soon(env));
        env(offer(alice, gw["USD"](10), XRP(10)), Sig(sess), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1010));
        BEAST_EXPECT(!session(env, alice, sess)->isFieldPresent(sfSessionSpent));

        // AccountSet and SetRegularKey are not delegable.
        env(noop(alice), Sig(sess), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(regkey(alice, bob), Sig(sess), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));

        // The LastLedgerSequence window still applies.
        env(pay(alice, bob, XRP(1)), Sig(sess), Ter(tefSESSION_TX_NOT_ALLOWED));
    }

    void
    testModePEligibility(FeatureBitset features)
    {
        testcase("mode P: only the listed permissions");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const gw{"gw"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob, gw);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {.permissions = std::vector<std::string>{"Payment"}}));
        env.close();

        env(pay(alice, bob, XRP(10)), Sig(sess), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1010));

        env(offer(alice, gw["USD"](10), XRP(10)),
            Sig(sess),
            soon(env),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        env(noop(alice), Sig(sess), soon(env), Ter(tefSESSION_TX_NOT_ALLOWED));
    }

    void
    testExpiryInModes(FeatureBitset features)
    {
        testcase("expiry applies in modes A and P");
        using namespace test::jtx;
        using namespace std::chrono_literals;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const sessA{"sessA"};
        Account const sessP{"sessP"};
        env.fund(XRP(1000), alice, bob);
        env.memoize(sessA);
        env.memoize(sessP);
        env.close();
        env(open(alice, sessA, {.duration = 60, .allTransactions = true}));
        env(open(
            alice, sessP, {.duration = 60, .permissions = std::vector<std::string>{"Payment"}}));
        env.close();
        env.close(70s);

        env(pay(alice, bob, XRP(1)), Sig(sessA), soon(env), Ter(tefSESSION_EXPIRED));
        env(pay(alice, bob, XRP(1)), Sig(sessP), soon(env), Ter(tefSESSION_EXPIRED));
    }

    void
    testWitnessInModeA(FeatureBitset features)
    {
        testcase("mode A still requires the witness");
        using namespace test::jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const witness{"witness"};
        Account const sess{"sess"};
        env.fund(XRP(1000), alice, bob, witness);
        env.memoize(sess);
        env.close();
        env(open(alice, sess, {.witness = witness, .allTransactions = true}));
        env.close();

        env(pay(alice, bob, XRP(1)), Sig(sess), soon(env), Ter(tefSESSION_NO_WITNESS));
        env(pay(alice, bob, XRP(1)), Sig(sess), Sig(sfWitnessSignature, witness), soon(env));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1001));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();
        testOpenModes(all);
        testModeValidation(all);
        testModeAEligibility(all);
        testModePEligibility(all);
        testExpiryInModes(all);
        testWitnessInModeA(all);
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessionsModes, app, xrpl);

}  // namespace xrpl
