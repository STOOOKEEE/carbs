#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>
#include <test/jtx/amount.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/flags.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/rpc.h>
#include <test/jtx/seq.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>
#include <test/jtx/utility.h>
#include <test/jtx/webauthn.h>

#include <xrpld/app/misc/Transaction.h>

#include <xrpl/basics/Blob.h>
#include <xrpl/basics/StringUtilities.h>
#include <xrpl/basics/strHex.h>
#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/core/HashRouter.h>
#include <xrpl/json/json_value.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/server/NetworkOPs.h>
#include <xrpl/tx/apply.h>

#include <memory>
#include <string>
#include <utility>

namespace xrpl {

/**
 * PasskeyMLDSA: post-quantum passkeys. A passkey list may hold ML-DSA-44
 * public keys (1 312 bytes, no prefix), and a PasskeySignature made with an
 * ML-DSA-44 key (WebAuthn / COSE algorithm -48) is verified as a P-256 one is,
 * the signature over AuthenticatorData followed by the SHA-256 of
 * ClientDataJSON being pure ML-DSA-44 with an empty context. Results use the
 * software authenticator of test/jtx/webauthn.h: SIMULATED, no device and no
 * browser ceremony.
 */
class PasskeyMLDSA_test : public beast::unit_test::Suite
{
    static constexpr char const* kPasskeyId = "DEADBEEF";
    static constexpr char const* kOtherPasskeyId = "CAFE";

    // The answer of submit to a transaction whose signature does not verify,
    // on the first check of its ID (or on every check, when the verdict is
    // not kept).
    static test::jtx::Rpc
    invalidSignature()
    {
        return test::jtx::Rpc("invalidTransaction", "fails local checks: Invalid signature.");
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

    // A copy of `jt` whose transaction is rebuilt from its edited JSON.
    template <class Edit>
    static test::jtx::JTx
    edited(test::jtx::JTx const& jt, Edit edit)
    {
        test::jtx::JTx copy = jt;
        edit(copy.jv);
        copy.stx = std::make_shared<STTx const>(test::jtx::parse(copy.jv));
        return copy;
    }

    // Fund alice and bob, and register `passkey` for alice.
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

    void
    testListSet(FeatureBitset features)
    {
        testcase("PasskeyListSet takes an ML-DSA-44 key only with the amendment");
        using namespace test::jtx;

        Account const pq{"pq", KeyType::Dilithium};
        Account const p256{"p256", KeyType::P256};
        BEAST_EXPECT(pq.pk().size() == 1312);

        // Without PasskeyMLDSA, or without one of the amendments it needs,
        // an ML-DSA-44 key is refused as before; a P-256 key is not.
        for (auto const& without : {featurePasskeyMLDSA, featureQuantum})
        {
            Env env{*this, envconfig(), features - without};
            Account const alice{"alice"};
            env.fund(XRP(1000), alice);
            env.close();
            env(passkeyListSet(alice, pq, kPasskeyId), Ter(temMALFORMED));
            env(passkeyListSet(alice, {{pq, kPasskeyId}, {p256, kOtherPasskeyId}}),
                Ter(temMALFORMED));
            env(passkeyListSet(alice, p256, kPasskeyId));
            env.close();
        }

        // With it, an ML-DSA-44 key is registered alone or next to a P-256
        // key, and stored as given.
        {
            Env env{*this, envconfig(), features};
            Account const alice{"alice"};
            Account const carol{"carol"};
            env.fund(XRP(1000), alice, carol);
            env.close();
            env(passkeyListSet(alice, pq, kPasskeyId));
            env(passkeyListSet(carol, {{p256, kPasskeyId}, {pq, kOtherPasskeyId}}));
            env.close();
            auto const list = env.le(keylet::passkeyList(alice.id()));
            if (BEAST_EXPECT(list))
            {
                auto const& passkeys = list->getFieldArray(sfPasskeys);
                BEAST_EXPECT(passkeys.size() == 1);
                BEAST_EXPECT(
                    passkeys[0].getFieldVL(sfPublicKey) ==
                    Blob(pq.pk().data(), pq.pk().data() + pq.pk().size()));
            }
            BEAST_EXPECT(env.le(keylet::passkeyList(carol.id())));

            // A value of another size is no key, whatever the amendment.
            Env env2{*this, envconfig(), features};
            Account const dave{"dave"};
            env2.fund(XRP(1000), dave);
            env2.close();
            auto jv = passkeyListSet(dave, pq, kPasskeyId);
            auto& pk = jv[sfPasskeys.jsonName][0u][sfPasskey.jsonName][sfPublicKey.jsonName];
            pk = pk.asString().substr(2);
            env2(jv, Ter(temMALFORMED));
        }
    }

    void
    testSignatureBeforeAmendment(FeatureBitset features)
    {
        testcase("an ML-DSA-44 PasskeySignature is refused without the amendment");
        using namespace test::jtx;

        // The ML-DSA-44 key is alice's own master key, so no passkey list is
        // needed: only the signature check is exercised. Each amendment
        // PasskeyMLDSA needs is removed in turn, with and without
        // fixP256StrictDer, which changes why it is refused (a
        // PasskeySignature next to a key that may not carry one; without the
        // fix, the PasskeySignature is ignored and there is no TxnSignature).
        for (auto const& without : {featurePasskeyMLDSA, featureQuantum, featurePasskey})
        {
            for (bool const strict : {true, false})
            {
                auto const rules =
                    strict ? features - without : features - without - fixP256StrictDer;
                Env env{*this, envconfig(), rules};
                Account const alice{"alice", KeyType::Dilithium};
                Account const bob{"bob"};
                env.fund(XRP(1000), alice, bob);
                env.close();

                env(pay(alice, bob, XRP(10)), WebAuthnSig(alice, kPasskeyId), invalidSignature());
                // Not cached: the same answer, not "Transaction has bad
                // signature.", on a second submission.
                auto jt = env.jt(pay(alice, bob, XRP(10)), WebAuthnSig(alice, kPasskeyId));
                expectRefused(jt);
                env.submit(jt);
                env.submit(jt);
                env.close();
                BEAST_EXPECT(env.balance(bob) == XRP(1000));
            }
        }
    }

    void
    testPayment(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey pays through WebAuthn");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        auto const jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        if (!BEAST_EXPECT(jt.stx))
            return;
        // The wire format: an ML-DSA-44 SigningPubKey, no TxnSignature, and
        // a 2 420-byte signature in the PasskeySignature.
        BEAST_EXPECT(jt.stx->getSigningPubKey().size() == 1312);
        BEAST_EXPECT(!jt.stx->isFieldPresent(sfTxnSignature));
        BEAST_EXPECT(
            jt.stx->getFieldObject(sfPasskeySignature).getFieldVL(sfSignature).size() == 2420);
        BEAST_EXPECT(STTx::getSignature(*jt.stx).size() == 2420);

        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));

        // As a P-256 passkey, the key of the list may also sign without
        // WebAuthn: a passkey has full authority over the account.
        env(pay(alice, bob, XRP(1)), Sig(pq));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1101));
    }

    void
    testBadAssertions(FeatureBitset features)
    {
        testcase("ML-DSA-44 assertions that do not match the transaction");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // A challenge over other bytes: the signing data of another payment.
        {
            auto other = env.jt(pay(alice, bob, XRP(1)), WebAuthnSig(pq, kPasskeyId));
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(pq, kPasskeyId, {.challenge = signingData(other.jv)}),
                invalidSignature());
        }

        // A registration ceremony instead of an assertion.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.type = "webauthn.create"}),
            invalidSignature());

        // No challenge at all.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.omitChallenge = true}),
            invalidSignature());

        // A signature that does not verify.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.alterSignature = true}),
            invalidSignature());

        // AuthenticatorData changed after signing.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.alterAuthenticatorData = true}),
            invalidSignature());

        auto const jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto const inPasskey = [](SField const& field, auto change) {
            return [&field, change](json::Value& jv) {
                auto& object = jv[sfPasskeySignature.jsonName];
                auto bytes = *strUnHex(object[field.jsonName].asString());
                change(bytes);
                object[field.jsonName] = strHex(bytes);
            };
        };
        auto const rules = env.current()->rules();
        auto const refusedForms = {
            // A truncated signature: ML-DSA-44 signatures are 2 420 bytes.
            edited(jt, inPasskey(sfSignature, [](Blob& b) { b.pop_back(); })),
            // A signature with a byte appended.
            edited(jt, inPasskey(sfSignature, [](Blob& b) { b.push_back(0); })),
            // A TxnSignature next to the PasskeySignature: it would only
            // change the transaction's ID.
            edited(jt, [&](json::Value& jv) { jv[sfTxnSignature.jsonName] = "00"; }),
            // A P-256 DER signature in place of the ML-DSA-44 one.
            edited(
                jt,
                [](json::Value& jv) {
                    jv[sfPasskeySignature.jsonName][sfSignature.jsonName] = "3006020101020101";
                }),
        };
        for (auto const& variant : refusedForms)
        {
            if (!BEAST_EXPECT(variant.stx))
                return;
            BEAST_EXPECT(variant.stx->getTransactionID() != jt.stx->getTransactionID());
            BEAST_EXPECT(!variant.stx->checkSign(rules));
        }

        // A TxnSignature next to it, even a valid one by the same key, is
        // refused.
        {
            auto const raw = env.jt(pay(alice, bob, XRP(100)), Sig(pq));
            auto const both = edited(jt, [&](json::Value& jv) {
                jv[sfTxnSignature.jsonName] = raw.jv[sfTxnSignature.jsonName];
            });
            if (BEAST_EXPECT(raw.stx && both.stx))
            {
                BEAST_EXPECT(raw.stx->checkSign(rules));
                BEAST_EXPECT(!both.stx->checkSign(rules));
            }
        }

        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1000));

        // The control: the same payment, nothing altered.
        BEAST_EXPECT(jt.stx->checkSign(rules));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testNotInList(FeatureBitset features)
    {
        testcase("an ML-DSA-44 key that is not in the list has no authority");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        Account const stranger{"stranger", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // The assertion verifies, so the refusal is the ledger's.
        env(pay(alice, bob, XRP(100)), WebAuthnSig(stranger, kPasskeyId), Ter(tefBAD_AUTH));
        // alice's passkey does not sign for bob, who has no list.
        env(pay(bob, alice, XRP(100)), WebAuthnSig(pq, kPasskeyId), Ter(tefBAD_AUTH));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1000));
    }

    void
    testPasskeyIdBound(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey signature is bound to its list entry");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // Another PasskeyID than the one registered with the key: the
        // assertion verifies (the PasskeyID is not signed), the transaction
        // has another ID, and the ledger refuses it.
        auto const good = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        auto const other = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kOtherPasskeyId));
        if (!BEAST_EXPECT(good.stx && other.stx))
            return;
        BEAST_EXPECT(good.stx->getTransactionID() != other.stx->getTransactionID());
        BEAST_EXPECT(other.stx->checkSign(env.current()->rules()));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kOtherPasskeyId), Ter(tefBAD_AUTH));

        // An ML-DSA-44 master key, or RegularKey, signing through WebAuthn:
        // not a passkey of the list, so not authorized, although the same key
        // signs with a TxnSignature.
        Account const carol{"carol", KeyType::Dilithium};
        Account const regular{"regular", KeyType::Dilithium};
        env.fund(XRP(1000), carol);
        env.close();
        env(pay(carol, bob, XRP(1)), WebAuthnSig(carol, kPasskeyId), Ter(tefBAD_AUTH));
        env(pay(carol, bob, XRP(1)));
        env(regkey(alice, regular));
        env.close();
        env(pay(alice, bob, XRP(1)), WebAuthnSig(regular, kPasskeyId), Ter(tefBAD_AUTH));
        env(pay(alice, bob, XRP(1)), Sig(regular));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1002));

        // The control.
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1102));
    }

    void
    testChallengeAsBytes(FeatureBitset features)
    {
        testcase("the ML-DSA-44 path compares the challenge as bytes");
        using namespace test::jtx;

        // The signing data holds a 1 312-byte key, with bytes at or above
        // 0x80; the ML-DSA-44 path is new and always compares bytes, so it
        // does not depend on fixPasskeyChallenge.
        Env env{*this, envconfig(), features - fixPasskeyChallenge};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testFullyPostQuantum(FeatureBitset features)
    {
        testcase("an account whose only authority is an ML-DSA-44 passkey");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // The RegularKey is the black hole address, whose key nobody holds;
        // then the master key is disabled.
        json::Value blackhole;
        blackhole[jss::Account] = alice.human();
        blackhole[jss::TransactionType] = jss::SetRegularKey;
        blackhole[sfRegularKey.jsonName] = toBase58(noAccount());
        env(blackhole);
        env(fset(alice, asfDisableMaster), Sig(alice));
        env.close();

        env(pay(alice, bob, XRP(1)), Sig(alice), Ter(tefMASTER_DISABLED));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));

        // The passkey keeps full authority: it can still change the account.
        env(fset(alice, asfRequireDest), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.le(alice)->isFlag(lsfRequireDestTag));
    }

    void
    testSession(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey opens and closes a signing session");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        Account const key{"session", KeyType::Dilithium};
        setUp(env, alice, bob, pq);
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // The passkey itself cannot be a session key.
        env(session::set(alice, pq, 600),
            Txflags(tfAllTransactions),
            WebAuthnSig(pq, kPasskeyId),
            Ter(tecNO_PERMISSION));

        env(session::set(alice, key, 600),
            session::Permissions({"Payment"}),
            WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.le(keylet::signingSession(alice.id(), key.id())));

        // The session key signs a payment. Through WebAuthn its ML-DSA-44 key
        // does not: an ML-DSA-44 passkey signature authorizes only through
        // the passkey list.
        env(pay(alice, bob, XRP(1)), Sig(key), lls());
        env(pay(alice, bob, XRP(1)), WebAuthnSig(key, kOtherPasskeyId), lls(), Ter(tefBAD_AUTH));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1001));

        // The passkey closes it, as any key with full authority.
        env(session::del(alice, key), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(!env.le(keylet::signingSession(alice.id(), key.id())));
        env(pay(alice, bob, XRP(1)), Sig(key), lls(), Ter(tefBAD_AUTH));
    }

    void
    testP256Unchanged(FeatureBitset features)
    {
        testcase("P-256 passkeys are unchanged by the amendment");
        using namespace test::jtx;

        for (bool const enabled : {false, true})
        {
            Env env{*this, envconfig(), enabled ? features : features - featurePasskeyMLDSA};
            Account const alice{"alice"};
            Account const bob{"bob"};
            Account const p256{"p256", KeyType::P256};
            setUp(env, alice, bob, p256);
            env(pay(alice, bob, XRP(100)), WebAuthnSig(p256, kPasskeyId));
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(p256, kPasskeyId, {.alterSignature = true}),
                invalidSignature());
            env.close();
            BEAST_EXPECT(env.balance(bob) == XRP(1100));
        }

        // Both kinds in one list, each signing.
        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const p256{"p256", KeyType::P256};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, {{p256, kPasskeyId}, {pq, kOtherPasskeyId}}));
        env.close();
        env(pay(alice, bob, XRP(10)), WebAuthnSig(p256, kPasskeyId));
        env(pay(alice, bob, XRP(10)), WebAuthnSig(pq, kOtherPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1020));
    }

    void
    testActivation(FeatureBitset features)
    {
        testcase("a blob refused before the amendment is accepted after it");
        using namespace test::jtx;

        // The same signed blob is submitted before and after the amendment.
        // A bad verdict cached before it would refuse the blob after it. The
        // passkey can only be registered after the amendment, so the blob
        // takes the sequence that follows the registration.
        Env env{*this, envconfig(), features - featurePasskeyMLDSA};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();

        auto jt =
            env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId), Seq(env.seq(alice) + 1));
        expectRefused(jt);
        env.submit(jt);
        env.close();

        env.enableFeature(featurePasskeyMLDSA);
        env.close();
        BEAST_EXPECT(env.current()->rules().enabled(featurePasskeyMLDSA));
        env(passkeyListSet(alice, pq, kPasskeyId));
        env.close();
        expectApplied(jt);
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testCacheableCondition(FeatureBitset features)
    {
        testcase("which signature verdicts are kept before the amendment");
        using namespace test::jtx;

        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env noQuantum{*this, envconfig(), features - featureQuantum};
        Env post{*this, envconfig(), features};
        auto const preRules = pre.current()->rules();
        auto const noQuantumRules = noQuantum.current()->rules();
        auto const postRules = post.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();

        // An ML-DSA-44 SigningPubKey with a PasskeySignature: kept only once
        // the amendment, and the ones it needs, are enabled.
        auto const webAuthn = post.jt(pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId));
        if (!BEAST_EXPECT(webAuthn.stx))
            return;
        BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, preRules));
        BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, noQuantumRules));
        BEAST_EXPECT(isSignatureVerdictCacheable(*webAuthn.stx, postRules));

        // The same key signing without WebAuthn: unchanged, kept.
        auto const raw = post.jt(pay(alice, bob, XRP(1)));
        if (!BEAST_EXPECT(raw.stx))
            return;
        BEAST_EXPECT(isSignatureVerdictCacheable(*raw.stx, preRules));

        // The PasskeySignature next to a secp256k1 key: unchanged, kept (the
        // amendment does not touch that path).
        Account const carol{"carol"};
        auto const secp = edited(webAuthn, [&](json::Value& jv) {
            jv[jss::SigningPubKey] = strHex(carol.pk().slice());
        });
        if (!BEAST_EXPECT(secp.stx))
            return;
        BEAST_EXPECT(isSignatureVerdictCacheable(*secp.stx, preRules));
    }

    void
    testCacheAcrossActivation(FeatureBitset features)
    {
        testcase("no ML-DSA-44 PasskeySignature verdict crosses the amendment");
        using namespace test::jtx;

        // Two environments give the rules on each side of the amendment, and
        // one router holds the verdicts, as on a node whose validated rules
        // lag its open ledger at the flag ledger.
        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env post{*this, envconfig(), features};
        Env preLax{*this, envconfig(), features - featurePasskeyMLDSA - fixP256StrictDer};
        Env postLax{*this, envconfig(), features - fixP256StrictDer};
        auto const preRules = pre.current()->rules();
        auto const postRules = post.current()->rules();
        auto const preLaxRules = preLax.current()->rules();
        auto const postLaxRules = postLax.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();
        auto& router = post.app().getHashRouter();

        // Refused before, accepted after: a bad verdict must not be kept.
        auto const webAuthn = post.jt(pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId));
        if (!BEAST_EXPECT(webAuthn.stx))
            return;
        auto const id = webAuthn.stx->getTransactionID();
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, preRules).first == Validity::SigBad);
        BEAST_EXPECT(router.getFlags(id) == HashRouterFlags::UNDEFINED);
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, postRules).first == Validity::Valid);
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, preRules).first == Validity::SigBad);

        // Accepted before, refused after: without fixP256StrictDer, a
        // PasskeySignature next to an ML-DSA-44 key is ignored before the
        // amendment, so a valid TxnSignature carries the transaction; after
        // it, the PasskeySignature is checked and a TxnSignature next to it
        // is refused. A good verdict must not be kept either.
        auto const raw = post.jt(pay(alice, bob, XRP(2)));
        if (!BEAST_EXPECT(raw.stx))
            return;
        auto const both = edited(raw, [&](json::Value& jv) {
            jv[sfPasskeySignature.jsonName] = webAuthn.jv[sfPasskeySignature.jsonName];
        });
        if (!BEAST_EXPECT(both.stx))
            return;
        BEAST_EXPECT(checkValidity(router, *both.stx, preLaxRules).first == Validity::Valid);
        BEAST_EXPECT(checkValidity(router, *both.stx, postLaxRules).first == Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *both.stx, preLaxRules).first == Validity::Valid);
    }

    void
    testForcedVerdict(FeatureBitset features)
    {
        testcase("a forced verdict holds on both sides of the amendment");
        using namespace test::jtx;

        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env post{*this, envconfig(), features};
        auto const preRules = pre.current()->rules();
        auto const postRules = post.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();

        // A signature that verifies in no era: only the forced verdict can
        // make the checks below pass.
        auto const jt = post.jt(
            pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId, {.alterSignature = true}));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto& router = pre.app().getHashRouter();
        forceValidity(router, jt.stx->getTransactionID(), Validity::SigGoodOnly);
        BEAST_EXPECT(checkValidity(router, *jt.stx, preRules).first != Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *jt.stx, postRules).first != Validity::SigBad);
    }

    void
    testNetworkOPsDoesNotMarkBad(FeatureBitset features)
    {
        testcase("NetworkOPs does not mark an ML-DSA-44 PasskeySignature bad before the amendment");
        using namespace test::jtx;

        Env env{*this, envconfig(), features - featurePasskeyMLDSA};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();

        auto jt =
            env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId), Seq(env.seq(alice) + 1));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto const id = jt.stx->getTransactionID();

        std::string reason;
        auto tx = std::make_shared<Transaction>(jt.stx, reason, env.app());
        env.app().getOPs().processTransaction(tx, false, true, NetworkOPs::FailHard::No);
        BEAST_EXPECT(tx->getResult() == temBAD_SIGNATURE);
        BEAST_EXPECT(!any(env.app().getHashRouter().getFlags(id) & HashRouterFlags::BAD));

        env.enableFeature(featurePasskeyMLDSA);
        env.close();
        env(passkeyListSet(alice, pq, kPasskeyId));
        env.close();
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();

        testListSet(all);
        testSignatureBeforeAmendment(all);
        testPayment(all);
        testPayment(all - fixP256StrictDer);
        testBadAssertions(all);
        testBadAssertions(all - fixP256StrictDer);
        testNotInList(all);
        testPasskeyIdBound(all);
        testChallengeAsBytes(all);
        testFullyPostQuantum(all);
        testSession(all);
        testP256Unchanged(all);
        testActivation(all);
        testCacheableCondition(all);
        testCacheAcrossActivation(all);
        testForcedVerdict(all);
        testNetworkOPsDoesNotMarkBad(all);
    }
};

BEAST_DEFINE_TESTSUITE(PasskeyMLDSA, app, xrpl);

}  // namespace xrpl
