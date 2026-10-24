#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>
#include <test/jtx/amount.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/pay.h>
#include <test/jtx/rpc.h>
#include <test/jtx/sig.h>
#include <test/jtx/webauthn.h>

#include <xrpld/app/misc/Transaction.h>

#include <xrpl/basics/StringUtilities.h>
#include <xrpl/basics/base64.h>
#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/core/HashRouter.h>
#include <xrpl/json/json_reader.h>
#include <xrpl/json/json_value.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/server/NetworkOPs.h>
#include <xrpl/tx/apply.h>

#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <type_traits>

namespace xrpl {

/**
 * Transactions signed by a passkey through WebAuthn, with a software
 * authenticator (test/jtx/webauthn.h). Results are simulated: no device and
 * no browser ceremony are involved.
 *
 * The WebAuthn challenge is the transaction's signing data. That data holds
 * the SigningPubKey, and a P-256 public key starts with 0xF6, so every
 * challenge has a byte at or above 0x80. Before fixPasskeyChallenge, such a
 * challenge never compares equal where char is signed: every WebAuthn
 * signature is refused there, and accepted where char is unsigned.
 */
class PasskeyWebAuthn_test : public beast::unit_test::Suite
{
    // The hex PasskeyID of the test credential.
    static constexpr char const* kPasskeyId = "DEADBEEF";

    // Whether the comparison of the challenge before fixPasskeyChallenge
    // refuses every WebAuthn signature on this platform.
    static constexpr bool kOldComparisonRefuses = std::is_signed_v<char>;

    // Fund alice and bob, and register a P-256 passkey for alice.
    static void
    setUp(
        test::jtx::Env& env,
        test::jtx::Account const& alice,
        test::jtx::Account const& bob,
        test::jtx::Account const& passkey)
    {
        using namespace test::jtx;
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();
    }

    // The bytes the challenge in the ClientDataJSON of a signed JTx decodes to.
    static std::string
    decodedChallenge(test::jtx::JTx const& jt)
    {
        auto const clientDataJSON =
            strUnHex(jt.jv[sfPasskeySignature.jsonName][sfClientDataJSON.jsonName].asString());
        if (!clientDataJSON)
            return {};
        json::Value parsed;
        if (!json::Reader().parse(
                std::string(clientDataJSON->begin(), clientDataJSON->end()), parsed))
            return {};
        return base64urlDecode(parsed["challenge"].asString());
    }

    static void
    expectRefused(test::jtx::JTx& jt)
    {
        jt.ter = telENV_RPC_FAILED;
        jt.rpcException = {"invalidTransaction", "fails local checks: Invalid signature."};
    }

    static void
    expectApplied(test::jtx::JTx& jt)
    {
        jt.ter = tesSUCCESS;
        jt.rpcException.reset();
    }

    void
    testHighByteChallenge(FeatureBitset features)
    {
        testcase("challenge with a byte at or above 0x80");

        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(env, alice, bob, passkey);

        auto jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));

        // The challenge is exactly the signing data, and holds high bytes.
        auto const challenge = decodedChallenge(jt);
        auto const data = signingData(jt.jv);
        BEAST_EXPECT(challenge == std::string(data.begin(), data.end()));
        BEAST_EXPECT(
            std::any_of(data.begin(), data.end(), [](std::uint8_t b) { return b >= 0x80; }));

        bool const refused = !features[fixPasskeyChallenge] && kOldComparisonRefuses;
        if (refused)
            expectRefused(jt);
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == (refused ? XRP(1000) : XRP(1100)));
    }

    void
    testBadAssertions(FeatureBitset features)
    {
        testcase("assertions that do not match the transaction");

        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(env, alice, bob, passkey);

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

        // The control: the same payment, signed the same way with nothing
        // altered, is accepted wherever the comparison is right.
        bool const controlRefused = !features[fixPasskeyChallenge] && kOldComparisonRefuses;
        auto control = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        if (controlRefused)
            expectRefused(control);
        env.submit(control);
        env.close();
        BEAST_EXPECT(env.balance(bob) == (controlRefused ? XRP(1000) : XRP(1100)));
    }

    void
    testActivation(FeatureBitset features)
    {
        testcase("a signature refused before the fix is accepted after it");

        using namespace test::jtx;

        // The same signed blob is submitted before and after the amendment.
        // A bad verdict cached before it would refuse the blob after it.
        Env env{*this, envconfig(), features - fixPasskeyChallenge};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(env, alice, bob, passkey);

        auto jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        if constexpr (kOldComparisonRefuses)
        {
            expectRefused(jt);
            env.submit(jt);
            env.close();

            env.enableFeature(fixPasskeyChallenge);
            env.close();
            BEAST_EXPECT(env.current()->rules().enabled(fixPasskeyChallenge));
            expectApplied(jt);
        }
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testCacheAcrossTheFix(FeatureBitset features)
    {
        testcase("no signature verdict crosses the fix");

        using namespace test::jtx;

        // Two environments give the rules on each side of the amendment, and
        // one router holds the verdicts, as on a node whose validated rules
        // lag its open ledger at the flag ledger.
        Env preFix{*this, envconfig(), features - fixPasskeyChallenge};
        Env postFix{*this, envconfig(), features};
        auto const preFixRules = preFix.current()->rules();
        auto const postFixRules = postFix.current()->rules();

        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(postFix, alice, bob, passkey);

        auto const jt = postFix.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto const id = jt.stx->getTransactionID();
        auto& router = postFix.app().getHashRouter();
        auto const preFixVerdict = kOldComparisonRefuses ? Validity::SigBad : Validity::Valid;

        // Before the fix the signature is verified and no verdict is kept.
        BEAST_EXPECT(checkValidity(router, *jt.stx, preFixRules).first == preFixVerdict);
        if constexpr (kOldComparisonRefuses)
            BEAST_EXPECT(router.getFlags(id) == HashRouterFlags::UNDEFINED);

        // After it, the same router verifies it again and accepts it ...
        BEAST_EXPECT(checkValidity(router, *jt.stx, postFixRules).first == Validity::Valid);

        // ... and a check that still uses the old rules does not read that
        // good verdict.
        BEAST_EXPECT(checkValidity(router, *jt.stx, preFixRules).first == preFixVerdict);
    }

    void
    testForcedVerdict(FeatureBitset features)
    {
        testcase("a forced signature verdict holds on both sides of the fix");

        using namespace test::jtx;

        // forceValidity means the caller verified nothing and wants the
        // result trusted (a cluster relay, ledger replay, signature checks
        // turned off), so it must hold even where checkValidity keeps no
        // verdict of its own.
        Env preFix{*this, envconfig(), features - fixPasskeyChallenge};
        Env postFix{*this, envconfig(), features};
        auto const preFixRules = preFix.current()->rules();
        auto const postFixRules = postFix.current()->rules();

        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(postFix, alice, bob, passkey);

        // A signature that does not verify in any era: only the forced
        // verdict can make the checks below pass.
        auto const jt = postFix.jt(
            pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId, {.alterSignature = true}));
        if (!BEAST_EXPECT(jt.stx))
            return;

        auto& router = preFix.app().getHashRouter();
        forceValidity(router, jt.stx->getTransactionID(), Validity::SigGoodOnly);
        BEAST_EXPECT(checkValidity(router, *jt.stx, preFixRules).first != Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *jt.stx, postFixRules).first != Validity::SigBad);
    }

    void
    testCacheableCondition(FeatureBitset features)
    {
        testcase("which signature verdicts are kept before the fix");

        using namespace test::jtx;

        Env preFix{*this, envconfig(), features - fixPasskeyChallenge};
        Env postFix{*this, envconfig(), features};
        auto const preFixRules = preFix.current()->rules();
        auto const postFixRules = postFix.current()->rules();

        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(postFix, alice, bob, passkey);

        // Signed through WebAuthn: not kept before the fix, kept after it.
        auto const webAuthn = postFix.jt(pay(alice, bob, XRP(1)), WebAuthnSig(passkey, kPasskeyId));
        BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, preFixRules));
        BEAST_EXPECT(isSignatureVerdictCacheable(*webAuthn.stx, postFixRules));

        // Signed by the same passkey without WebAuthn, and by the master key:
        // the comparison is not involved, so the verdict is kept.
        auto const rawPasskey = postFix.jt(pay(alice, bob, XRP(1)), Sig(passkey));
        BEAST_EXPECT(isSignatureVerdictCacheable(*rawPasskey.stx, preFixRules));
        auto const master = postFix.jt(pay(alice, bob, XRP(1)));
        BEAST_EXPECT(isSignatureVerdictCacheable(*master.stx, preFixRules));
    }

    void
    testNetworkOPsDoesNotMarkBad(FeatureBitset features)
    {
        testcase("NetworkOPs does not mark a passkey signature bad before the fix");

        using namespace test::jtx;

        Env env{*this, envconfig(), features - fixPasskeyChallenge};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        setUp(env, alice, bob, passkey);

        auto jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        auto const id = jt.stx->getTransactionID();

        std::string reason;
        auto tx = std::make_shared<Transaction>(jt.stx, reason, env.app());
        env.app().getOPs().processTransaction(tx, false, true, NetworkOPs::FailHard::No);
        BEAST_EXPECT(!any(env.app().getHashRouter().getFlags(id) & HashRouterFlags::BAD));

        if constexpr (kOldComparisonRefuses)
        {
            BEAST_EXPECT(tx->getResult() == temBAD_SIGNATURE);

            // Once the fix is enabled, the same transaction is accepted.
            env.enableFeature(fixPasskeyChallenge);
            env.close();
            env.submit(jt);
        }
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();

        testHighByteChallenge(all);
        testHighByteChallenge(all - fixPasskeyChallenge);
        testBadAssertions(all);
        testBadAssertions(all - fixPasskeyChallenge);
        testActivation(all);
        testCacheAcrossTheFix(all);
        testForcedVerdict(all);
        testCacheableCondition(all);
        testNetworkOPsDoesNotMarkBad(all);
    }
};

BEAST_DEFINE_TESTSUITE(PasskeyWebAuthn, app, xrpl);

}  // namespace xrpl
