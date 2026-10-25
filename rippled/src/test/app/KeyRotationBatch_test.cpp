#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/amount.h>
#include <test/jtx/batch.h>
#include <test/jtx/flags.h>
#include <test/jtx/noop.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>

#include <xrpl/basics/Slice.h>
#include <xrpl/beast/unit_test.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/Serializer.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>

#include <algorithm>
#include <array>
#include <cstddef>

namespace xrpl::test {

// Key rotation in a Batch: an account whose master key is disabled pays only
// through an all-or-nothing Batch signed by its current RegularKey K_n, that
// holds [Payment, SetRegularKey -> K_{n+1}]. The inner transactions carry no
// signature, so the only public key a payment reveals is K_n, the key it
// retires; the ledger knows K_{n+1} only by its AccountID, a hash.
class KeyRotationBatch_test : public beast::unit_test::Suite
{
    static constexpr std::size_t kRotations = 3;

    // True when the bytes of `needle` appear in `haystack`.
    static bool
    contains(Serializer const& haystack, Slice const& needle)
    {
        auto const& bytes = haystack.peekData();
        return std::search(bytes.begin(), bytes.end(), needle.begin(), needle.end()) != bytes.end();
    }

    static Serializer
    serialized(STObject const& object)
    {
        Serializer s;
        object.add(s);
        return s;
    }

    // alice with RegularKey `first` and the master key disabled.
    void
    setupAccount(jtx::Env& env, jtx::Account const& alice, jtx::Account const& first)
    {
        using namespace jtx;
        env(regkey(alice, first));
        env(fset(alice, asfDisableMaster), Sig(alice));
        env.close();
        auto const sle = env.le(keylet::account(alice.id()));
        BEAST_EXPECT(sle && sle->isFlag(lsfDisableMaster));
        BEAST_EXPECT(sle && (*sle)[~sfRegularKey] == first.id());
    }

    // The Batch signed by `current` that pays `amount` to `dst` and rotates
    // the RegularKey to `next`.
    static void
    submitRotation(
        jtx::Env& env,
        jtx::Account const& alice,
        jtx::Account const& dst,
        STAmount const& amount,
        jtx::Account const& current,
        jtx::Account const& next)
    {
        using namespace jtx;
        auto const seq = env.seq(alice);
        env(batch::outer(alice, seq, batch::calcBatchFee(env, 0, 2), tfAllOrNothing),
            batch::Inner(pay(alice, dst, amount), seq + 1),
            batch::Inner(regkey(alice, next), seq + 2),
            Sig(current),
            Ter(tesSUCCESS));
    }

    // Three rotations: each pays bob and installs the next key; the retired
    // key and the master key are refused afterwards.
    void
    testRotations(FeatureBitset features)
    {
        testcase("pay and rotate the RegularKey in one Batch");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"};
        std::array<Account, kRotations + 1> const keys{
            Account{"k1"}, Account{"k2"}, Account{"k3"}, Account{"k4"}};
        env.fund(XRP(10000), alice, bob);
        env.close();
        setupAccount(env, alice, keys[0]);

        for (std::size_t n = 0; n < kRotations; ++n)
        {
            auto const& current = keys[n];
            auto const& next = keys[n + 1];
            auto const aliceBalance = env.balance(alice);
            auto const bobBalance = env.balance(bob);
            auto const seq = env.seq(alice);
            auto const batchFee = batch::calcBatchFee(env, 0, 2);

            submitRotation(env, alice, bob, XRP(10), current, next);
            auto const outer = env.tx();
            env.close();

            // Both inner transactions were applied.
            BEAST_EXPECT(env.balance(bob) == bobBalance + XRP(10));
            BEAST_EXPECT(env.balance(alice) == aliceBalance - batchFee - XRP(10));
            BEAST_EXPECT(env.seq(alice) == seq + 3);
            auto const sle = env.le(keylet::account(alice.id()));
            if (!BEAST_EXPECT(sle))
                return;
            BEAST_EXPECT((*sle)[~sfRegularKey] == next.id());

            // The payment reveals the key it retires, never the next one.
            if (!BEAST_EXPECT(outer))
                return;
            BEAST_EXPECT(makeSlice(outer->getFieldVL(sfSigningPubKey)) == current.pk().slice());
            BEAST_EXPECT(!contains(serialized(*outer), next.pk().slice()));

            // The retired key and the master key no longer sign.
            env(pay(alice, bob, XRP(1)), Sig(current), Ter(tefBAD_AUTH));
            env(pay(alice, bob, XRP(1)), Sig(alice), Ter(tefMASTER_DISABLED));
            env.close();
            BEAST_EXPECT(env.seq(alice) == seq + 3);
        }

        // The last key still signs.
        env(pay(alice, bob, XRP(1)), Sig(keys[kRotations]));
        env.close();
    }

    // A Batch whose payment fails (a new account below the reserve,
    // tecNO_DST_INSUF_XRP) rotates nothing: no rotation without the payment.
    void
    testFailingPaymentKeepsKey(FeatureBitset features)
    {
        testcase("a failing payment leaves the RegularKey unchanged");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, carol{"carol"};
        Account const k1{"k1"}, k2{"k2"};
        env.fund(XRP(10000), alice);
        env.close();
        setupAccount(env, alice, k1);

        auto const balance = env.balance(alice);
        auto const seq = env.seq(alice);
        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        submitRotation(env, alice, carol, XRP(1), k1, k2);
        env.close();

        auto const sle = env.le(keylet::account(alice.id()));
        if (!BEAST_EXPECT(sle))
            return;
        BEAST_EXPECT((*sle)[~sfRegularKey] == k1.id());
        BEAST_EXPECT(!env.le(keylet::account(carol.id())));
        // Only the outer sequence and the outer fee are consumed.
        BEAST_EXPECT(env.seq(alice) == seq + 1);
        BEAST_EXPECT(env.balance(alice) == balance - batchFee);

        // k1 still signs, k2 does not.
        env(pay(alice, carol, XRP(1)), Sig(k2), Ter(tefBAD_AUTH));
        env(noop(alice), Sig(k1));
        env.close();
    }

    // The next key is installed by its AccountID alone: its public key
    // appears neither in the rotating transaction nor in the account root,
    // and is first revealed when that key signs.
    void
    testUnrevealedKey(FeatureBitset features)
    {
        testcase("rotate to a key whose public key was never revealed");
        using namespace jtx;

        Env env{*this, features};
        Account const alice{"alice"}, bob{"bob"};
        Account const k1{"k1"}, hidden{"hidden"}, k3{"k3"};
        env.fund(XRP(10000), alice, bob);
        env.close();
        setupAccount(env, alice, k1);

        submitRotation(env, alice, bob, XRP(1), k1, hidden);
        auto const rotation = env.tx();
        env.close();

        BEAST_EXPECT(sfRegularKey.fieldType == STI_ACCOUNT);
        auto const sle = env.le(keylet::account(alice.id()));
        if (!BEAST_EXPECT(sle && rotation))
            return;
        BEAST_EXPECT(sle->getAccountID(sfRegularKey) == hidden.id());
        BEAST_EXPECT(!contains(serialized(*sle), hidden.pk().slice()));
        BEAST_EXPECT(!contains(serialized(*rotation), hidden.pk().slice()));

        // The hidden key signs the next rotation, which reveals it.
        submitRotation(env, alice, bob, XRP(1), hidden, k3);
        auto const next = env.tx();
        env.close();
        BEAST_EXPECT((*env.le(keylet::account(alice.id())))[~sfRegularKey] == k3.id());
        if (BEAST_EXPECT(next))
            BEAST_EXPECT(makeSlice(next->getFieldVL(sfSigningPubKey)) == hidden.pk().slice());
    }

public:
    void
    run() override
    {
        using namespace jtx;
        auto const all = testableAmendments();
        testRotations(all);
        testFailingPaymentKeepsKey(all);
        testUnrevealedKey(all);
    }
};

BEAST_DEFINE_TESTSUITE(KeyRotationBatch, app, xrpl);

}  // namespace xrpl::test
