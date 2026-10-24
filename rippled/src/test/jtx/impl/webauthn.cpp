#include <test/jtx/webauthn.h>

#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>
#include <test/jtx/utility.h>

#include <xrpl/basics/Blob.h>
#include <xrpl/basics/Slice.h>
#include <xrpl/basics/base64.h>
#include <xrpl/basics/contract.h>
#include <xrpl/basics/strHex.h>
#include <xrpl/json/json_value.h>
#include <xrpl/protocol/HashPrefix.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/SecretKey.h>
#include <xrpl/protocol/Serializer.h>
#include <xrpl/protocol/digest.h>
#include <xrpl/protocol/jss.h>

#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>

namespace xrpl::test::jtx {

namespace {

// The relying party a browser would name in the assertion. The ledger does
// not check it; it only has to be the same in AuthenticatorData every time.
constexpr char const* kRelyingPartyId = "localhost";
constexpr char const* kOrigin = "https://localhost";

// AuthenticatorData flags: user present (UP) and user verified (UV).
constexpr std::uint8_t kFlagsUserPresentVerified = 0x05;

// RP ID hash (32 bytes), flags (1 byte), signature counter (4 bytes,
// big-endian): the 37-byte AuthenticatorData of an assertion.
Blob
authenticatorData()
{
    auto const rpIdHash = sha256(makeSlice(std::string(kRelyingPartyId)));
    Blob data(rpIdHash.begin(), rpIdHash.end());
    data.push_back(kFlagsUserPresentVerified);
    data.insert(data.end(), {0x00, 0x00, 0x00, 0x01});
    return data;
}

}  // namespace

std::string
base64urlEncode(Slice const& data)
{
    std::string text = base64Encode(data.data(), data.size());
    for (auto& c : text)
    {
        if (c == '+')
            c = '-';
        else if (c == '/')
            c = '_';
    }
    while (!text.empty() && text.back() == '=')
        text.pop_back();
    return text;
}

json::Value
passkeyListSet(Account const& account, Account const& passkey, std::string const& passkeyId)
{
    json::Value jv;
    jv[sfAccount.jsonName] = account.human();
    jv[sfTransactionType.jsonName] = jss::PasskeyListSet;
    jv[sfPasskeys.jsonName] = json::ValueType::Array;
    jv[sfPasskeys.jsonName][0u][sfPasskey.jsonName][sfPasskeyID.jsonName] = passkeyId;
    jv[sfPasskeys.jsonName][0u][sfPasskey.jsonName][sfPublicKey.jsonName] = strHex(passkey.pk());
    return jv;
}

Blob
signingData(json::Value const& jv)
{
    Serializer s;
    s.add32(HashPrefix::TxSign);
    parse(jv).addWithoutSigningFields(s);
    return s.getData();
}

void
webAuthnSign(
    json::Value& jv,
    Account const& passkey,
    std::string const& passkeyId,
    WebAuthnOptions const& options)
{
    if (publicKeyType(passkey.pk()) != KeyType::P256)
        Throw<std::runtime_error>("webAuthnSign: the passkey must hold a P-256 key");

    // SigningPubKey is part of the signed data, so it is set first. The
    // passkey signature replaces the regular one.
    jv[jss::SigningPubKey] = strHex(passkey.pk().slice());
    jv.removeMember(jss::TxnSignature);

    Blob const challenge = options.challenge ? *options.challenge : signingData(jv);

    std::string clientDataJSON = R"({"type":")" + options.type + R"(")";
    if (!options.omitChallenge)
        clientDataJSON += R"(,"challenge":")" + base64urlEncode(makeSlice(challenge)) + R"(")";
    clientDataJSON += R"(,"origin":")" + std::string(kOrigin) + R"(","crossOrigin":false})";

    Blob const authData = authenticatorData();

    // What an authenticator signs: AuthenticatorData followed by the SHA-256
    // of ClientDataJSON. For a P-256 key, sign() hashes the message with
    // SHA-256 before signing it, as WebAuthn's ES256 does.
    auto const clientDataHash = sha256(makeSlice(clientDataJSON));
    Blob message(authData);
    message.insert(message.end(), clientDataHash.begin(), clientDataHash.end());

    auto const sig = sign(passkey.pk(), passkey.sk(), makeSlice(message));
    Blob signature(sig.data(), sig.data() + sig.size());
    if (options.alterSignature)
        signature.back() ^= 0x01;

    auto& passkeySignature = jv[sfPasskeySignature.jsonName];
    passkeySignature[sfPasskeyID.jsonName] = passkeyId;
    passkeySignature[sfAuthenticatorData.jsonName] = strHex(authData);
    passkeySignature[sfClientDataJSON.jsonName] = strHex(clientDataJSON);
    passkeySignature[sfSignature.jsonName] = strHex(signature);
}

WebAuthnSig::WebAuthnSig(Account passkey, std::string passkeyId, WebAuthnOptions options)
    : passkey_(std::move(passkey)), passkeyId_(std::move(passkeyId)), options_(std::move(options))
{
}

void
WebAuthnSig::operator()(Env&, JTx& jt) const
{
    jt.fillSig = false;
    jt.mainSigners.emplace_back(
        [passkey = passkey_, passkeyId = passkeyId_, options = options_](Env&, JTx& jtx) {
            webAuthnSign(jtx.jv, passkey, passkeyId, options);
        });
}

}  // namespace xrpl::test::jtx
