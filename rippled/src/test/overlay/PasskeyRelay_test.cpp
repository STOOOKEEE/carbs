#include <test/jtx/Account.h>
#include <test/jtx/CheckMessageLogs.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/pay.h>
#include <test/jtx/webauthn.h>
#include <test/overlay/PeerTest.h>

#include <xrpld/overlay/detail/ProtocolVersion.h>

#include <xrpl/basics/make_SSLContext.h>
#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/beast/utility/Journal.h>
#include <xrpl/core/HashRouter.h>
#include <xrpl/core/JobQueue.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/Serializer.h>

#include <xrpl.pb.h>

#include <memory>
#include <type_traits>

namespace xrpl::test {

using namespace jtx;

/**
 * A transaction signed through WebAuthn (test/jtx/webauthn.h, simulated) and
 * relayed by a peer before fixPasskeyChallenge. Where char is signed the
 * peer's copy is refused; it must not be marked BAD, or the transaction would
 * stay refused after the amendment is enabled.
 */
class PasskeyRelay_test : public beast::unit_test::Suite
{
    // The hex PasskeyID of the test credential.
    static constexpr char const* kPasskeyId = "DEADBEEF";

    PeerTest::SharedContext context_{makeSslContext("")};
    ProtocolVersion protocolVersion_{1, 7};

    void
    testRelayBeforeTheFix()
    {
        testcase("a relayed passkey signature is not marked bad before the fix");

        // The peer logs this when it checks the relayed copy and refuses it.
        bool refusedByPeer = false;
        Env env{
            *this,
            envconfig(),
            testableAmendments() - fixPasskeyChallenge,
            std::make_unique<CheckMessageLogs>(
                "Exception checking transaction: Invalid signature.", &refusedByPeer),
            beast::Severity::Debug};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        auto const jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(passkey, kPasskeyId));
        auto const id = jt.stx->getTransactionID();

        PeerTest::resetId();
        auto peer = makePeerTest(env, context_, protocolVersion_);

        Serializer s;
        jt.stx->add(s);
        auto const blob = s.peekData();
        auto message = std::make_shared<protocol::TMTransaction>();
        message->set_rawtransaction(blob.data(), blob.size());
        message->set_status(protocol::tsNEW);
        peer->onMessage(message);
        env.app().getJobQueue().rendezvous();

        BEAST_EXPECT(!any(env.app().getHashRouter().getFlags(id) & HashRouterFlags::BAD));
        if constexpr (!std::is_signed_v<char>)
            return;

        // The relayed copy was checked and refused ...
        BEAST_EXPECT(refusedByPeer);

        // ... and once the fix is enabled, the same transaction is accepted.
        env.enableFeature(fixPasskeyChallenge);
        env.close();
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

public:
    void
    run() override
    {
        testRelayBeforeTheFix();
    }
};

BEAST_DEFINE_TESTSUITE(PasskeyRelay, overlay, xrpl);

}  // namespace xrpl::test
