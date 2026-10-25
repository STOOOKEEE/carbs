#include <test/app/invariants/InvariantsBase.h>
#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/TestHelpers.h>
#include <test/jtx/amount.h>
#include <test/jtx/delegate.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/multisign.h>
#include <test/jtx/pay.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/txflags.h>
#include <test/jtx/webauthn.h>

#include <xrpl/basics/Slice.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STArray.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>

#include <memory>
#include <string>

namespace xrpl::test {

// Case 21 of the test plan (FIANSO-SPEC 6.15): each rule of the
// ValidSigningSession invariant (6.7) has a test that mutates the view to
// break it.
class InvariantsSigningSession_test : public InvariantsBase
{
    // The session key of A1 in every test.
    static jtx::Account const&
    key()
    {
        static jtx::Account const k{"sessionKey"};
        return k;
    }

    static Keylet
    sessionOf(jtx::Account const& a1)
    {
        return keylet::signingSession(a1.id(), key().id());
    }

    // Open a session for A1 in mode A, P or C before the checked transaction.
    static Preclose
    open(char mode)
    {
        return [mode](jtx::Account const& a1, jtx::Account const&, jtx::Env& env) {
            using namespace jtx;
            if (mode == 'A')
                env(session::set(a1, key(), 600), Txflags(tfAllTransactions));
            else if (mode == 'P')
                env(session::set(a1, key(), 600), session::Permissions({"Payment"}));
            else
                env(session::set(a1, key(), 600), session::Cap(XRP(100)));
            return true;
        };
    }

    // The own close of A1's session, signed by its session key.
    static STTx
    ownClose()
    {
        return STTx{ttSIGNING_SESSION_DELETE, [](STObject& tx) {
                        tx.setFieldVL(sfSigningPubKey, key().pk().slice());
                        tx.setAccountID(sfSessionKey, key().id());
                        tx.setFieldU32(sfLastLedgerSequence, 1000);
                    }};
    }

    // A Payment from A1 to A2 signed by A1's session key.
    static STTx
    sessionPayment()
    {
        jtx::Account const a2{"A2"};
        return STTx{ttPAYMENT, [&a2](STObject& tx) {
                        tx.setFieldVL(sfSigningPubKey, key().pk().slice());
                        tx.setAccountID(sfDestination, a2.id());
                        tx.setFieldAmount(sfAmount, jtx::XRP(1));
                        tx.setFieldU32(sfLastLedgerSequence, 1000);
                    }};
    }

    static SLE::pointer
    newSession(jtx::Account const& a1, std::uint32_t expiration)
    {
        auto sle = std::make_shared<SLE>(sessionOf(a1));
        (*sle)[sfAccount] = a1.id();
        (*sle)[sfSessionKey] = key().id();
        (*sle)[sfExpiration] = expiration;
        (*sle)[sfOwnerNode] = 0;
        return sle;
    }

    static std::uint32_t
    parentCloseTime(ApplyContext& ac)
    {
        return ac.view().parentCloseTime().time_since_epoch().count();
    }

    static bool
    bumpOwnerCount(jtx::Account const& a, ApplyContext& ac, int delta)
    {
        auto const sle = ac.view().peek(keylet::account(a.id()));
        if (!sle)
            return false;
        (*sle)[sfOwnerCount] = (*sle)[sfOwnerCount] + delta;
        ac.view().update(sle);
        return true;
    }

    // Rule 1: only SigningSessionSet creates, only SigningSessionDelete and
    // AccountDelete remove; the owner count moves by one.
    void
    testCreateAndDelete()
    {
        testcase("rule 1: who creates and deletes a session");
        using namespace jtx;

        doInvariantCheck(
            {{"a signing session was created by a transaction other than SigningSessionSet"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = newSession(a1, parentCloseTime(ac) + 60);
                sle->setFlag(lsfAllTransactions);
                ac.view().insert(sle);
                return bumpOwnerCount(a1, ac, 1);
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            {},
            TxAccount::A1);

        doInvariantCheck(
            {{"a signing session was created or deleted without its owner count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = newSession(a1, parentCloseTime(ac) + 60);
                sle->setFlag(lsfAllTransactions);
                ac.view().insert(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttSIGNING_SESSION_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            {},
            TxAccount::A1);

        doInvariantCheck(
            {{"a signing session was deleted by a transaction other than SigningSessionDelete or "
              "AccountDelete"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                ac.view().erase(sle);
                return bumpOwnerCount(a1, ac, -1);
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('A'),
            TxAccount::A1);

        doInvariantCheck(
            {{"a signing session was created or deleted without its owner count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                ac.view().erase(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttSIGNING_SESSION_DELETE, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('A'),
            TxAccount::A1);
    }

    // Rule 1 with a ticket: the creation adds one to the owner count and the
    // ticket removes one; a creation that forgot its owner count leaves the
    // count one lower.
    void
    testCreateByTicket()
    {
        testcase("rule 1: a creation by ticket");
        using namespace jtx;

        doInvariantCheck(
            {{"a signing session was created or deleted without its owner count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = newSession(a1, parentCloseTime(ac) + 60);
                sle->setFlag(lsfAllTransactions);
                ac.view().insert(sle);
                // The ticket is consumed, the session not counted.
                return bumpOwnerCount(a1, ac, -1);
            },
            XRPAmount{},
            STTx{ttSIGNING_SESSION_SET, [](STObject& tx) { tx.setFieldU32(sfTicketSequence, 5); }},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            {},
            TxAccount::A1);
    }

    // Rule 2: the fields of a session never change, there is exactly one
    // mode, and Expiration is within the maximum duration at creation.
    void
    testFields()
    {
        testcase("rule 2: the fields of a session");
        using namespace jtx;

        for (bool const expiration : {true, false})
        {
            doInvariantCheck(
                {{"a signing session changed a field that never changes"}},
                [expiration](Account const& a1, Account const& a2, ApplyContext& ac) {
                    auto const sle = ac.view().peek(sessionOf(a1));
                    if (!sle)
                        return false;
                    if (expiration)
                        (*sle)[sfExpiration] = (*sle)[sfExpiration] + 1;
                    else
                        (*sle)[sfSessionKey] = a2.id();
                    ac.view().update(sle);
                    return true;
                },
                XRPAmount{},
                STTx{ttACCOUNT_SET, [](STObject&) {}},
                {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
                open('A'),
                TxAccount::A1);
        }

        // Permissions, and Account.
        doInvariantCheck(
            {{"a signing session changed a field that never changes"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                STArray permissions(sfPermissions, 1);
                STObject permission = STObject::makeInnerObject(sfPermission);
                permission.setFieldU32(sfPermissionValue, ttTRUST_SET + 1);
                permissions.push_back(std::move(permission));
                sle->setFieldArray(sfPermissions, permissions);
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('P'),
            TxAccount::A1);

        doInvariantCheck(
            {{"a signing session changed a field that never changes"}},
            [](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                (*sle)[sfAccount] = a2.id();
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('A'),
            TxAccount::A1);

        // The mode flag and the cap.
        doInvariantCheck(
            {{"a signing session changed a field that never changes"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                (*sle)[sfSessionCap] = XRP(1000);
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        // SessionMaxPerTx and SessionWitness, added after the creation.
        for (bool const maxPerTx : {true, false})
        {
            doInvariantCheck(
                {{"a signing session changed a field that never changes"}},
                [maxPerTx](Account const& a1, Account const& a2, ApplyContext& ac) {
                    auto const sle = ac.view().peek(sessionOf(a1));
                    if (!sle)
                        return false;
                    if (maxPerTx)
                        (*sle)[sfSessionMaxPerTx] = XRP(1);
                    else
                        (*sle)[sfSessionWitness] = a2.id();
                    ac.view().update(sle);
                    return true;
                },
                XRPAmount{},
                STTx{ttACCOUNT_SET, [](STObject&) {}},
                {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
                open(maxPerTx ? 'C' : 'A'),
                TxAccount::A1);
        }

        doInvariantCheck(
            {{"a signing session changed a field that never changes"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                sle->clearFlag(lsfAllTransactions);
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('A'),
            TxAccount::A1);

        // Two modes, and none.
        for (bool const twoModes : {true, false})
        {
            doInvariantCheck(
                {{"a signing session does not have exactly one mode"}},
                [twoModes](Account const& a1, Account const&, ApplyContext& ac) {
                    auto sle = newSession(a1, parentCloseTime(ac) + 60);
                    if (twoModes)
                    {
                        sle->setFlag(lsfAllTransactions);
                        (*sle)[sfSessionCap] = XRP(1);
                        (*sle)[sfSessionSpent] = XRP(0);
                    }
                    ac.view().insert(sle);
                    return bumpOwnerCount(a1, ac, 1);
                },
                XRPAmount{},
                STTx{ttSIGNING_SESSION_SET, [](STObject&) {}},
                {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
                {},
                TxAccount::A1);
        }

        // A cap without its counter at zero.
        doInvariantCheck(
            {{"a signing session does not have exactly one mode"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = newSession(a1, parentCloseTime(ac) + 60);
                (*sle)[sfSessionCap] = XRP(1);
                (*sle)[sfSessionSpent] = XRP(1);
                ac.view().insert(sle);
                return bumpOwnerCount(a1, ac, 1);
            },
            XRPAmount{},
            STTx{ttSIGNING_SESSION_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            {},
            TxAccount::A1);

        doInvariantCheck(
            {{"a signing session expires beyond its maximum duration"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto sle = newSession(a1, parentCloseTime(ac) + kMaxSessionDuration + 1);
                sle->setFlag(lsfAllTransactions);
                ac.view().insert(sle);
                return bumpOwnerCount(a1, ac, 1);
            },
            XRPAmount{},
            STTx{ttSIGNING_SESSION_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            {},
            TxAccount::A1);
    }

    // Rule 3: SessionSpent only increases, never above the cap, and only in
    // a transaction its session signed.
    void
    testSpent()
    {
        testcase("rule 3: SessionSpent");
        using namespace jtx;

        auto setSpent = [](STAmount spent) {
            return [spent](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                (*sle)[sfSessionSpent] = spent;
                ac.view().update(sle);
                // The account pays what the counter says, so that only rule
                // 3 is broken.
                auto const account = ac.view().peek(keylet::account(a1.id()));
                (*account)[sfBalance] = (*account)[sfBalance] - spent;
                ac.view().update(account);
                return true;
            };
        };

        // Above the cap, in a transaction its session signed.
        doInvariantCheck(
            {{"a signing session spent more than its SessionCap"}},
            setSpent(XRP(100) + drops(1)),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        // In a transaction the session did not sign.
        doInvariantCheck(
            {{"a signing session's SessionSpent changed outside a transaction it signed"}},
            setSpent(XRP(1)),
            XRPAmount{},
            STTx{ttACCOUNT_SET, [](STObject&) {}},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        // Downwards: the counter of a session that has spent is lowered.
        doInvariantCheck(
            {{"a signing session's SessionSpent decreased"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                (*sle)[sfSessionSpent] = XRP(0);
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                open('C')(a1, a2, env);
                env.close();
                env(pay(a1, a2, XRP(1)), Sig(key()), LastLedgerSeq(env.current()->seq() + 10));
                return true;
            },
            TxAccount::A1);
    }

    // Rule 3: the own close is exempt from the count, so it never moves it.
    void
    testOwnCloseSpent()
    {
        testcase("rule 3: the own close does not count");
        using namespace jtx;

        doInvariantCheck(
            {{"a signing session's SessionSpent changed outside a transaction it signed"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                (*sle)[sfSessionSpent] = drops(10);
                ac.view().update(sle);
                return true;
            },
            XRPAmount{},
            ownClose(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);
    }

    // Rule 4: a mode-C session transaction takes no more XRP than its
    // session counts, and creates no reserve the cap does not see.
    void
    testOutflow()
    {
        testcase("rule 4: what a mode-C transaction takes");
        using namespace jtx;

        doInvariantCheck(
            {{"a mode-C session transaction took more XRP than its session counted"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!sle || !account)
                    return false;
                (*sle)[sfSessionSpent] = XRP(1);
                ac.view().update(sle);
                (*account)[sfBalance] = (*account)[sfBalance] - XRP(1) - drops(1);
                ac.view().update(account);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        doInvariantCheck(
            {{"a mode-C session transaction raised the owner count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                return bumpOwnerCount(a1, ac, 1);
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        doInvariantCheck(
            {{"a mode-C session transaction changed a sponsoring count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!account)
                    return false;
                (*account)[sfSponsoringOwnerCount] = 1;
                ac.view().update(account);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        doInvariantCheck(
            {{"a mode-C session transaction changed a sponsoring count"}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!account)
                    return false;
                (*account)[sfSponsoringAccountCount] = 1;
                ac.view().update(account);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);
    }

    // Rule 4: a mode-C session transaction other than the own close is a
    // session cap payment. Without a mutation: the shape alone fails.
    void
    testModeCShape()
    {
        testcase("rule 4: a mode-C transaction is a cap payment");
        using namespace jtx;

        auto const message = "a mode-C session transaction is not a session cap payment";
        auto const unchanged = [](Account const&, Account const&, ApplyContext&) { return true; };

        // An IOU payment, whose outflow SessionSpent cannot see.
        Account const a2{"A2"};
        doInvariantCheck(
            {{message}},
            unchanged,
            XRPAmount{},
            STTx{
                ttPAYMENT,
                [&a2](STObject& tx) {
                    tx.setFieldVL(sfSigningPubKey, key().pk().slice());
                    tx.setAccountID(sfDestination, a2.id());
                    tx.setFieldAmount(sfAmount, a2["USD"](1));
                    tx.setFieldU32(sfLastLedgerSequence, 1000);
                }},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);

        // Another type.
        doInvariantCheck(
            {{message}},
            unchanged,
            XRPAmount{},
            STTx{
                ttACCOUNT_SET,
                [](STObject& tx) {
                    tx.setFieldVL(sfSigningPubKey, key().pk().slice());
                    tx.setFieldU32(sfLastLedgerSequence, 1000);
                }},
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('C'),
            TxAccount::A1);
    }

    // Rule 4: a mode-C session transaction counts at most SessionMaxPerTx
    // beyond its fee; at the bound it passes.
    void
    testMaxPerTx()
    {
        testcase("rule 4: SessionMaxPerTx");
        using namespace jtx;

        XRPAmount const fee{10};
        XRPAmount const maxPerTx = XRP(1).value().xrp();
        // The account pays `amount` plus the fee, the counter counts both and
        // A2 receives the amount, so only the per-transaction bound can fail.
        auto const spend = [fee](XRPAmount amount) {
            return [amount, fee](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                auto const account = ac.view().peek(keylet::account(a1.id()));
                auto const destination = ac.view().peek(keylet::account(a2.id()));
                if (!sle || !account || !destination)
                    return false;
                (*sle)[sfSessionSpent] = STAmount{amount + fee};
                ac.view().update(sle);
                (*account)[sfBalance] = (*account)[sfBalance] - STAmount{amount + fee};
                ac.view().update(account);
                (*destination)[sfBalance] = (*destination)[sfBalance] + STAmount{amount};
                ac.view().update(destination);
                return true;
            };
        };
        auto const openWithMax = [maxPerTx](Account const& a1, Account const&, Env& env) {
            env(session::set(a1, key(), 600),
                session::Cap(XRP(100)),
                session::MaxPerTx(STAmount{maxPerTx}));
            return true;
        };
        // The payment declares the fee it pays.
        auto const payment = [fee] {
            auto tx = sessionPayment();
            tx.setFieldAmount(sfFee, STAmount{fee});
            return tx;
        };

        doInvariantCheck(
            {{"a mode-C session transaction counted more than its SessionMaxPerTx"}},
            spend(maxPerTx + XRPAmount{1}),
            fee,
            payment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            openWithMax,
            TxAccount::A1);

        doInvariantCheck(
            {},
            spend(maxPerTx),
            fee,
            payment(),
            {tesSUCCESS, tesSUCCESS},
            openWithMax,
            TxAccount::A1);
    }

    // Rule 5: a session-signed transaction creates none of the entries of the
    // excluded types (sponsorship, subscription, credential, DID).
    void
    testExcludedCreated()
    {
        testcase("rule 5: no entry of an excluded type");
        using namespace jtx;

        Account const a1{"A1"}, a2{"A2"};
        for (auto const& keylet :
             {keylet::sponsorship(a1.id(), a2.id()),
              keylet::subscription(a1.id(), a2.id(), 1),
              keylet::credential(a2.id(), a1.id(), makeSlice(std::string{"KYC"})),
              keylet::did(a1.id())})
        {
            doInvariantCheck(
                {{"a session-signed transaction created a sponsorship, subscription, credential "
                  "or DID"}},
                [keylet](Account const&, Account const&, ApplyContext& ac) {
                    ac.view().insert(std::make_shared<SLE>(keylet));
                    return true;
                },
                XRPAmount{},
                sessionPayment(),
                {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
                open('A'),
                TxAccount::A1);
        }
    }

    // Rule 5: a session-signed transaction never touches the authority of the
    // account, nor another of its sessions.
    void
    testAuthority()
    {
        testcase("rule 5: the authority of the account");
        using namespace jtx;

        auto const message = "a session-signed transaction changed the account's authority";

        doInvariantCheck(
            {{message}},
            [](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!account)
                    return false;
                (*account)[sfRegularKey] = a2.id();
                ac.view().update(account);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('A'),
            TxAccount::A1);

        doInvariantCheck(
            {{message}},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!account)
                    return false;
                account->setFlag(lsfDisableMaster);
                ac.view().update(account);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            open('P'),
            TxAccount::A1);

        // An entry of the account's authority, made beforehand by its owner,
        // touched by the session-signed transaction.
        auto touch = [](Keylet const& k) {
            return [k](Account const&, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(k);
                if (!sle)
                    return false;
                ac.view().update(sle);
                return true;
            };
        };
        Account const a1{"A1"}, a2{"A2"};

        doInvariantCheck(
            {{message}},
            touch(keylet::delegate(a1.id(), a2.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(delegate::set(a1, a2, {"Payment"}));
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);

        doInvariantCheck(
            {{message}},
            touch(keylet::signerList(a1.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(signers(a1, 1, {{a2, 1}}));
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);

        doInvariantCheck(
            {{message}},
            touch(keylet::beneficiary(a1.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                json::Value jv;
                jv[sfTransactionType] = jss::BeneficiarySet;
                jv[sfAccount] = a1.human();
                jv[sfBeneficiary] = a2.human();
                jv[sfTimeLock] = 3600;
                env(jv);
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);

        doInvariantCheck(
            {{message}},
            touch(keylet::firewall(a1.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                Account const backup{"backup"};
                env.fund(XRP(1000), backup);
                env(firewall::set(a1.id(), a2.id(), backup.id()));
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);

        doInvariantCheck(
            {{message}},
            touch(keylet::passkeyList(a1.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(passkeyListSet(a1, Account{"passkey", KeyType::P256}, "AA"));
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);

        // Another session of the account.
        doInvariantCheck(
            {{"a session-signed transaction changed another session of the account"}},
            touch(keylet::signingSession(a1.id(), a2.id())),
            XRPAmount{},
            sessionPayment(),
            {tecINVARIANT_FAILED, tefINVARIANT_FAILED},
            [](Account const& a1, Account const& a2, Env& env) {
                env(session::set(a1, a2, 600), Txflags(tfAllTransactions));
                return open('A')(a1, a2, env);
            },
            TxAccount::A1);
    }

    // The valid shape passes: a mode-C payment that counts what it takes.
    void
    testValid()
    {
        testcase("valid session transactions pass");
        using namespace jtx;

        doInvariantCheck(
            {},
            [](Account const& a1, Account const& a2, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                auto const account = ac.view().peek(keylet::account(a1.id()));
                if (!sle || !account)
                    return false;
                (*sle)[sfSessionSpent] = XRP(1);
                ac.view().update(sle);
                (*account)[sfBalance] = (*account)[sfBalance] - XRP(1);
                ac.view().update(account);
                auto const destination = ac.view().peek(keylet::account(a2.id()));
                if (!destination)
                    return false;
                (*destination)[sfBalance] = (*destination)[sfBalance] + XRP(1);
                ac.view().update(destination);
                return true;
            },
            XRPAmount{},
            sessionPayment(),
            {tesSUCCESS, tesSUCCESS},
            open('C'),
            TxAccount::A1);
    }

    // The own close of a mode-C session, which deletes it, passes.
    void
    testValidOwnClose()
    {
        testcase("a valid own close passes");
        using namespace jtx;

        doInvariantCheck(
            {},
            [](Account const& a1, Account const&, ApplyContext& ac) {
                auto const sle = ac.view().peek(sessionOf(a1));
                if (!sle)
                    return false;
                ac.view().erase(sle);
                return bumpOwnerCount(a1, ac, -1);
            },
            XRPAmount{},
            ownClose(),
            {tesSUCCESS, tesSUCCESS},
            open('C'),
            TxAccount::A1);
    }

public:
    void
    run() override
    {
        testCreateAndDelete();
        testCreateByTicket();
        testFields();
        testSpent();
        testOwnCloseSpent();
        testOutflow();
        testModeCShape();
        testMaxPerTx();
        testAuthority();
        testExcludedCreated();
        testValid();
        testValidOwnClose();
    }
};

BEAST_DEFINE_TESTSUITE(InvariantsSigningSession, app, xrpl);

}  // namespace xrpl::test
