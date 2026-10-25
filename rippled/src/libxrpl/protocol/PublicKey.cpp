#include <xrpl/protocol/PublicKey.h>

#include <xrpl/basics/Slice.h>
#include <xrpl/basics/base_uint.h>
#include <xrpl/basics/contract.h>
#include <xrpl/basics/strHex.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/UintTypes.h>
#include <xrpl/protocol/detail/secp256k1.h>
#include <xrpl/protocol/digest.h>
#include <xrpl/protocol/tokens.h>

#include <boost/multiprecision/number.hpp>

#include <openssl/bn.h>
#include <openssl/ec.h>
#include <openssl/ecdsa.h>
#include <openssl/obj_mac.h>

#include <ed25519.h>
#include <secp256k1.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <optional>
#include <ostream>
#include <string>

extern "C" {
#include <api.h>
}

// api.h declares every mode; this unit is bound to mode 2 (ML-DSA-44) by the
// pqcrystals_dilithium2_* names. An archive built for another DILITHIUM_MODE
// exports no pqcrystals_dilithium2_ref_verify, so the link fails.
#ifndef CRYPTO_PUBLICKEYBYTES
#define CRYPTO_PUBLICKEYBYTES pqcrystals_dilithium2_PUBLICKEYBYTES
#endif

#ifndef crypto_sign_verify
#define crypto_sign_verify pqcrystals_dilithium2_ref_verify
#endif

namespace xrpl {

std::ostream&
operator<<(std::ostream& os, PublicKey const& pk)
{
    os << strHex(pk);
    return os;
}

template <>
std::optional<PublicKey>
parseBase58(TokenType type, std::string const& s)
{
    auto const result = decodeBase58Token(s, type);
    auto const pks = makeSlice(result);
    if (!publicKeyType(pks))
        return std::nullopt;
    return PublicKey(pks);
}

//------------------------------------------------------------------------------

// Parse a length-prefixed number
//  Format: 0x02 <length-byte> <number>
static std::optional<Slice>
sigPart(Slice& buf)
{
    if (buf.size() < 3 || buf[0] != 0x02)
        return std::nullopt;
    auto const len = buf[1];
    buf += 2;
    if (len > buf.size() || len < 1 || len > 33)
        return std::nullopt;
    // Can't be negative
    if ((buf[0] & 0x80) != 0)
        return std::nullopt;
    if (buf[0] == 0)
    {
        // Can't be zero
        if (len == 1)
            return std::nullopt;
        // Can't be padded
        if ((buf[1] & 0x80) == 0)
            return std::nullopt;
    }
    std::optional<Slice> number = Slice(buf.data(), len);
    buf += len;
    return number;
}

static std::string
sliceToHex(Slice const& slice)
{
    std::string s;
    if ((slice[0] & 0x80) != 0)
    {
        s.reserve(2 * (slice.size() + 2));
        s = "0x00";
    }
    else
    {
        s.reserve(2 * (slice.size() + 1));
        s = "0x";
    }
    for (std::uint8_t const byte : slice)
    {
        static constexpr char kHex[] = "0123456789ABCDEF";
        s += kHex[((byte & 0xf0) >> 4)];
        s += kHex[((byte & 0x0f) >> 0)];
    }
    return s;
}

/**
 * Determine whether a signature is canonical.
 * Canonical signatures are important to protect against signature morphing
 * attacks.
 * @param vSig the signature data
 * @param sigLen the length of the signature
 * @param strict_param whether to enforce strictly canonical semantics
 *
 * @note For more details please see:
 * https://xrpl.org/transaction-malleability.html
 * https://bitcointalk.org/index.php?topic=8392.msg127623#msg127623
 * https://github.com/sipa/bitcoin/commit/58bc86e37fda1aec270bccb3df6c20fbd2a6591c
 */
std::optional<ECDSACanonicality>
ecdsaCanonicality(Slice const& sig)
{
    using uint264 = boost::multiprecision::number<boost::multiprecision::cpp_int_backend<
        264,
        264,
        boost::multiprecision::signed_magnitude,
        boost::multiprecision::unchecked,
        void>>;

    static uint264 const kG(
        "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");  // NOLINT(readability-identifier-naming)

    // The format of a signature should be:
    // <30> <len> [ <02> <lenR> <R> ] [ <02> <lenS> <S> ]
    if ((sig.size() < 8) || (sig.size() > 72))
        return std::nullopt;
    if ((sig[0] != 0x30) || (sig[1] != (sig.size() - 2)))
        return std::nullopt;
    Slice p = sig + 2;
    auto r = sigPart(p);
    auto s = sigPart(p);
    if (!r || !s || !p.empty())
        return std::nullopt;

    uint264 const rNum(sliceToHex(*r));
    if (rNum >= kG)
        return std::nullopt;

    uint264 const sNum(sliceToHex(*s));
    if (sNum >= kG)
        return std::nullopt;

    // (R,S) and (R,G-S) are canonical,
    // but is fully canonical when S <= G-S
    auto const Sp = kG - sNum;  // NOLINT(readability-identifier-naming)
    if (sNum > Sp)
        return ECDSACanonicality::Canonical;
    return ECDSACanonicality::FullyCanonical;
}

static bool
ed25519Canonical(Slice const& sig)
{
    if (sig.size() != 64)
        return false;
    // Big-endian Order, the Ed25519 subgroup order
    // NOLINTNEXTLINE(readability-identifier-naming)
    std::uint8_t const Order[] = {
        0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x14, 0xDE, 0xF9, 0xDE, 0xA2, 0xF7,
        0x9C, 0xD6, 0x58, 0x12, 0x63, 0x1A, 0x5C, 0xF5, 0xD3, 0xED,
    };
    // Take the second half of signature
    // and byte-reverse it to big-endian.
    auto const le = sig.data() + 32;
    std::uint8_t S[32];  // NOLINT(readability-identifier-naming)
    std::reverse_copy(le, le + 32, S);
    // Must be less than Order
    return std::lexicographical_compare(S, S + 32, Order, Order + 32);
}

//------------------------------------------------------------------------------

PublicKey::PublicKey(Slice const& slice)
{
    if (slice.size() > kMaxSize)
    {
        logicError(
            "PublicKey::PublicKey - Input slice cannot be an oversized "
            "buffer");
    }

    if (slice.size() > sizeof(buf_))
        logicError("PublicKey::PublicKey - Input slice exceeds buffer");

    if (!publicKeyType(slice))
        logicError("PublicKey::PublicKey invalid type");
    size_ = slice.size();
    std::memcpy(buf_, slice.data(), size_);
}

PublicKey::PublicKey(PublicKey const& other) : size_(other.size_)
{
    if (size_)
        std::memcpy(buf_, other.buf_, size_);
}

PublicKey&
PublicKey::operator=(PublicKey const& other)
{
    if (this != &other)
    {
        size_ = other.size_;
        if (size_)
            std::memcpy(buf_, other.buf_, size_);
    }

    return *this;
}

//------------------------------------------------------------------------------

std::optional<KeyType>
publicKeyType(Slice const& slice)
{
    if (slice.size() == 33)
    {
        if (slice[0] == 0xED)
            return KeyType::Ed25519;

        if (slice[0] == kEcCompressedPrefixEvenY || slice[0] == kEcCompressedPrefixOddY)
            return KeyType::Secp256k1;
    }
    else if (slice.size() == CRYPTO_PUBLICKEYBYTES)
    {
        return KeyType::Dilithium;
    }

    if (slice.size() == 65 && slice[0] == 0xF6)
        return KeyType::P256;

    return std::nullopt;
}

bool
verifyDigest(
    PublicKey const& publicKey,
    uint256 const& digest,
    Slice const& sig,
    bool mustBeFullyCanonical) noexcept
{
    auto const type = publicKeyType(publicKey);
    if (!type)
        return false;

    switch (*type)
    {
        case KeyType::Secp256k1: {
            auto const canonicality = ecdsaCanonicality(sig);
            if (!canonicality)
                return false;
            if (mustBeFullyCanonical && (*canonicality != ECDSACanonicality::FullyCanonical))
                return false;

            secp256k1_pubkey pubkeyImp;
            if (secp256k1_ec_pubkey_parse(
                    secp256k1Context(),
                    &pubkeyImp,
                    reinterpret_cast<unsigned char const*>(publicKey.data()),
                    publicKey.size()) != 1)
                return false;

            secp256k1_ecdsa_signature sigImp;
            if (secp256k1_ecdsa_signature_parse_der(
                    secp256k1Context(),
                    &sigImp,
                    reinterpret_cast<unsigned char const*>(sig.data()),
                    sig.size()) != 1)
                return false;
            if (*canonicality != ECDSACanonicality::FullyCanonical)
            {
                secp256k1_ecdsa_signature sigNorm;
                if (secp256k1_ecdsa_signature_normalize(secp256k1Context(), &sigNorm, &sigImp) != 1)
                    return false;
                return secp256k1_ecdsa_verify(
                           secp256k1Context(),
                           &sigNorm,
                           reinterpret_cast<unsigned char const*>(digest.data()),
                           &pubkeyImp) == 1;
            }
            return secp256k1_ecdsa_verify(
                       secp256k1Context(),
                       &sigImp,
                       reinterpret_cast<unsigned char const*>(digest.data()),
                       &pubkeyImp) == 1;
        }
        case KeyType::Dilithium: {
            uint8_t ctx[] = {};
            size_t ctxlen = 0;
            // Verify the digest data directly
            return crypto_sign_verify(
                       sig.data(),
                       sig.size(),
                       reinterpret_cast<unsigned char const*>(digest.data()),
                       digest.size(),
                       ctx,
                       ctxlen,
                       publicKey.data()) == 0;
        }
        default:
            return false;
    }
}

struct ECDSASignature
{
    std::array<uint8_t, 32> r;
    std::array<uint8_t, 32> s;
};

static std::optional<ECDSASignature>
parseDERSignature(Slice const& derSig) noexcept
{
    if (derSig.size() < 8)
        return std::nullopt;

    uint8_t const* data = derSig.data();
    size_t offset = 0;

    // Check sequence tag
    if (data[offset++] != 0x30)
        return std::nullopt;

    // Skip total length
    offset++;

    // Parse R
    if (data[offset++] != 0x02)
        return std::nullopt;
    uint8_t rLen = data[offset++];
    if (offset + rLen >= derSig.size())
        return std::nullopt;

    ECDSASignature result{};

    // Copy R, handling leading zeros
    int rStart = (rLen > 32 && data[offset] == 0x00) ? 1 : 0;
    int rCopyLen = std::min(32, static_cast<int>(rLen - rStart));
    std::memcpy(result.r.data() + (32 - rCopyLen), data + offset + rStart, rCopyLen);
    offset += rLen;

    // Parse S. Its tag and its length byte must both be in the buffer: the
    // check on R above only guarantees the tag.
    if (offset + 2 > derSig.size())
        return std::nullopt;
    if (data[offset++] != 0x02)
        return std::nullopt;
    uint8_t sLen = data[offset++];
    if (offset + sLen > derSig.size())
        return std::nullopt;

    // Copy S, handling leading zeros
    int sStart = (sLen > 32 && data[offset] == 0x00) ? 1 : 0;
    int sCopyLen = std::min(32, static_cast<int>(sLen - sStart));
    std::memcpy(result.s.data() + (32 - sCopyLen), data + offset + sStart, sCopyLen);

    return result;
}

// n and floor(n / 2), n the order of the P-256 group, big-endian.
static constexpr std::array<std::uint8_t, 32> kP256Order = {
    0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
};
static constexpr std::array<std::uint8_t, 32> kP256HalfOrder = {
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
};

// A minimal DER integer (sigPart checked its tag, its length and its leading
// byte) as 32 big-endian bytes, if it fits in 32 bytes.
static std::optional<std::array<std::uint8_t, 32>>
p256Scalar(Slice number) noexcept
{
    // sigPart only allows a leading zero before a byte with its top bit set.
    if (number.size() == 33 && number[0] == 0)
        number += 1;
    if (number.size() > 32)
        return std::nullopt;
    std::array<std::uint8_t, 32> value{};
    std::memcpy(value.data() + (32 - number.size()), number.data(), number.size());
    return value;
}

/**
 * Parse a P-256 signature under fixP256StrictDer, as ecdsaCanonicality does
 * for secp256k1: <30> <len> <02> <lenR> <R> <02> <lenS> <S>, with len the
 * size of everything after it, minimal integers, nothing after S,
 * 0 < R < n, and 0 < S <= n / 2 (a low S). Any other form would be a second
 * valid encoding of the same signature, and a new transaction ID.
 */
static std::optional<ECDSASignature>
parseStrictDERSignature(Slice const& sig) noexcept
{
    if (sig.size() < 8 || sig.size() > 72)
        return std::nullopt;
    if (sig[0] != 0x30 || sig[1] != sig.size() - 2)
        return std::nullopt;

    Slice p = sig + 2;
    auto const r = sigPart(p);
    auto const s = sigPart(p);
    if (!r || !s || !p.empty())
        return std::nullopt;

    // sigPart also refuses zero.
    auto const rValue = p256Scalar(*r);
    auto const sValue = p256Scalar(*s);
    if (!rValue || !sValue || *rValue >= kP256Order || *sValue > kP256HalfOrder)
        return std::nullopt;

    return ECDSASignature{*rValue, *sValue};
}

static bool
verifyP256ECDSA(
    uint8_t const* hash,
    size_t hashLen,
    uint8_t const* r,
    size_t rLen,
    uint8_t const* s,
    size_t sLen,
    uint8_t const* x,
    size_t xLen,
    uint8_t const* y,
    size_t yLen) noexcept
{
    if (hashLen != 32 || rLen > 32 || sLen > 32 || xLen > 32 || yLen > 32)
        return false;

    // Create curve object
    EC_GROUP* group = EC_GROUP_new_by_curve_name(NID_X9_62_prime256v1);
    if (!group)
        return false;

    // Set group to EC_KEY
    EC_KEY* key = EC_KEY_new();
    if (!key)
    {
        EC_GROUP_free(group);
        return false;
    }
    EC_KEY_set_group(key, group);

    // Restore public key point from coordinates
    EC_POINT* point = EC_POINT_new(group);
    BIGNUM* bnX = BN_bin2bn(x, xLen, nullptr);
    BIGNUM* bnY = BN_bin2bn(y, yLen, nullptr);

    bool success = false;
    if (point && bnX && bnY &&
        EC_POINT_set_affine_coordinates_GFp(group, point, bnX, bnY, nullptr) == 1 &&
        EC_KEY_set_public_key(key, point) == 1)
    {
        // Pack r/s into ECDSA_SIG structure
        ECDSA_SIG* sig = ECDSA_SIG_new();
        BIGNUM* bnR = BN_bin2bn(r, rLen, nullptr);
        BIGNUM* bnS = BN_bin2bn(s, sLen, nullptr);

        if (sig && bnR && bnS && ECDSA_SIG_set0(sig, bnR, bnS) == 1)
        {
            // Verify (ECDSA_SIG_set0 takes ownership of bnR, bnS)
            int verified = ECDSA_do_verify(hash, hashLen, sig, key);
            success = (verified == 1);
            bnR = nullptr;  // ownership transferred
            bnS = nullptr;  // ownership transferred
        }

        ECDSA_SIG_free(sig);
        if (bnR)
            BN_free(bnR);
        if (bnS)
            BN_free(bnS);
    }

    EC_POINT_free(point);
    BN_free(bnX);
    BN_free(bnY);
    EC_KEY_free(key);
    EC_GROUP_free(group);

    return success;
}

bool
verify(PublicKey const& publicKey, Slice const& m, Slice const& sig, bool strictP256Der) noexcept
{
    if (auto const type = publicKeyType(publicKey))
    {
        if (*type == KeyType::Secp256k1)
        {
            return verifyDigest(publicKey, sha512Half(m), sig);
        }
        if (*type == KeyType::Ed25519)
        {
            if (!ed25519Canonical(sig))
                return false;

            // We internally prefix Ed25519 keys with a 0xED
            // byte to distinguish them from secp256k1 keys
            // so when verifying the signature, we need to
            // first strip that prefix.
            return ed25519_sign_open(m.data(), m.size(), publicKey.data() + 1, sig.data()) == 0;
        }
        if (*type == KeyType::Dilithium)
        {
            uint8_t ctx[] = {};
            size_t ctxlen = 0;
            return crypto_sign_verify(
                       sig.data(), sig.size(), m.data(), m.size(), ctx, ctxlen, publicKey.data()) ==
                0;
        }
        if (*type == KeyType::P256)
        {
            // Parse DER signature to extract r and s values
            auto parsedSig = strictP256Der ? parseStrictDERSignature(sig) : parseDERSignature(sig);
            if (!parsedSig)
                return false;

            // Hash the message with SHA-256 (P-256 uses ECDSA-SHA256)
            auto hash = sha256(m);

            // We internally prefix P-256 keys with a prefix byte
            // so strip it to get the raw public key coordinates
            if (publicKey.size() != 65)  // 1 prefix + 32-byte x + 32-byte y
                return false;

            // Extract x and y coordinates (skip prefix byte)
            uint8_t const* xCoord = publicKey.data() + 1;
            uint8_t const* yCoord = publicKey.data() + 33;

            return verifyP256ECDSA(
                hash.data(),
                hash.size(),
                parsedSig->r.data(),
                32,  // r component
                parsedSig->s.data(),
                32,  // s component
                xCoord,
                32,  // x coordinate
                yCoord,
                32);  // y coordinate
        }
    }
    return false;
}

bool
verify(PublicKey const& publicKey, Slice const& m, Slice const& sig) noexcept
{
    if (publicKeyType(publicKey) == KeyType::P256)
        return false;
    return verify(publicKey, m, sig, false);
}

NodeID
calcNodeID(PublicKey const& pk)
{
    static_assert(NodeID::kBytes == sizeof(RipeshaHasher::result_type));

    RipeshaHasher h;
    h(pk.data(), pk.size());
    return NodeID::fromRaw(static_cast<RipeshaHasher::result_type>(h));
}

}  // namespace xrpl
