#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/pay.h>
#include <test/jtx/rpc.h>
#include <test/jtx/webauthn.h>

#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/KeyType.h>

#include <algorithm>
#include <type_traits>

namespace xrpl {

/**
 * Transactions signed by a passkey through WebAuthn, with a software
 * authenticator (test/jtx/webauthn.h). Results are simulated: no device and
 * no browser ceremony are involved.
 */
class PasskeyWebAuthn_test : public beast::unit_test::Suite
{
    // The hex PasskeyID of the test credential.
    static constexpr char const* kPasskeyId = "DEADBEEF";

    void
    testBadAssertions(FeatureBitset features)
    {
        testcase("assertions that do not match the transaction");

        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        auto const refused = Rpc("invalidTransaction", "fails local checks: Invalid signature.");

        // A challenge over other bytes: the signing data of another payment.
        {
            auto other = env.jt(pay(alice, bob, XRP(1)), WebAuthnSig(passkey, kPasskeyId));
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(passkey, kPasskeyId, {.challenge = signingData(other.jv)}),
                refused);
        }

        // A registration ceremony instead of an assertion.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(passkey, kPasskeyId, {.type = "webauthn.create"}),
            refused);

        // No challenge at all.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(passkey, kPasskeyId, {.omitChallenge = true}),
            refused);

        // A signature that does not verify.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(passkey, kPasskeyId, {.alterSignature = true}),
            refused);

        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1000));
    }

    // A valid assertion: its challenge is the signing data, which holds the
    // 0xF6 prefix of the P-256 SigningPubKey (a byte at or above 0x80).
    void
    testValidAssertion(FeatureBitset features)
    {
        testcase("valid assertion, with fixPasskeyChallenge");

        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        auto const signed100 = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        auto const data = signingData(signed100.jv);
        BEAST_EXPECT(std::any_of(data.begin(), data.end(), [](auto b) { return b >= 0x80; }));

        env(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    // Without the fix, the same valid assertion is refused where `char` is
    // signed (x86-64, macOS on arm64) and accepted where it is unsigned.
    void
    testWithoutFix(FeatureBitset features)
    {
        testcase("valid assertion, without fixPasskeyChallenge");

        using namespace test::jtx;

        Env env{*this, envconfig(), features - fixPasskeyChallenge};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        if constexpr (std::is_signed_v<char>)
        {
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(passkey, kPasskeyId),
                Rpc("invalidTransaction", "fails local checks: Invalid signature."));
            env.close();
            BEAST_EXPECT(env.balance(bob) == XRP(1000));
        }
        else
        {
            env(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
            env.close();
            BEAST_EXPECT(env.balance(bob) == XRP(1100));
        }
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();
        testBadAssertions(all);
        testValidAssertion(all);
        testWithoutFix(all);
    }
};

BEAST_DEFINE_TESTSUITE(PasskeyWebAuthn, app, xrpl);

}  // namespace xrpl
