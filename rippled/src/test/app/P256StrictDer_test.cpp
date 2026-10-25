#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>
#include <test/jtx/amount.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/fee.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/multisign.h>
#include <test/jtx/pay.h>
#include <test/jtx/paychan.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>
#include <test/jtx/utility.h>
#include <test/jtx/webauthn.h>
#include <test/jtx/xchain_bridge.h>

#include <xrpld/app/main/Application.h>

#include <xrpl/basics/Blob.h>
#include <xrpl/basics/Buffer.h>
#include <xrpl/basics/StringUtilities.h>
#include <xrpl/basics/strHex.h>
#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/core/HashRouter.h>
#include <xrpl/json/json_value.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Issue.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/STXChainBridge.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/XChainAttestations.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/tx/apply.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace xrpl {

/**
 * fixP256StrictDer: a P-256 signature must be strict DER with a low S, on
 * every path a P-256 key signs (a single signature, a WebAuthn passkey
 * signature, a multi-signer). Before it, the lax parser accepts a second form
 * of each signature, (r, n - s), and the signature with a byte appended, so a
 * relay can change a transaction's hash. WebAuthn results use the software
 * authenticator of test/jtx/webauthn.h: SIMULATED, no device.
 */
class P256StrictDer_test : public beast::unit_test::Suite
{
    static constexpr char const* kPasskeyId = "DEADBEEF";

    // n, the order of the P-256 group, big-endian.
    static constexpr std::array<std::uint8_t, 32> kOrder = {
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17,
        0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
    };

    // The same DER signature with S replaced by n - S, minimally encoded.
    static Blob
    flipS(Blob const& der)
    {
        std::size_t const rLen = der[3];
        std::size_t const sLen = der[4 + rLen + 1];
        std::uint8_t const* sData = der.data() + 4 + rLen + 2;
        std::array<std::uint8_t, 32> s{};
        std::size_t const skip = sLen > 32 ? sLen - 32 : 0;
        std::memcpy(s.data() + 32 - (sLen - skip), sData + skip, sLen - skip);

        std::array<std::uint8_t, 32> flipped{};
        int borrow = 0;
        for (int i = 31; i >= 0; --i)
        {
            int const d = kOrder[i] - s[i] - borrow;
            borrow = d < 0 ? 1 : 0;
            flipped[i] = static_cast<std::uint8_t>(d + (borrow != 0 ? 256 : 0));
        }

        Blob body;
        std::size_t i = 0;
        while (i < 31 && flipped[i] == 0)
            ++i;
        if ((flipped[i] & 0x80) != 0)
            body.push_back(0x00);
        body.insert(body.end(), flipped.begin() + i, flipped.end());

        Blob out(der.begin(), der.begin() + 4 + rLen);
        out.push_back(0x02);
        out.push_back(static_cast<std::uint8_t>(body.size()));
        out.insert(out.end(), body.begin(), body.end());
        out[1] = static_cast<std::uint8_t>(out.size() - 2);
        return out;
    }

    // The same DER signature with one byte appended.
    static Blob
    appendByte(Blob der)
    {
        der.push_back(0x00);
        return der;
    }

    // The hex signature at `field` of `object`, changed by `change`.
    template <class Change>
    static void
    alter(json::Value& object, SField const& field, Change change)
    {
        auto const der = strUnHex(object[field.jsonName].asString());
        object[field.jsonName] = strHex(change(*der));
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

    // Refused by the signature check. checkForms has already checked the
    // signature once, so the answer is the cached verdict.
    static void
    expectRefused(test::jtx::JTx& jt)
    {
        jt.ter = telENV_RPC_FAILED;
        jt.rpcException = {
            "invalidTransaction", "fails local checks: Transaction has bad signature."};
    }

    // Each altered form verifies without the fix and not with it, under a
    // new transaction ID; submitted, the first one is applied without the
    // fix and refused with it, and then the original applies.
    void
    checkForms(
        test::jtx::Env& env,
        test::jtx::JTx const& jt,
        std::vector<test::jtx::JTx> altered,
        test::jtx::Account const& bob,
        bool strict)
    {
        using namespace test::jtx;
        auto& router = env.app().getHashRouter();
        auto const rules = env.current()->rules();
        for (auto const& variant : altered)
        {
            if (!BEAST_EXPECT(variant.stx))
                return;
            BEAST_EXPECT(variant.stx->getTransactionID() != jt.stx->getTransactionID());
            BEAST_EXPECT(
                checkValidity(router, *variant.stx, rules).first ==
                (strict ? Validity::SigBad : Validity::Valid));
        }

        auto const before = env.balance(bob);
        auto first = altered.front();
        if (strict)
            expectRefused(first);
        env.submit(first);
        env.close();
        BEAST_EXPECT(env.balance(bob) == before + (strict ? XRP(0) : XRP(10)));
        if (strict)
        {
            env.submit(jt);
            env.close();
            BEAST_EXPECT(env.balance(bob) == before + XRP(10));
        }
    }

    void
    testSingleSign(FeatureBitset features, bool strict)
    {
        testcase(std::string("single signature, ") + (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice", KeyType::P256};
        Account const bob{"bob"};
        env.fund(XRP(1000), alice, bob);
        env.close();

        auto const jt = env.jt(pay(alice, bob, XRP(10)));
        checkForms(
            env,
            jt,
            {edited(jt, [](json::Value& jv) { alter(jv, sfTxnSignature, flipS); }),
             edited(jt, [](json::Value& jv) { alter(jv, sfTxnSignature, appendByte); })},
            bob,
            strict);
    }

    void
    testWebAuthn(FeatureBitset features, bool strict)
    {
        testcase(std::string("WebAuthn signature, ") + (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        auto const jt = env.jt(pay(alice, bob, XRP(10)), WebAuthnSig(passkey, kPasskeyId));
        auto const inPasskey = [](auto change) {
            return [change](json::Value& jv) {
                alter(jv[sfPasskeySignature.jsonName], sfSignature, change);
            };
        };
        checkForms(
            env,
            jt,
            {edited(jt, inPasskey(flipS)), edited(jt, inPasskey(appendByte))},
            bob,
            strict);
    }

    void
    testMultiSign(FeatureBitset features, bool strict)
    {
        testcase(std::string("multi-signer, ") + (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const carol{"carol", KeyType::P256};
        env.fund(XRP(1000), alice, bob, carol);
        env.close();
        env(signers(alice, 1, {{carol, 1}}));
        env.close();

        auto const jt = env.jt(pay(alice, bob, XRP(10)), Msig(carol), Fee(XRP(1)));
        auto const inSigner = [](auto change) {
            return [change](json::Value& jv) {
                alter(jv[sfSigners.jsonName][0u][sfSigner.jsonName], sfTxnSignature, change);
            };
        };
        checkForms(
            env, jt, {edited(jt, inSigner(flipS)), edited(jt, inSigner(appendByte))}, bob, strict);
    }

    // A PasskeySignature next to a key that is not P-256, or next to a
    // multi-signature, is ignored by the signature check: before the fix,
    // anyone can add one to a signed transaction and give it a new ID.
    void
    testPasskeySignatureWithoutP256(FeatureBitset features, bool strict)
    {
        testcase(
            std::string("PasskeySignature without a P-256 key, ") + (strict ? "with" : "without") +
            " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const carol{"carol"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob, carol);
        env.close();
        env(passkeyListSet(bob, passkey, kPasskeyId));
        env(signers(bob, 1, {{carol, 1}}));
        env.close();

        // Any well-formed PasskeySignature: one bob's passkey made.
        auto const passkeySigned =
            env.jt(pay(bob, alice, XRP(1)), WebAuthnSig(passkey, kPasskeyId));
        auto const passkeySignature = passkeySigned.jv[sfPasskeySignature.jsonName];
        auto const withPasskeySignature = [&](json::Value& jv) {
            jv[sfPasskeySignature.jsonName] = passkeySignature;
        };

        auto const single = env.jt(pay(alice, bob, XRP(10)));
        auto const multi = env.jt(pay(bob, alice, XRP(10)), Msig(carol), Fee(XRP(1)));
        auto& router = env.app().getHashRouter();
        auto const rules = env.current()->rules();
        for (auto const* jt : {&single, &multi})
        {
            auto const variant = edited(*jt, withPasskeySignature);
            if (!BEAST_EXPECT(jt->stx && variant.stx))
                return;
            BEAST_EXPECT(variant.stx->getTransactionID() != jt->stx->getTransactionID());
            BEAST_EXPECT(!isSignatureVerdictCacheable(*variant.stx, rules) == !strict);
            BEAST_EXPECT(
                checkValidity(router, *variant.stx, rules).first ==
                (strict ? Validity::SigBad : Validity::Valid));
            BEAST_EXPECT(checkValidity(router, *jt->stx, rules).first == Validity::Valid);
        }
    }

    // A transaction signed through WebAuthn is checked through its
    // PasskeySignature only: a TxnSignature next to it is ignored, so before
    // the fix anyone can add one and give the transaction a new ID.
    void
    testTxnSignatureNextToPasskey(FeatureBitset features, bool strict)
    {
        testcase(
            std::string("TxnSignature next to a PasskeySignature, ") +
            (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const passkey{"passkey", KeyType::P256};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();

        auto const jt = env.jt(pay(alice, bob, XRP(10)), WebAuthnSig(passkey, kPasskeyId));
        auto const variant =
            edited(jt, [](json::Value& jv) { jv[sfTxnSignature.jsonName] = "3006020101020101"; });
        if (!BEAST_EXPECT(jt.stx && variant.stx))
            return;
        BEAST_EXPECT(variant.stx->getTransactionID() != jt.stx->getTransactionID());
        auto& router = env.app().getHashRouter();
        auto const rules = env.current()->rules();
        BEAST_EXPECT(
            checkValidity(router, *variant.stx, rules).first ==
            (strict ? Validity::SigBad : Validity::Valid));
        BEAST_EXPECT(checkValidity(router, *jt.stx, rules).first == Validity::Valid);
    }

    // No verdict on a P-256 signature crosses the activation, in either
    // direction; a secp256k1 signature is cached as before.
    void
    testCacheAcrossTheFix(FeatureBitset features)
    {
        testcase("no P-256 signature verdict crosses the fix");
        using namespace test::jtx;

        Env preFix{*this, envconfig(), features - fixP256StrictDer};
        Env postFix{*this, envconfig(), features};
        auto const preFixRules = preFix.current()->rules();
        auto const postFixRules = postFix.current()->rules();

        Account const alice{"alice", KeyType::P256};
        Account const bob{"bob"};
        postFix.fund(XRP(1000), alice, bob);
        postFix.close();

        auto const jt = postFix.jt(pay(alice, bob, XRP(10)));
        auto const highS = edited(jt, [](json::Value& jv) { alter(jv, sfTxnSignature, flipS); });
        auto const master = postFix.jt(pay(bob, alice, XRP(10)));
        if (!BEAST_EXPECT(jt.stx && highS.stx && master.stx))
            return;

        BEAST_EXPECT(!isSignatureVerdictCacheable(*jt.stx, preFixRules));
        BEAST_EXPECT(!isSignatureVerdictCacheable(*highS.stx, preFixRules));
        BEAST_EXPECT(isSignatureVerdictCacheable(*jt.stx, postFixRules));
        BEAST_EXPECT(isSignatureVerdictCacheable(*master.stx, preFixRules));

        auto& router = postFix.app().getHashRouter();
        // Before the fix the high-S form verifies, and no verdict is kept, so
        // the fix refuses it; the bad verdict the fix keeps is not read by a
        // check that still uses the old rules, as on a node whose validated
        // rules lag its open ledger at the flag ledger.
        BEAST_EXPECT(checkValidity(router, *highS.stx, preFixRules).first == Validity::Valid);
        BEAST_EXPECT(checkValidity(router, *highS.stx, postFixRules).first == Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *highS.stx, preFixRules).first == Validity::Valid);
    }

    // A session's witness co-signs through STTx::checkSign, in its own role:
    // its high-S form verifies only without the fix, and without the fix a
    // P-256 witness is not accepted by the ledger anyway.
    void
    testSessionWitness(FeatureBitset features, bool strict)
    {
        testcase(std::string("session witness, ") + (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const key{"key"};
        Account const witness{"witness", KeyType::P256};
        env.fund(XRP(10000), alice, bob, witness);
        env.close();
        env(session::set(alice, key, 600), Txflags(tfAllTransactions), session::Witness(witness));
        env.close();

        auto const jt = env.jt(
            pay(alice, bob, XRP(10)),
            Sig(key),
            Sig(sfWitnessSignature, witness),
            LastLedgerSeq(env.current()->seq() + 10));
        auto const highS = edited(jt, [](json::Value& jv) {
            alter(jv[sfWitnessSignature.jsonName], sfTxnSignature, flipS);
        });
        if (!BEAST_EXPECT(jt.stx && highS.stx))
            return;

        auto& router = env.app().getHashRouter();
        auto const rules = env.current()->rules();
        BEAST_EXPECT(highS.stx->getTransactionID() != jt.stx->getTransactionID());
        BEAST_EXPECT(checkValidity(router, *jt.stx, rules).first == Validity::Valid);
        BEAST_EXPECT(
            checkValidity(router, *highS.stx, rules).first ==
            (strict ? Validity::SigBad : Validity::Valid));

        // Without the fix a P-256 witness does not co-sign at all
        // (isSessionKeyTypeEnabled): the ledger refuses it before the form of
        // its signature matters.
        auto const before = env.balance(bob);
        auto original = jt;
        if (!strict)
            original.ter = tefSESSION_NO_WITNESS;
        env.submit(original);
        env.close();
        BEAST_EXPECT(env.balance(bob) == before + (strict ? XRP(10) : XRP(0)));
    }

    // A payment channel claim signed by a P-256 channel key: the claim's
    // Signature is not a signing field and is checked in preflight, outside
    // STTx::checkSign. Without the fix its high-S form and its form with a
    // byte appended are accepted, under a new transaction ID; with it they are
    // temBAD_SIGNATURE, and channel_verify answers as the claim is checked.
    void
    testPayChanClaim(FeatureBitset features, bool strict)
    {
        testcase(
            std::string("payment channel claim, ") + (strict ? "with" : "without") + " the fix");
        using namespace test::jtx;
        using namespace std::chrono_literals;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const channelKey{"channelKey", KeyType::P256};
        env.fund(XRP(10000), alice, bob);
        env.close();

        auto const chan = paychan::channel(alice, bob, env.seq(alice));
        env(paychan::create(alice, bob, XRP(1000), 100s, channelKey.pk()));
        env.close();

        auto const authorize = [&](STAmount const& amount) {
            auto const sig = paychan::signClaimAuth(channelKey.pk(), channelKey.sk(), chan, amount);
            return Blob(sig.data(), sig.data() + sig.size());
        };
        auto const claim = [&](STAmount const& amount, Blob const& sig) {
            return paychan::claim(bob, chan, amount, amount, makeSlice(sig), channelKey.pk());
        };
        auto const verified = [&](STAmount const& amount, Blob const& sig) {
            auto const rv = env.rpc(
                "channel_verify",
                strHex(channelKey.pk().slice()),
                to_string(chan),
                std::to_string(amount.xrp().drops()),
                strHex(sig));
            return rv[jss::result][jss::signature_verified].asBool();
        };
        auto const expected = strict ? Ter(temBAD_SIGNATURE) : Ter(tesSUCCESS);

        auto const first = authorize(XRP(10));
        BEAST_EXPECT(verified(XRP(10), first));
        BEAST_EXPECT(verified(XRP(10), flipS(first)) == !strict);
        BEAST_EXPECT(verified(XRP(10), appendByte(first)) == !strict);
        env(claim(XRP(10), flipS(first)), expected);
        env.close();
        BEAST_EXPECT(paychan::channelBalance(*env.current(), chan) == (strict ? XRP(0) : XRP(10)));

        auto const second = authorize(XRP(20));
        env(claim(XRP(20), appendByte(second)), expected);
        env.close();
        BEAST_EXPECT(paychan::channelBalance(*env.current(), chan) == (strict ? XRP(0) : XRP(20)));

        // The canonical form is accepted either way.
        env(claim(XRP(30), authorize(XRP(30))));
        env.close();
        BEAST_EXPECT(paychan::channelBalance(*env.current(), chan) == XRP(30));
    }

    // A cross-chain attestation by a P-256 key is checked in preflight with
    // AttestationBase::verify, which now takes the rules: the high-S form
    // verifies only without the fix.
    void
    testXChainAttestation()
    {
        testcase("cross-chain attestation");
        using namespace test::jtx;

        Account const lockingDoor{"lockingDoor"};
        Account const issuingDoor{"issuingDoor"};
        Account const signer{"signer", KeyType::P256};
        Account const sender{"sender"};
        Account const reward{"reward"};
        STXChainBridge const bridge{lockingDoor.id(), xrpIssue(), issuingDoor.id(), xrpIssue()};

        attestations::AttestationClaim const att{
            bridge,
            signer.id(),
            signer.pk(),
            signer.sk(),
            sender.id(),
            XRP(1),
            reward.id(),
            true,
            1,
            std::nullopt};
        Blob const der(att.signature.data(), att.signature.data() + att.signature.size());
        Blob const highS = flipS(der);
        attestations::AttestationClaim const flipped{
            signer.id(),
            signer.pk(),
            Buffer(highS.data(), highS.size()),
            sender.id(),
            XRP(1),
            reward.id(),
            true,
            1,
            std::nullopt};

        BEAST_EXPECT(att.verify(bridge, false));
        BEAST_EXPECT(att.verify(bridge, true));
        BEAST_EXPECT(flipped.verify(bridge, false));
        BEAST_EXPECT(!flipped.verify(bridge, true));
    }

    // The same check as a transaction: attestationPreflight passes the rules
    // to AttestationBase::verify. With the fix a high-S P-256 attestation is
    // temXCHAIN_BAD_PROOF in preflight; without it, it passes preflight and
    // fails at the bridge lookup (there is no bridge here).
    void
    testXChainAttestationTx(FeatureBitset features, bool strict)
    {
        testcase(
            std::string("cross-chain attestation transaction, ") + (strict ? "with" : "without") +
            " the fix");
        using namespace test::jtx;

        Env env{*this, envconfig(), strict ? features : features - fixP256StrictDer};
        Account const submitter{"submitter"};
        Account const lockingDoor{"lockingDoor"};
        Account const issuingDoor{"issuingDoor"};
        Account const sender{"sender"};
        Account const reward{"reward"};
        Account const signer{"signer", KeyType::P256};
        env.fund(XRP(10000), submitter, lockingDoor, issuingDoor, reward);
        env.close();

        auto const jvBridge = bridge(lockingDoor, xrpIssue(), issuingDoor, xrpIssue());
        auto jv = claimAttestation(
            submitter, jvBridge, sender, XRP(1), reward, true, 1, std::nullopt, Signer(signer));
        alter(jv, sfSignature, flipS);
        env(jv, strict ? Ter(temXCHAIN_BAD_PROOF) : Ter(tecNO_ENTRY));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();
        for (bool const strict : {false, true})
        {
            testSingleSign(all, strict);
            testWebAuthn(all, strict);
            testMultiSign(all, strict);
            testPasskeySignatureWithoutP256(all, strict);
            testTxnSignatureNextToPasskey(all, strict);
            testPayChanClaim(all, strict);
            testSessionWitness(all, strict);
            testXChainAttestationTx(all, strict);
        }
        testCacheAcrossTheFix(all);
        testXChainAttestation();
    }
};

BEAST_DEFINE_TESTSUITE(P256StrictDer, app, xrpl);

}  // namespace xrpl
