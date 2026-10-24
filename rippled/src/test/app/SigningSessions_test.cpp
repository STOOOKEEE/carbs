#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/TestHelpers.h>
#include <test/jtx/acctdelete.h>
#include <test/jtx/amount.h>
#include <test/jtx/batch.h>
#include <test/jtx/delegate.h>
#include <test/jtx/fee.h>
#include <test/jtx/flags.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/multisign.h>
#include <test/jtx/offer.h>
#include <test/jtx/owners.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/sponsor.h>
#include <test/jtx/ter.h>
#include <test/jtx/ticket.h>
#include <test/jtx/trust.h>
#include <test/jtx/txflags.h>
#include <test/jtx/webauthn.h>

#include <xrpl/basics/strHex.h>
#include <xrpl/beast/unit_test.h>
#include <xrpl/json/to_string.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Firewall.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/MPTIssue.h>
#include <xrpl/protocol/Permissions.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/Serializer.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/tx/SigningSession.h>
#include <xrpl/tx/Transactor.h>

#pragma push_macro("TRANSACTION")
#undef TRANSACTION
#define TRANSACTION(...)
#define TRANSACTION_INCLUDE 1
#include <xrpl/protocol/detail/transactions.macro>
#undef TRANSACTION
#pragma pop_macro("TRANSACTION")

#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
#include <string>

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

        // The reserve is checked on the balance before the fee: one drop short
        // of the reserve of one more object is refused ...
        env.fund(reserve + increment - drops(1), alice);
        env.close();
        env(session::set(alice, key, 60), Txflags(tfAllTransactions), Ter(tecINSUFFICIENT_RESERVE));
        // The open ledger retries a tec when the ledger closes: close now, so
        // that the payment below cannot turn this refusal into a success.
        env.close();
        env.require(Owners(alice, 0));
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        BEAST_EXPECT(env.balance(alice) == reserve + increment - drops(1) - fee);

        // ... and exactly that reserve before the fee is enough, although the
        // balance after the fee is below it.
        env(pay(env.master, alice, drops(1) + fee));
        env.close();
        BEAST_EXPECT(env.balance(alice) == reserve + increment);
        env(session::set(alice, key, 60), Txflags(tfAllTransactions));
        env.close();
        env.require(Owners(alice, 1));
        BEAST_EXPECT(env.balance(alice) == reserve + increment - fee);
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

        // A stranger cannot close a live session, up to the last ledger
        // before Expiration ... Close times move in steps of 10 seconds, so a
        // duration of 30 makes Expiration a parent close time.
        env(session::set(alice, key, 30), session::Cap(XRP(10)));
        env.close();
        auto const expiration = (*sessionEntry(env, alice, key))[sfExpiration];
        int refused = 0;
        while (parentCloseTime(env) < expiration)
        {
            env(session::del(carol, key, alice), Ter(tecNO_PERMISSION));
            ++refused;
            env.close();
        }
        BEAST_EXPECT(refused > 0);
        BEAST_EXPECT(sessionEntry(env, alice, key));

        // ... and can once it has expired, at Expiration exactly.
        BEAST_EXPECT(parentCloseTime(env) == expiration);
        env(session::del(carol, key, alice));
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        env.require(Owners(alice, 0));
        env.require(Owners(carol, 0));
    }

    // SessionCap is an XRP amount: an MPT amount fails the local checks of
    // the transaction format (PLAN-CHECK finding 3).
    void
    testMptCap(FeatureBitset features)
    {
        testcase("MPT cap refused");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        STAmount const mpt{MPTIssue{makeMptID(1, alice)}, UINT64_C(100)};
        auto const jt = env.jt(session::set(alice, key, 60), session::Cap(mpt));
        Serializer s;
        jt.stx->add(s);
        auto const jr = env.rpc("submit", strHex(s.slice()));
        BEAST_EXPECT(jr[jss::result][jss::error] == "invalidTransaction");
        BEAST_EXPECT(!sessionEntry(env, alice, key));
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

    // Case 2: exactly one of the three modes.
    void
    testModes(FeatureBitset features)
    {
        testcase("exactly one mode");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        auto const all = Txflags(tfAllTransactions);
        auto const cap = session::Cap(XRP(10));
        auto const permissions = session::Permissions({"Payment"});

        env(session::set(alice, key, 60), Ter(temMALFORMED));
        env(session::set(alice, key, 60), all, cap, Ter(temMALFORMED));
        env(session::set(alice, key, 60), all, permissions, Ter(temMALFORMED));
        env(session::set(alice, key, 60), cap, permissions, Ter(temMALFORMED));
        env(session::set(alice, key, 60), all, cap, permissions, Ter(temMALFORMED));
        env.require(Owners(alice, 0));
    }

    // Case 3: a session key never already holds authority over the account.
    void
    testSessionKey(FeatureBitset features)
    {
        testcase("session key");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, regular{"regular"}, passkey{"passkey", KeyType::P256};
        Account const heir{"heir"}, key{"key"};
        env.fund(XRP(10000), alice, heir);
        env.close();

        env(session::set(alice, alice, 60), Txflags(tfAllTransactions), Ter(temMALFORMED));

        env.memoize(regular);
        env(regkey(alice, regular));
        env(session::set(alice, regular, 60), Txflags(tfAllTransactions), Ter(tecNO_PERMISSION));

        env(passkeyListSet(alice, passkey, "DEADBEEF"));
        env(session::set(alice, passkey, 60), Txflags(tfAllTransactions), Ter(tecNO_PERMISSION));

        {
            json::Value jv;
            jv[sfTransactionType] = jss::BeneficiarySet;
            jv[sfAccount] = alice.human();
            jv[sfBeneficiary] = heir.human();
            jv[sfTimeLock] = 3600;
            env(jv);
        }
        env(session::set(alice, heir, 60), Txflags(tfAllTransactions), Ter(tecNO_PERMISSION));

        env(session::set(alice, key, 60), Txflags(tfAllTransactions));
        env(session::set(alice, key, 60), session::Cap(XRP(1)), Ter(tecDUPLICATE));
        env.require(Owners(alice, 3));  // the passkey list, the beneficiary and one session
    }

    // Case 4: 1 <= SessionDuration <= kMaxSessionDuration.
    void
    testDuration(FeatureBitset features)
    {
        testcase("duration");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, k1{"k1"}, k2{"k2"};
        env.fund(XRP(10000), alice);
        env.close();

        env(session::set(alice, k1, 0), Txflags(tfAllTransactions), Ter(temBAD_EXPIRATION));
        env(session::set(alice, k1, kMaxSessionDuration + 1),
            Txflags(tfAllTransactions),
            Ter(temBAD_EXPIRATION));
        env(session::set(alice, k1, 1), Txflags(tfAllTransactions));
        env(session::set(alice, k2, kMaxSessionDuration), Txflags(tfAllTransactions));
    }

    // Case 5: Permissions hold 1 to 10 delegable, distinct, not excluded values.
    void
    testPermissions(FeatureBitset features)
    {
        testcase("permissions");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, key{"key"};
        env.fund(XRP(10000), alice);
        env.close();

        for (auto const* name :
             {"AccountSet",
              "SetRegularKey",
              "SignerListSet",
              "DelegateSet",
              "Batch",
              "AccountDelete",
              "SigningSessionSet",
              "SigningSessionDelete",
              "PasskeyListSet",
              "SubscriptionSet",
              "SponsorshipSet"})
        {
            env(session::set(alice, key, 60), session::Permissions({name}), Ter(temMALFORMED));
        }

        env(session::set(alice, key, 60),
            session::Permissions({"Payment", "Payment"}),
            Ter(temMALFORMED));

        env(session::set(alice, key, 60), session::Permissions({}), Ter(temARRAY_EMPTY));

        env(session::set(alice, key, 60),
            session::Permissions(
                {"Payment",
                 "TrustSet",
                 "OfferCreate",
                 "OfferCancel",
                 "EscrowCreate",
                 "EscrowFinish",
                 "EscrowCancel",
                 "CheckCreate",
                 "CheckCash",
                 "CheckCancel",
                 "TicketCreate"}),
            Ter(temARRAY_TOO_LARGE));

        // A granular permission.
        env(session::set(alice, key, 60), session::Permissions({"PaymentMint", "TrustlineFreeze"}));
        env.require(Owners(alice, 1));
    }

    // SessionCap is a positive XRP amount.
    void
    testCap(FeatureBitset features)
    {
        testcase("cap");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, gw{"gw"}, key{"key"};
        env.fund(XRP(10000), alice, gw);
        env.close();

        env(session::set(alice, key, 60), session::Cap(XRP(0)), Ter(temBAD_AMOUNT));
        env(session::set(alice, key, 60), session::Cap(XRP(-1)), Ter(temBAD_AMOUNT));
        env(session::set(alice, key, 60), session::Cap(gw["USD"](10)), Ter(temBAD_AMOUNT));
        env(session::set(alice, key, 60), session::Cap(drops(1)));
    }

    // Case 9: mode A signs any delegable type but the excluded ones.
    void
    testModeA(FeatureBitset features)
    {
        testcase("mode A");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, gw{"gw"}, key{"key"}, other{"other"};
        env.fund(XRP(10000), alice, bob, gw);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();

        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // Delegable types.
        env(pay(alice, bob, XRP(10)), Sig(key), lls());
        env(trust(alice, gw["USD"](100)), Sig(key), lls());
        env(offer(alice, gw["USD"](5), XRP(10)), Sig(key), lls());
        env(ticket::create(alice, 1), Sig(key), lls());
        env.close();

        // Non-delegable types, the session types included.
        env(fset(alice, asfRequireDest), Sig(key), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(regkey(alice, other), Sig(key), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(signers(alice, 1, {{bob, 1}}), Sig(key), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(delegate::set(alice, bob, {"Payment"}),
            Sig(key),
            lls(),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        // Case 6: a session cannot open a session.
        env(session::set(alice, other, 60),
            Txflags(tfAllTransactions),
            Sig(key),
            lls(),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        // Case 13: closing another key's session, or a missing one, is not
        // the own close.
        env(session::del(alice, other), Sig(key), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));

        // Excluded types, although delegable.
        env(passkeyListSet(alice, Account{"pk", KeyType::P256}, "AA"),
            Sig(key),
            lls(),
            Ter(tefSESSION_TX_NOT_ALLOWED));
    }

    // Case 10: the session signs strictly before Expiration, measured on the
    // parent close time read after each ledger close; the session key can
    // still close the expired session.
    void
    testExpiry(FeatureBitset features)
    {
        testcase("expiry");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, key, 30), Txflags(tfAllTransactions));
        env.close();
        auto const expiration = (*sessionEntry(env, alice, key))[sfExpiration];
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        int signedBefore = 0;
        while (parentCloseTime(env) < expiration)
        {
            env(pay(alice, bob, XRP(1)), Sig(key), lls());
            ++signedBefore;
            env.close();
        }
        BEAST_EXPECT(signedBefore > 0);
        BEAST_EXPECT(parentCloseTime(env) >= expiration);
        env(pay(alice, bob, XRP(1)), Sig(key), lls(), Ter(tefSESSION_EXPIRED));

        // The own close is not refused for expiry.
        env(session::del(alice, key), Sig(key), lls());
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
        env.require(Owners(alice, 0));
    }

    // Case 13, the fee ceiling: Fee <= base fee of the type + 1000 base fee
    // units, in every mode, the own close included; a refused transaction
    // claims no fee.
    void
    testFeeCeiling(FeatureBitset features)
    {
        testcase("fee ceiling");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, keyA{"keyA"}, keyP{"keyP"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, keyA, 600), Txflags(tfAllTransactions));
        env(session::set(alice, keyP, 600), session::Permissions({"TicketCreate"}));
        env.close();

        auto const base = env.current()->fees().base;
        auto const ceiling = base + base * kSessionFeeMultiple;
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        env(pay(alice, bob, XRP(1)), Sig(keyA), Fee(ceiling), lls());
        env(ticket::create(alice, 1), Sig(keyP), Fee(ceiling), lls());
        env.close();

        // A loop of refusals leaves the balance unchanged.
        auto const balance = env.balance(alice);
        for (int i = 0; i < 10; ++i)
        {
            env(pay(alice, bob, XRP(1)),
                Sig(keyA),
                Fee(ceiling + drops(1)),
                lls(),
                Ter(tefSESSION_LIMIT));
            env(ticket::create(alice, 1),
                Sig(keyP),
                Fee(ceiling + drops(1)),
                lls(),
                Ter(tefSESSION_LIMIT));
            env(session::del(alice, bob), Sig(keyA), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));
        }
        env.close();
        BEAST_EXPECT(env.balance(alice) == balance);

        // The own close keeps the ceiling.
        env(session::del(alice, keyA),
            Sig(keyA),
            Fee(ceiling + drops(1)),
            lls(),
            Ter(tefSESSION_LIMIT));
        env(session::del(alice, keyA), Sig(keyA), Fee(ceiling), lls());
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, keyA));
    }

    // Case 13: types whose required fee is the owner reserve increment pass
    // the ceiling, since its first term is the type's own base fee.
    void
    testFeeCeilingReserveTypes(FeatureBitset features)
    {
        testcase("fee ceiling, reserve-priced types");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, gw{"gw"}, key{"key"};
        env.fund(XRP(100000), alice, gw);
        env.close();
        env(trust(alice, gw["USD"](1000)));
        env(pay(gw, alice, gw["USD"](100)));
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();

        auto const increment = env.current()->fees().increment;
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        json::Value create;
        create[jss::TransactionType] = jss::AMMCreate;
        create[jss::Account] = alice.human();
        create[jss::Amount] = XRP(100).value().getJson(JsonOptions::Values::None);
        create[jss::Amount2] = gw["USD"](10).value().getJson(JsonOptions::Values::None);
        create[jss::TradingFee] = 0;
        env(create, Sig(key), Fee(increment), lls());

        json::Value fix;
        fix[jss::TransactionType] = jss::LedgerStateFix;
        fix[jss::Account] = alice.human();
        fix[sfLedgerFixType.jsonName] = 1;
        fix[sfOwner.jsonName] = alice.human();
        env(fix, Sig(key), Fee(increment), lls(), Ter(tecFAILED_PROCESSING));
    }

    // Case 14 and 15: a session key outside the single-signed shape, or for
    // another account, falls to the ordinary signature check.
    void
    testNotSessionShapes(FeatureBitset features)
    {
        testcase("shapes that follow the existing rules");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, carol{"carol"}, key{"key"};
        env.fund(XRP(10000), alice, bob, carol);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // Case 15: another account.
        env(pay(bob, carol, XRP(1)), Sig(key), lls(), Ter(tefBAD_AUTH));

        // Delegate: bob acts for alice, signed by alice's session key.
        env(delegate::set(alice, bob, {"Payment"}));
        env.close();
        env(pay(alice, carol, XRP(1)), delegate::As(bob), Sig(key), lls(), Ter(tefBAD_AUTH));

        // Signers: the session key as a multi-signer of alice.
        env(signers(alice, 1, {{bob, 1}}));
        env.close();
        env(pay(alice, carol, XRP(1)), Msig(key), Fee(drops(20)), lls(), Ter(tefBAD_SIGNATURE));
    }

    // Case 14, the other shapes: a fee sponsor, a CounterpartySignature, a
    // Batch inner signature. The session key falls to the ordinary signature
    // check of the account, which it fails.
    void
    testNotSessionShapesMore(FeatureBitset features)
    {
        testcase("sponsor, counterparty and batch shapes");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, carol{"carol"}, backup{"backup"};
        Account const sponsor{"sponsor"}, key{"key"};
        env.fund(XRP(10000), alice, bob, carol, backup, sponsor);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // A fee sponsor co-signs; the payment itself is signed by the key.
        env(pay(alice, bob, XRP(1)),
            sponsor::As(sponsor, spfSponsorFee),
            Sig(sfSponsorSignature, sponsor),
            Sig(key),
            lls(),
            Ter(tefBAD_AUTH));

        // A CounterpartySignature (only non-delegable types carry one): a
        // session-signed FirewallSet would be tefSESSION_TX_NOT_ALLOWED.
        env(firewall::set(alice.id(), carol.id(), backup.id()));
        env.close();
        env(firewall::set(alice.id(), keylet::firewall(alice.id()).key),
            Sig(key),
            Sig(sfCounterpartySignature, carol),
            Fee(drops(20)),
            lls(),
            Ter(tefBAD_AUTH));

        // A Batch whose inner payment of alice is signed by her session key.
        auto const aliceSeq = env.seq(alice);
        auto const bobSeq = env.seq(bob);
        env(batch::outer(bob, bobSeq, batch::calcBatchFee(env, 1, 2), tfAllOrNothing),
            batch::Inner(pay(alice, carol, XRP(1)), aliceSeq),
            batch::Inner(pay(bob, carol, XRP(1)), bobSeq + 1),
            batch::Sig(Reg{alice, key}),
            lls(),
            Ter(tefBAD_AUTH));
        env.close();
        BEAST_EXPECT(env.seq(alice) == aliceSeq);
    }

    // Case 6: a non-delegable type with Delegate is refused in preflight.
    void
    testSetWithDelegate(FeatureBitset features)
    {
        testcase("SigningSessionSet with Delegate");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(delegate::set(alice, bob, {"Payment"}));
        env.close();
        env(session::set(alice, key, 60),
            Txflags(tfAllTransactions),
            delegate::As(bob),
            Ter(temINVALID));
        BEAST_EXPECT(!sessionEntry(env, alice, key));
    }

    // Mode C signs nothing until its whitelist and its accounting land (N5).
    void
    testModeCNotYet(FeatureBitset features)
    {
        testcase("mode C before its accounting");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, key, 600), session::Cap(XRP(100)));
        env.close();
        env(pay(alice, bob, XRP(1)),
            Sig(key),
            LastLedgerSeq(env.current()->seq() + 10),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        // The own close is eligible in every mode.
        env(session::del(alice, key), Sig(key), LastLedgerSeq(env.current()->seq() + 10));
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
    }

    // Case 17: a session key later made the RegularKey stays bounded until its
    // session is deleted; case 17b: LastLedgerSequence present and near.
    void
    testRegularKeyAndLastLedger(FeatureBitset features)
    {
        testcase("regular key and LastLedgerSequence");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"}, key{"key"}, other{"other"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.memoize(key);
        env(regkey(alice, key));
        env.close();

        auto const seq = env.current()->seq();
        env(regkey(alice, other),
            Sig(key),
            LastLedgerSeq(seq + 10),
            Ter(tefSESSION_TX_NOT_ALLOWED));

        // Case 17b.
        env(pay(alice, bob, XRP(1)), Sig(key), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(pay(alice, bob, XRP(1)),
            Sig(key),
            LastLedgerSeq(seq + kSessionMaxLedgerWindow + 1),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        env(pay(alice, bob, XRP(1)), Sig(key), LastLedgerSeq(seq + kSessionMaxLedgerWindow));
        env.close();

        // Once the owner deletes the session with its master key, the key has
        // the RegularKey's full authority.
        env(session::del(alice, key), Sig(alice));
        env.close();
        env(regkey(alice, other), Sig(key));
        env.close();
        BEAST_EXPECT((*env.le(keylet::account(alice.id())))[sfRegularKey] == other.id());
    }

    // Case 8: mode P signs the listed types; a granular permission respects
    // both its sandbox and the type's semantics.
    void
    testModeP(FeatureBitset features)
    {
        testcase("mode P");
        using namespace jtx;

        Env env{*this, features};
        Account const gw{"gw"}, alice{"alice"}, bob{"bob"}, gw2{"gw2"};
        Account const keyPay{"keyPay"}, keyMint{"keyMint"}, keyFreeze{"keyFreeze"};
        env.fund(XRP(10000), gw, alice, bob, gw2);
        env.close();
        auto const usd = gw["USD"];
        env(trust(alice, usd(1000)));
        env(trust(gw, gw2["EUR"](1000)));
        env(pay(gw2, gw, gw2["EUR"](100)));
        env.close();
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // A listed type succeeds, an unlisted one is refused.
        env(session::set(gw, keyPay, 600), session::Permissions({"Payment"}));
        env.close();
        env(pay(gw, bob, XRP(1)), Sig(keyPay), lls());
        env(ticket::create(gw, 1), Sig(keyPay), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));

        // PaymentMint: the issuer pays its own IOU, never XRP nor another
        // issuer's IOU.
        env(session::set(gw, keyMint, 600), session::Permissions({"PaymentMint"}));
        env.close();
        env(pay(gw, alice, usd(10)), Sig(keyMint), lls());
        env(pay(gw, alice, XRP(1)), Sig(keyMint), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));
        env(pay(gw, bob, gw2["EUR"](1)), Sig(keyMint), lls(), Ter(tefSESSION_TX_NOT_ALLOWED));

        // TrustlineFreeze cannot create a trust line.
        env(session::set(gw, keyFreeze, 600), session::Permissions({"TrustlineFreeze"}));
        env.close();
        env(trust(gw, alice["USD"](0), tfSetFreeze), Sig(keyFreeze), lls());
        env(trust(gw, bob["USD"](0), tfSetFreeze),
            Sig(keyFreeze),
            lls(),
            Ter(tefSESSION_TX_NOT_ALLOWED));
        env.close();
    }

    // Case 20: session keys of every key type; ML-DSA-44 on a Ledger account
    // (master disabled, RegularKey an ML-DSA-44 key), FIANSO-SPEC 6.14.
    void
    testKeyTypes(FeatureBitset features)
    {
        testcase("session key types");
        using namespace jtx;

        for (auto const type :
             {KeyType::P256, KeyType::Ed25519, KeyType::Secp256k1, KeyType::Dilithium})
        {
            Env env{*this, features};
            Account const alice{"alice"}, bob{"bob"};
            Account const key{"session", type};
            env.fund(XRP(10000), alice, bob);
            env.close();
            env(session::set(alice, key, 600), Txflags(tfAllTransactions));
            env.close();
            auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };
            env(pay(alice, bob, XRP(1)), Sig(key), lls());
            env(session::del(alice, key), Sig(key), lls());
            env.close();
            BEAST_EXPECT(!sessionEntry(env, alice, key));
        }
    }

    void
    testMlDsaLedgerAccount(FeatureBitset features)
    {
        testcase("ML-DSA-44 Ledger account");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"};
        Account const root{"root", KeyType::Dilithium}, key{"key", KeyType::Dilithium};
        env.fund(XRP(10000), alice, bob);
        env.close();

        BEAST_EXPECT(root.pk().size() == 1312);
        env.memoize(root);
        env(regkey(alice, root));
        env(fset(alice, asfDisableMaster), Sig(alice));
        env.close();

        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // The disabled master cannot open a session; the ML-DSA-44 RegularKey
        // can, and cannot open one for itself.
        env(session::set(alice, key, 600),
            Txflags(tfAllTransactions),
            Sig(alice),
            Ter(tefMASTER_DISABLED));
        env(session::set(alice, root, 600),
            Txflags(tfAllTransactions),
            Sig(root),
            Ter(tecNO_PERMISSION));
        env(session::set(alice, key, 600), Txflags(tfAllTransactions), Sig(root));
        env.close();
        BEAST_EXPECT((*sessionEntry(env, alice, key))[sfSessionKey] == calcAccountID(key.pk()));

        // The ML-DSA-44 session key signs a payment, not for another account.
        env(pay(alice, bob, XRP(1)), Sig(key), lls());
        env(pay(bob, alice, XRP(1)), Sig(key), lls(), Ter(tefBAD_AUTH));
        env.close();

        // A corrupted signature fails the signature check before any rule.
        {
            auto jt = env.jt(pay(alice, bob, XRP(1)), Sig(key), lls());
            auto sig = jt.stx->getFieldVL(sfTxnSignature);
            sig[100] ^= 0x01;
            STTx bad{*jt.stx};
            bad.setFieldVL(sfTxnSignature, sig);
            Serializer s;
            bad.add(s);
            auto const jr = env.rpc("submit", strHex(s.slice()));
            BEAST_EXPECT(jr[jss::result][jss::error] == "invalidTransaction");
        }

        // A 1 312-byte value that is not a key is typed ML-DSA-44 by its size
        // alone, and fails the signature check.
        {
            auto jt = env.jt(pay(alice, bob, XRP(1)), Sig(key), lls());
            STTx bad{*jt.stx};
            bad.setFieldVL(sfSigningPubKey, Blob(1312, 0x01));
            Serializer s;
            bad.add(s);
            auto const jr = env.rpc("submit", strHex(s.slice()));
            BEAST_EXPECT(jr[jss::result][jss::error] == "invalidTransaction");
        }

        // The own close.
        env(session::del(alice, key), Sig(key), lls());
        env.close();
        BEAST_EXPECT(!sessionEntry(env, alice, key));
    }

    // Which types a transactor checks the signature of itself.
    static std::map<TxType, bool>
    overridesCheckSign()
    {
        using CheckSign = NotTEC (*)(PreclaimContext const&);
        std::map<TxType, bool> result;
#pragma push_macro("TRANSACTION")
#undef TRANSACTION
#define TRANSACTION(tag, value, name, ...)                    \
    result[tag] = static_cast<CheckSign>(&name::checkSign) != \
        static_cast<CheckSign>(&Transactor::checkSign);
#include <xrpl/protocol/detail/transactions.macro>
#undef TRANSACTION
#pragma pop_macro("TRANSACTION")
        return result;
    }

    // Case 9b: every transaction type has an explicit answer in modes A and
    // P. A new delegable type fails this test until it is added to the list
    // below or to kSessionExcluded (FIANSO-SPEC 6.8), so the list cannot fail
    // open.
    void
    testEnumeration(FeatureBitset features)
    {
        testcase("enumeration of every type");
        using namespace jtx;

        std::set<std::string> const eligible = {
            "AMMBid",
            "AMMBinCreate",
            "AMMBinDestroy",
            "AMMClawback",
            "AMMCollectFees",
            "AMMCreate",
            "AMMDelete",
            "AMMDeposit",
            "AMMPositionTransfer",
            "AMMVote",
            "AMMWithdraw",
            "CheckCancel",
            "CheckCash",
            "CheckCreate",
            "Clawback",
            "ConfidentialMPTClawback",
            "ConfidentialMPTConvertBack",
            "ConfidentialMPTMergeInbox",
            "ConfidentialMPTSend",
            "CouponClaim",
            "CredentialAccept",
            "CredentialCreate",
            "CredentialDelete",
            "DepositPreauth",
            "DIDDelete",
            "DIDSet",
            "EscrowCancel",
            "EscrowCreate",
            "EscrowFinish",
            "LedgerStateFix",
            "MPTokenAuthorize",
            "MPTokenIssuanceCreate",
            "MPTokenIssuanceDestroy",
            "MPTokenIssuanceSet",
            "NFTokenAcceptOffer",
            "NFTokenBurn",
            "NFTokenCancelOffer",
            "NFTokenCreateOffer",
            "NFTokenMint",
            "NFTokenModify",
            "OfferCancel",
            "OfferCreate",
            "OracleDelete",
            "OracleSet",
            "Payment",
            "PaymentChannelClaim",
            "PaymentChannelClawback",
            "PaymentChannelCreate",
            "PaymentChannelFund",
            "PermissionedDomainDelete",
            "PermissionedDomainSet",
            "RepoAccept",
            "RepoCancel",
            "RepoClose",
            "RepoCreate",
            "RepoDefault",
            "SubscriptionCancel",
            "SubscriptionClaim",
            "TicketCreate",
            "TrustSet",
            "XChainAccountCreateCommit",
            "XChainAddAccountCreateAttestation",
            "XChainAddClaimAttestation",
            "XChainClaim",
            "XChainCommit",
            "XChainCreateBridge",
            "XChainCreateClaimID",
            "XChainModifyBridge",
        };

        Env env{*this, features};
        Account const alice{"alice"};
        env.fund(XRP(100000), alice);
        env.close();
        auto const& rules = env.current()->rules();
        auto const overrides = overridesCheckSign();

        std::set<std::string> actual;
        for (auto const& format : TxFormats::getInstance())
        {
            auto const type = format.getType();
            if (isSessionEligibleType(type, rules))
            {
                actual.insert(format.getName());
                // The session path replaces Transactor::checkSign; a type
                // with its own check would lose it.
                BEAST_EXPECTS(!overrides.at(type), format.getName());
            }
        }
        for (auto const& name : actual)
            BEAST_EXPECTS(eligible.contains(name), "new eligible type: " + name);
        for (auto const& name : eligible)
            BEAST_EXPECTS(actual.contains(name), "no longer eligible: " + name);

        // The excluded types are delegable: without the exclusion, mode A
        // would sign them.
        for (auto const type : kSessionExcluded)
            BEAST_EXPECT(Permission::getInstance().isDelegable(type + 1, rules));

        // Mode P lists exactly the eligible types.
        for (auto const& format : TxFormats::getInstance())
        {
            Account const key{"key" + format.getName()};
            auto const expected =
                eligible.contains(format.getName()) ? Ter(tesSUCCESS) : Ter(temMALFORMED);
            env(session::set(alice, key, 60), session::Permissions({format.getName()}), expected);
        }
        env.close();
        env.require(Owners(alice, eligible.size()));
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
        testMptCap(all);
        testAccountDelete(all);
        testRpc(all);
        testSponsorship(all);
        testSettings(all);
        testEnumeration(all);
        testModes(all);
        testSessionKey(all);
        testDuration(all);
        testPermissions(all);
        testCap(all);
        testModeA(all);
        testExpiry(all);
        testFeeCeiling(all);
        testFeeCeilingReserveTypes(all);
        testNotSessionShapes(all);
        testNotSessionShapesMore(all);
        testSetWithDelegate(all);
        testModeCNotYet(all);
        testRegularKeyAndLastLedger(all);
        testModeP(all);
        testKeyTypes(all);
        testMlDsaLedgerAccount(all);
    }
};

BEAST_DEFINE_TESTSUITE(SigningSessions, app, xrpl);

}  // namespace xrpl::test
