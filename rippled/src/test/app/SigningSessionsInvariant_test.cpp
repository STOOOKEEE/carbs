#include <test/app/invariants/InvariantsBase.h>
#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/delegate.h>
#include <test/jtx/fee.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/multisign.h>
#include <test/jtx/pay.h>
#include <test/jtx/sig.h>

#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STArray.h>
#include <xrpl/protocol/jss.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace xrpl::test {

/**
 * ValidSigningSession (FIANSO-SPEC 6.7): each rule broken on a mutated view,
 * and a session payment that keeps them all.
 */
class SigningSessionsInvariant_test : public InvariantsBase
{
    /** Same flag as lsfAllTransactions (mode A), written out to stay independent of it. */
    static constexpr std::uint32_t kModeAFlag = 0x00010000;
    static constexpr std::uint32_t kSessionDuration = 600;
    static constexpr std::uint32_t kLedgerWindow = 10;

    static jtx::Account const&
    sessionKey()
    {
        static jtx::Account const key{"sess"};
        return key;
    }

    static jtx::Account const&
    otherSessionKey()
    {
        static jtx::Account const key{"sess2"};
        return key;
    }

    static Keylet
    sessionKeylet(jtx::Account const& owner, jtx::Account const& key = sessionKey())
    {
        return keylet::signingSession(owner.id(), key.id());
    }

    static json::Value
    open(jtx::Account const& owner, jtx::Account const& key)
    {
        json::Value jv;
        jv[jss::TransactionType] = "SigningSessionSet";
        jv[jss::Account] = owner.human();
        jv[sfSessionKey.jsonName] = key.human();
        jv[sfSessionDuration.jsonName] = kSessionDuration;
        jv[sfSessionCap.jsonName] = jtx::XRP(100).value().getJson(JsonOptions::Values::None);
        return jv;
    }

    // a1 opens a mode C session (cap 100 XRP) for sessionKey().
    static bool
    openSession(jtx::Account const& a1, jtx::Account const&, jtx::Env& env)
    {
        env(open(a1, sessionKey()));
        return true;
    }

    // As openSession, then the session pays 1 XRP so SessionSpent is above zero.
    static bool
    openAndSpend(jtx::Account const& a1, jtx::Account const& a2, jtx::Env& env)
    {
        openSession(a1, a2, env);
        env(jtx::pay(a1, a2, jtx::XRP(1)),
            jtx::Sig(sessionKey()),
            jtx::Fee(env.current()->fees().base),
            jtx::LastLedgerSeq(env.current()->seq() + kLedgerWindow));
        return true;
    }

    /** A transaction from A1 signed by sessionKey(), as the harness's A1 would send it. */
    static STTx
    sessionSigned(TxType type = ttPAYMENT)
    {
        return STTx{type, [](STObject& tx) {
                        tx.setAccountID(sfAccount, jtx::Account{"A1"}.id());
                        tx.setFieldVL(sfSigningPubKey, sessionKey().pk().slice());
                    }};
    }

    /** Applies a change to a1's session. */
    template <class Mutate>
    static auto
    mutateSession(Mutate mutate)
    {
        return [mutate](jtx::Account const& a1, jtx::Account const&, ApplyContext& ac) {
            auto sle = ac.view().peek(sessionKeylet(a1));
            if (!sle)
                return false;
            mutate(*sle);
            ac.view().update(sle);
            return true;
        };
    }

    void
    testCreateAndRemove()
    {
        testcase("rule 1: only the session transactions create and remove a session");
        using namespace jtx;

        doInvariantCheck(
            {{"a signing session was created by transaction type"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = std::make_shared<SLE>(sessionKeylet(a1));
                (*sle)[sfAccount] = a1.id();
                (*sle)[sfSessionKey] = sessionKey().id();
                (*sle)[sfExpiration] = kSessionDuration;
                (*sle)[sfSessionCap] = XRP(100).value();
                (*sle)[sfOwnerNode] = 0;
                ac.view().insert(sle);
                return true;
            });

        doInvariantCheck(
            {{"a signing session was removed by transaction type"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = ac.view().peek(sessionKeylet(a1));
                if (!sle)
                    return false;
                ac.view().erase(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);
    }

    void
    testFixedFields()
    {
        testcase("rule 2: what was granted never changes");
        using namespace jtx;

        auto check = [this](std::string const& field, auto mutate) {
            doInvariantCheck(
                {{"a signing session's " + field + " changed"}},
                mutateSession(mutate),
                XRPAmount{},
                STTx{ttSIGNING_SESSION_SET, [](STObject&) {}},
                {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
                openSession);
        };

        check("SessionKey", [](SLE& sle) { sle[sfSessionKey] = otherSessionKey().id(); });
        check("Expiration", [](SLE& sle) {
            sle.setFieldU32(sfExpiration, sle.getFieldU32(sfExpiration) + 1);
        });
        check("SessionCap", [](SLE& sle) { sle[sfSessionCap] = XRP(1000).value(); });
        check("SessionMaxPerTx", [](SLE& sle) { sle[sfSessionMaxPerTx] = XRP(1).value(); });
        check("SessionWitness", [](SLE& sle) { sle[sfSessionWitness] = otherSessionKey().id(); });
        check("Flags", [](SLE& sle) { sle.setFieldU32(sfFlags, kModeAFlag); });
    }

    void
    testSpent()
    {
        testcase("rule 3: SessionSpent only grows, within the cap, under its own session");
        using namespace jtx;

        doInvariantCheck(
            {{"a signing session's SessionSpent decreased"}},
            mutateSession([](SLE& sle) { sle[sfSessionSpent] = XRP(0).value(); }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openAndSpend);

        doInvariantCheck(
            {{"a signing session spent more than its cap"}},
            mutateSession([](SLE& sle) { sle[sfSessionSpent] = XRP(101).value(); }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);

        doInvariantCheck(
            {{"a signing session's SessionSpent changed outside a transaction it signed"}},
            mutateSession([](SLE& sle) { sle[sfSessionSpent] = XRP(1).value(); }),
            XRPAmount{},
            STTx{ttPAYMENT, [](STObject& tx) { tx.setAccountID(sfAccount, Account{"A1"}.id()); }},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);
    }

    void
    testAuthorityUntouched()
    {
        testcase("rule 4: a session-signed transaction leaves the account's authority alone");
        using namespace jtx;

        std::string const keys = "the account's RegularKey or master key flag";
        std::string const entries = "the account's signer list, passkey list or delegate entries";

        auto mutateRoot = [](auto mutate) {
            return [mutate](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto sle = ac.view().peek(keylet::account(a1.id()));
                if (!sle)
                    return false;
                mutate(*sle, a2);
                ac.view().update(sle);
                return true;
            };
        };

        // Touches an existing entry without changing it: being visited is enough.
        auto touch = [](auto keyletOf) {
            return [keyletOf](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto sle = ac.view().peek(keyletOf(a1, a2));
                if (!sle)
                    return false;
                ac.view().update(sle);
                return true;
            };
        };

        doInvariantCheck(
            {{keys}},
            mutateRoot([](SLE& sle, Account const& a2) { sle[sfRegularKey] = a2.id(); }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);

        doInvariantCheck(
            {{keys}},
            mutateRoot([](SLE& sle, Account const&) { sle.setFlag(lsfDisableMaster); }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);

        doInvariantCheck(
            {{entries}},
            touch([](Account const& a1, Account const&) { return keylet::signerList(a1.id()); }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(signers(a1, 1, {{a2, 1}}));
                return openSession(a1, a2, env);
            });

        doInvariantCheck(
            {{entries}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = std::make_shared<SLE>(keylet::passkeyList(a1.id()));
                (*sle)[sfOwner] = a1.id();
                (*sle)[sfOwnerNode] = 0;
                sle->setFieldArray(sfPasskeys, STArray{sfPasskeys});
                ac.view().insert(sle);
                return true;
            },
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openSession);

        doInvariantCheck(
            {{entries}},
            touch([](Account const& a1, Account const& a2) {
                return keylet::delegate(a1.id(), a2.id());
            }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(delegate::set(a1, a2, {"Payment"}));
                return openSession(a1, a2, env);
            });

        doInvariantCheck(
            {{"a session-signed transaction changed another signing session of its account"}},
            touch([](Account const& a1, Account const&) {
                return sessionKeylet(a1, otherSessionKey());
            }),
            XRPAmount{},
            sessionSigned(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(open(a1, otherSessionKey()));
                return openSession(a1, a2, env);
            });
    }

    void
    testSessionPaymentPasses()
    {
        testcase("control: a session payment charged within its cap");
        using namespace jtx;

        doInvariantCheck(
            std::vector<std::string>{},
            mutateSession([](SLE& sle) { sle[sfSessionSpent] = XRP(2).value(); }),
            XRPAmount{},
            sessionSigned(),
            {tesSUCCESS, tesSUCCESS},
            openAndSpend);
    }

public:
    void
    run() override
    {
        testCreateAndRemove();
        testFixedFields();
        testSpent();
        testAuthorityUntouched();
        testSessionPaymentPasses();
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessionsInvariant, app, xrpl);

}  // namespace xrpl::test
