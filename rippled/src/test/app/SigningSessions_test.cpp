#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/TestHelpers.h>
#include <test/jtx/acctdelete.h>
#include <test/jtx/amount.h>
#include <test/jtx/fee.h>
#include <test/jtx/owners.h>
#include <test/jtx/pay.h>
#include <test/jtx/session.h>
#include <test/jtx/sponsor.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>

#include <xrpl/basics/strHex.h>
#include <xrpl/beast/unit_test.h>
#include <xrpl/json/to_string.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Firewall.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/Permissions.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>

#include <algorithm>
#include <cstdint>

namespace xrpl::test {

// The cases are numbered as in the test plan of FIANSO-SPEC.md, section 6.15.
// jtx rather than gtest: every case goes through the submit RPC, preflight,
// preclaim and Transactor::operator(), which need an Application.
class SigningSessions_test : public beast::unit_test::Suite
{
    static std::uint32_t
    parentCloseTime(jtx::Env& env)
    {
        return env.current()->parentCloseTime().time_since_epoch().count();
    }

    static std::shared_ptr<SLE const>
    sessionEntry(jtx::Env& env, jtx::Account const& account, jtx::Account const& sessionKey)
    {
        return env.le(keylet::signingSession(account.id(), sessionKey.id()));
    }

    static bool
    inOwnerDirectory(jtx::Env& env, jtx::Account const& account, uint256 const& key)
    {
        auto const dir = env.le(keylet::ownerDir(account.id()));
        if (!dir)
            return false;
        auto const& indexes = dir->getFieldV256(sfIndexes);
        return std::find(indexes.begin(), indexes.end(), key) != indexes.end();
    }

    // Case 7: the amendment, and the XLS-75 amendment it builds on, gate both
    // transactions.
    void
    testEnabled(FeatureBitset features)
    {
        testcase("amendment disabled");
        using namespace jtx;

        for (auto const& disabled : {featureSigningSessions, featurePermissionDelegationV1_1})
        {
            Env env{*this, features - disabled};
            Account const alice{"alice"}, key{"key"};
            env.fund(XRP(10000), alice);
            env.close();

            env(session::set(alice, key, 60), Txflags(tfAllTransactions), Ter(temDISABLED));
            env(session::del(alice, key), Ter(temDISABLED));
            env.close();
            BEAST_EXPECT(!sessionEntry(env, alice, key));
            env.require(Owners(alice, 0));
        }
    }

    // Case 1: each mode opens, takes one owner reserve, sits in the owner
    // directory, and expires SessionDuration seconds after the parent close.
    void
    testOpen(FeatureBitset features)
    {
        testcase("open in each mode");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"};
        Account const keyA{"keyA"}, keyC{"keyC"}, keyP{"keyP"};
        env.fund(XRP(10000), alice);
        env.close();

        auto const fee = env.current()->fees().base;

        // Mode A
        {
            auto const balance = env.balance(alice);
            auto const expiration = parentCloseTime(env) + 600;
            env(session::set(alice, keyA, 600), Txflags(tfAllTransactions));
            env.require(Owners(alice, 1));
            BEAST_EXPECT(env.balance(alice) == balance - fee);

            auto const sle = sessionEntry(env, alice, keyA);
            if (!BEAST_EXPECT(sle))
                return;
            BEAST_EXPECT((*sle)[sfAccount] == alice.id());
            BEAST_EXPECT((*sle)[sfSessionKey] == keyA.id());
            BEAST_EXPECT((*sle)[sfExpiration] == expiration);
            BEAST_EXPECT(sle->isFlag(lsfAllTransactions));
            BEAST_EXPECT(!sle->isFieldPresent(sfPermissions));
            BEAST_EXPECT(!sle->isFieldPresent(sfSessionCap));
            BEAST_EXPECT(!sle->isFieldPresent(sfSessionSpent));
            BEAST_EXPECT(inOwnerDirectory(env, alice, sle->key()));
        }

        // Mode C
        {
            auto const expiration = parentCloseTime(env) + 1;
            env(session::set(alice, keyC, 1), session::Cap(XRP(50)));
            env.require(Owners(alice, 2));

            auto const sle = sessionEntry(env, alice, keyC);
            if (!BEAST_EXPECT(sle))
                return;
            BEAST_EXPECT((*sle)[sfExpiration] == expiration);
            BEAST_EXPECT((*sle)[sfSessionCap] == XRP(50));
            BEAST_EXPECT((*sle)[sfSessionSpent] == XRP(0));
            BEAST_EXPECT(!sle->isFlag(lsfAllTransactions));
            BEAST_EXPECT(!sle->isFieldPresent(sfPermissions));
            BEAST_EXPECT(inOwnerDirectory(env, alice, sle->key()));
        }

        // Mode P
        {
            env(session::set(alice, keyP, 120), session::Permissions({"Payment", "TrustSet"}));
            env.require(Owners(alice, 3));

            auto const sle = sessionEntry(env, alice, keyP);
            if (!BEAST_EXPECT(sle))
                return;
            auto const& permissions = sle->getFieldArray(sfPermissions);
            BEAST_EXPECT(permissions.size() == 2);
            BEAST_EXPECT(permissions[0][sfPermissionValue] == ttPAYMENT + 1);
            BEAST_EXPECT(permissions[1][sfPermissionValue] == ttTRUST_SET + 1);
            BEAST_EXPECT(!sle->isFlag(lsfAllTransactions));
            BEAST_EXPECT(!sle->isFieldPresent(sfSessionCap));
            BEAST_EXPECT(inOwnerDirectory(env, alice, sle->key()));
        }

        // The entry is keyed by (account, session key), so one key may hold a
        // session for two accounts.
        {
            Account const bob{"bob"};
            env.fund(XRP(10000), bob);
            env(session::set(bob, keyA, 60), Txflags(tfAllTransactions));
            BEAST_EXPECT(sessionEntry(env, bob, keyA));
            BEAST_EXPECT(
                keylet::signingSession(alice.id(), keyA.id()).key !=
                keylet::signingSession(bob.id(), keyA.id()).key);
        }
    }

    void
    testFlags(FeatureBitset features)
    {
        testcase("flags");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        // tfAllTransactions is the only flag of SigningSessionSet, and
        // SigningSessionDelete has none.
        env(session::set(alice, key, 60),
            Txflags(tfAllTransactions | 0x00020000),
            Ter(temINVALID_FLAG));
        env(session::set(alice, key, 60), Txflags(tfAllTransactions));
        env(session::del(alice, key), Txflags(tfAllTransactions), Ter(temINVALID_FLAG));
        BEAST_EXPECT(sessionEntry(env, alice, key));
    }

    void
    testReserve(FeatureBitset features)
    {
        testcase("reserve");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        auto const fee = env.current()->fees().base;
        auto const reserve = env.current()->fees().reserve;
        auto const increment = env.current()->fees().increment;

        // Enough for the account reserve and two fees, not for one more object.
        env.fund(reserve + fee * 2, alice);
        env.close();

        env(session::set(alice, key, 60), Txflags(tfAllTransactions), Ter(tecINSUFFICIENT_RESERVE));
        env.close();
        env.require(Owners(alice, 0));
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        BEAST_EXPECT(env.balance(alice) == reserve + fee);

        // Exactly the reserve of one more object, before the fee.
        env(pay(env.master, alice, drops(increment)));
        env.close();
        env(session::set(alice, key, 60), Txflags(tfAllTransactions));
        env.close();
        env.require(Owners(alice, 1));
        BEAST_EXPECT(env.balance(alice) == reserve + increment);
    }

    // Case 18, the closes that do not need the session path: the owner, a
    // stranger before and after expiry, a missing session, Owner == Account.
    void
    testDelete(FeatureBitset features)
    {
        testcase("delete");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, carol{"carol"}, key{"key"}, other{"other"};
        env.fund(XRP(10000), alice, carol);
        env.close();

        // The owner closes its session.
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        env.require(Owners(alice, 1));
        env(session::del(alice, key));
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        env.require(Owners(alice, 0));
        BEAST_EXPECT(
            !inOwnerDirectory(env, alice, keylet::signingSession(alice.id(), key.id()).key));

        // Missing session, with and without Owner.
        env(session::del(alice, other), Ter(tecNO_ENTRY));
        env(session::del(carol, other, alice), Ter(tecNO_ENTRY));

        // Owner == Account is malformed: the owner closes without Owner.
        env(session::del(alice, key, alice), Ter(temMALFORMED));

        // A stranger cannot close a live session ...
        env(session::set(alice, key, 25), session::Cap(XRP(10)));
        env.close();
        auto const expiration = (*sessionEntry(env, alice, key))[sfExpiration];
        BEAST_EXPECT(parentCloseTime(env) < expiration);
        env(session::del(carol, key, alice), Ter(tecNO_PERMISSION));
        BEAST_EXPECT(sessionEntry(env, alice, key));

        // ... and can once it has expired, at Expiration exactly.
        while (parentCloseTime(env) < expiration)
            env.close();
        env(session::del(carol, key, alice));
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        env.require(Owners(alice, 0));
        env.require(Owners(carol, 0));
    }

    // Case 19: sessions are not obligations, AccountDelete removes them.
    void
    testAccountDelete(FeatureBitset features)
    {
        testcase("AccountDelete");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, sink{"sink"}, key1{"key1"}, key2{"key2"};
        env.fund(XRP(10000), alice, sink);
        env.close();

        env(session::set(alice, key1, 600), Txflags(tfAllTransactions));
        env(session::set(alice, key2, 600), session::Cap(XRP(5)));
        env.close();
        env.require(Owners(alice, 2));

        incLgrSeqForAccDel(env, alice);
        env(acctdelete(alice, sink), Fee(drops(env.current()->fees().increment)));
        env.close();

        BEAST_EXPECT(!env.le(keylet::account(alice.id())));
        BEAST_EXPECT(!sessionEntry(env, alice, key1));
        BEAST_EXPECT(!sessionEntry(env, alice, key2));
    }

    // Case 24, RPC: ledger_entry by (account, session key) and by index, and
    // account_objects with the type filter.
    void
    testRpc(FeatureBitset features)
    {
        testcase("ledger_entry and account_objects");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        auto const index = keylet::signingSession(alice.id(), key.id()).key;

        {
            auto const jv = session::entry(env, alice, key)[jss::result];
            BEAST_EXPECT(jv[jss::index].asString() == to_string(index));
            BEAST_EXPECT(
                jv[jss::node][sfLedgerEntryType.jsonName].asString() == jss::SigningSession);
            BEAST_EXPECT(jv[jss::node][sfSessionKey.jsonName].asString() == key.human());
        }
        {
            json::Value params;
            params[jss::ledger_index] = jss::validated;
            params[jss::signing_session] = to_string(index);
            auto const jv = env.rpc("json", "ledger_entry", to_string(params))[jss::result];
            BEAST_EXPECT(jv[jss::node][sfAccount.jsonName].asString() == alice.human());
        }
        {
            // A missing session_key is a malformed request.
            json::Value params;
            params[jss::ledger_index] = jss::validated;
            params[jss::signing_session][jss::account] = alice.human();
            auto const jv = env.rpc("json", "ledger_entry", to_string(params))[jss::result];
            BEAST_EXPECT(jv[jss::error].asString() == "malformedRequest");
        }
        {
            json::Value params;
            params[jss::account] = alice.human();
            params[jss::type] = jss::signing_session;
            auto const jv = env.rpc("json", "account_objects", to_string(params))[jss::result];
            if (BEAST_EXPECT(jv[jss::account_objects].size() == 1))
            {
                auto const& object = jv[jss::account_objects][0u];
                BEAST_EXPECT(object[sfLedgerEntryType.jsonName].asString() == jss::SigningSession);
                BEAST_EXPECT(object[jss::index].asString() == to_string(index));
            }
        }
    }

    // Case 24, sponsorship decision (FIANSO-SPEC 6.10): a session's reserve is
    // never sponsored, so a reserve-sponsored SigningSessionSet is refused in
    // preflight.
    void
    testSponsorship(FeatureBitset features)
    {
        testcase("reserve sponsorship refused");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, sponsor{"sponsor"}, key{"key"};
        env.fund(XRP(10000), alice, sponsor);
        env.close();

        env(session::set(alice, key, 60),
            Txflags(tfAllTransactions),
            sponsor::As(sponsor, spfSponsorReserve),
            Ter(temINVALID_FLAG));
        BEAST_EXPECT(!sessionEntry(env, alice, key));
    }

    // Both types are non-delegable, and a firewall lets them through like
    // DelegateSet and SignerListSet: a session never moves value by itself,
    // and every session-signed transaction still meets the firewall.
    void
    testSettings(FeatureBitset features)
    {
        testcase("transaction settings");
        using namespace jtx;

        Env env{*this, features};
        auto const& permission = Permission::getInstance();
        for (auto const type : {ttSIGNING_SESSION_SET, ttSIGNING_SESSION_DELETE})
        {
            BEAST_EXPECT(!permission.isDelegable(type + 1, env.current()->rules()));
            BEAST_EXPECT(firewallAction(type) == FirewallAction::Allow);
        }
        BEAST_EXPECT(ttSIGNING_SESSION_SET == 130);
        BEAST_EXPECT(ttSIGNING_SESSION_DELETE == 131);
        BEAST_EXPECT(ltSIGNING_SESSION == 0x009A);
    }

public:
    void
    run() override
    {
        using namespace jtx;
        auto const all = testableAmendments();
        testEnabled(all);
        testOpen(all);
        testFlags(all);
        testReserve(all);
        testDelete(all);
        testAccountDelete(all);
        testRpc(all);
        testSponsorship(all);
        testSettings(all);
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessions, app, xrpl);

}  // namespace xrpl::test
