#pragma once

#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>

#include <xrpl/basics/Blob.h>
#include <xrpl/basics/Slice.h>
#include <xrpl/json/json_value.h>

#include <cstdint>
#include <optional>
#include <string>

namespace xrpl::test::jtx {

/**
 * How the software authenticator builds its assertion. The defaults give the
 * assertion a browser returns for `navigator.credentials.get`; each other
 * value makes one part of it wrong.
 */
struct WebAuthnOptions
{
    /** The `type` member of ClientDataJSON. */
    std::string type = "webauthn.get";

    /** The bytes the challenge encodes. Unset: the transaction's signing data. */
    std::optional<Blob> challenge;

    /** Leave the `challenge` member out of ClientDataJSON. */
    bool omitChallenge = false;

    /** Flip a bit of the signature after signing. */
    bool alterSignature = false;
};

/**
 * Return the base64url encoding of `data`, without padding (RFC 4648,
 * section 5), as WebAuthn encodes a challenge in ClientDataJSON.
 */
std::string
base64urlEncode(Slice const& data);

/**
 * Return the bytes a single signature of `jv` covers: the HashPrefix of a
 * transaction signature followed by the fields that are signed.
 */
Blob
signingData(json::Value const& jv);

/**
 * Return a PasskeyListSet for `account` that registers the P-256 key of
 * `passkey` under the hex credential id `passkeyId`.
 */
json::Value
passkeyListSet(Account const& account, Account const& passkey, std::string const& passkeyId);

/**
 * Sign `jv` the way a passkey does through WebAuthn.
 *
 * `passkey` must hold a P-256 key. The function sets SigningPubKey to its
 * public key, builds ClientDataJSON with the signing data as challenge and an
 * AuthenticatorData, signs AuthenticatorData followed by the SHA-256 of
 * ClientDataJSON, and stores the result in sfPasskeySignature instead of
 * sfTxnSignature. `passkeyId` is the hex PasskeyID of the credential.
 * Throws if `passkey` does not hold a P-256 key.
 */
void
webAuthnSign(
    json::Value& jv,
    Account const& passkey,
    std::string const& passkeyId,
    WebAuthnOptions const& options = {});

/**
 * Sign a JTx through WebAuthn with a passkey, in place of the regular
 * signature. Use it like Sig.
 */
class WebAuthnSig
{
private:
    Account passkey_;
    std::string passkeyId_;
    WebAuthnOptions options_;

public:
    WebAuthnSig(Account passkey, std::string passkeyId, WebAuthnOptions options = {});

    void
    operator()(Env&, JTx& jt) const;
};

}  // namespace xrpl::test::jtx
