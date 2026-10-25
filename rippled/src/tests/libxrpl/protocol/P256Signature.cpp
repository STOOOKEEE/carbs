#include <xrpl/basics/Slice.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SecretKey.h>
#include <xrpl/protocol/Seed.h>

#include <gtest/gtest.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

#ifndef _WIN32
#include <sys/mman.h>

#include <unistd.h>
#endif

using namespace xrpl;

namespace {

std::pair<PublicKey, SecretKey>
p256Keys()
{
    return generateKeyPair(KeyType::P256, generateSeed("p256 signature tests"));
}

// floor(n / 2), n the order of the P-256 group, big-endian.
constexpr std::array<std::uint8_t, 32> kHalfOrder = {
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
};

// The S of a DER signature as 32 big-endian bytes.
std::array<std::uint8_t, 32>
sOf(Slice const& der)
{
    std::array<std::uint8_t, 32> s{};
    std::size_t const rLen = der[3];
    std::size_t const sLen = der[4 + rLen + 1];
    std::uint8_t const* sData = der.data() + 4 + rLen + 2;
    std::size_t const skip = sLen > 32 ? sLen - 32 : 0;
    std::memcpy(s.data() + 32 - (sLen - skip), sData + skip, sLen - skip);
    return s;
}

// n, the order of the P-256 group, big-endian.
constexpr std::array<std::uint8_t, 32> kOrder = {
    0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
};

using Scalar = std::array<std::uint8_t, 32>;

// The R of a DER signature as 32 big-endian bytes.
Scalar
rOf(Slice const& der)
{
    Scalar r{};
    std::size_t const rLen = der[3];
    std::size_t const skip = rLen > 32 ? rLen - 32 : 0;
    std::memcpy(r.data() + 32 - (rLen - skip), der.data() + 4 + skip, rLen - skip);
    return r;
}

// n - s.
Scalar
negate(Scalar const& s)
{
    Scalar out{};
    int borrow = 0;
    for (int i = 31; i >= 0; --i)
    {
        int const d = kOrder[i] - s[i] - borrow;
        borrow = d < 0 ? 1 : 0;
        out[i] = static_cast<std::uint8_t>(d + (borrow ? 256 : 0));
    }
    return out;
}

// A DER INTEGER for a 32-byte value. `minimal` strips leading zeros and adds
// one 0x00 when the top bit is set; otherwise the 32 bytes are written as
// they are, whatever their top bit, after `padding` extra zero bytes.
std::vector<std::uint8_t>
integer(Scalar const& v, bool minimal = true, std::size_t padding = 0)
{
    std::vector<std::uint8_t> body;
    if (minimal)
    {
        std::size_t i = 0;
        while (i < 31 && v[i] == 0)
            ++i;
        if ((v[i] & 0x80) != 0)
            body.push_back(0x00);
        body.insert(body.end(), v.begin() + i, v.end());
    }
    else
    {
        body.assign(padding, 0x00);
        body.insert(body.end(), v.begin(), v.end());
    }
    std::vector<std::uint8_t> out{0x02, static_cast<std::uint8_t>(body.size())};
    out.insert(out.end(), body.begin(), body.end());
    return out;
}

std::vector<std::uint8_t>
sequence(std::vector<std::uint8_t> const& r, std::vector<std::uint8_t> const& s)
{
    std::vector<std::uint8_t> out{0x30, static_cast<std::uint8_t>(r.size() + s.size())};
    out.insert(out.end(), r.begin(), r.end());
    out.insert(out.end(), s.begin(), s.end());
    return out;
}

struct Signed
{
    PublicKey pk;
    std::vector<std::uint8_t> message;
    Scalar r;
    Scalar s;
};

enum class TopBitOfR { Any, Set, Clear };

// A P-256 signature over a short message, split into R and S, signed again
// until the top bit of R is as asked.
Signed
signOnce(TopBitOfR want = TopBitOfR::Any)
{
    auto const [pk, sk] = p256Keys();
    for (std::uint8_t i = 0;; ++i)
    {
        std::vector<std::uint8_t> message{i, 0x5A};
        auto const sig = sign(pk, sk, makeSlice(message));
        Slice const der(sig.data(), sig.size());
        auto const r = rOf(der);
        bool const set = (r[0] & 0x80) != 0;
        if (want == TopBitOfR::Any || (want == TopBitOfR::Set) == set || i == 255)
            return {pk, message, r, sOf(der)};
    }
}

bool
verifies(Signed const& x, std::vector<std::uint8_t> const& der, bool strict)
{
    return verify(x.pk, makeSlice(x.message), makeSlice(der), strict);
}

}  // namespace

// Every P-256 signature sign() makes has a low S, the only form a strict
// verifier accepts (and the form ECDSA signatures take everywhere else in
// the protocol). ECDSA draws a fresh nonce each time, so without the
// normalization about half of these would be high.
TEST(P256Signature, sign_makes_low_s)
{
    auto const [pk, sk] = p256Keys();
    int high = 0;
    for (std::uint8_t i = 0; i < 64; ++i)
    {
        std::vector<std::uint8_t> const message{i};
        auto const sig = sign(pk, sk, makeSlice(message));
        auto const s = sOf(Slice(sig.data(), sig.size()));
        if (s > kHalfOrder)
            ++high;
        EXPECT_TRUE(verify(pk, makeSlice(message), Slice(sig.data(), sig.size()), true));
    }
    EXPECT_EQ(high, 0);
}

#ifndef _WIN32
// A signature whose buffer ends right after the tag of S: the parser must
// stop there. The buffer is placed against a page the process cannot read,
// so reading the length byte of S that is not there faults.
TEST(P256Signature, truncated_at_the_tag_of_s_is_not_read_past)
{
    auto const [pk, sk] = p256Keys();
    std::vector<std::uint8_t> const message{1, 2, 3};

    // SEQUENCE, its length, R as four bytes, then the INTEGER tag of S and
    // nothing more: the length byte of S would be the first byte past the
    // buffer.
    std::vector<std::uint8_t> const sig{0x30, 0x07, 0x02, 0x04, 0x11, 0x22, 0x33, 0x44, 0x02};

    auto const pageSize = static_cast<std::size_t>(sysconf(_SC_PAGESIZE));
    void* const region =
        mmap(nullptr, 2 * pageSize, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
    ASSERT_NE(region, MAP_FAILED);
    auto* const base = static_cast<std::uint8_t*>(region);
    ASSERT_EQ(mprotect(base + pageSize, pageSize, PROT_NONE), 0);

    std::uint8_t* const at = base + pageSize - sig.size();
    std::memcpy(at, sig.data(), sig.size());
    EXPECT_FALSE(verify(pk, makeSlice(message), Slice(at, sig.size()), false));

    munmap(region, 2 * pageSize);
}
#endif

// The canonical form: minimal integers, the exact length, a low S.
TEST(P256Signature, strict_accepts_the_canonical_form)
{
    auto const x = signOnce();
    auto const der = sequence(integer(x.r), integer(x.s));
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_TRUE(verifies(x, der, true));
}

// (r, n - s) is the other valid signature anyone can derive.
TEST(P256Signature, high_s_is_refused_when_strict)
{
    auto const x = signOnce();
    auto const der = sequence(integer(x.r), integer(negate(x.s)));
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
}

// A byte after S, the sequence length unchanged or covering it.
TEST(P256Signature, trailing_byte_is_refused_when_strict)
{
    auto const x = signOnce();
    auto der = sequence(integer(x.r), integer(x.s));
    der.push_back(0x00);
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
    der[1] = static_cast<std::uint8_t>(der[1] + 1);
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
}

// A sequence length that does not match the signature.
TEST(P256Signature, wrong_total_length_is_refused_when_strict)
{
    auto const x = signOnce();
    auto der = sequence(integer(x.r), integer(x.s));
    der[1] = static_cast<std::uint8_t>(der[1] - 1);
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
    der[1] = 0x7F;
    EXPECT_TRUE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
}

// The length byte of S says more than the buffer holds: refused either way.
TEST(P256Signature, truncated_at_the_length_of_s_is_refused)
{
    auto const x = signOnce();
    auto der = sequence(integer(x.r), integer(x.s));
    std::size_t const sAt = 4 + der[3];
    der.resize(sAt + 2);
    EXPECT_FALSE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
}

// An INTEGER with a needless leading zero, and one whose top bit makes it
// negative: neither is DER.
TEST(P256Signature, non_minimal_integers_are_refused_when_strict)
{
    {
        auto const x = signOnce(TopBitOfR::Clear);
        ASSERT_EQ(x.r[0] & 0x80, 0);
        auto const der = sequence(integer(x.r, false, 1), integer(x.s));
        EXPECT_TRUE(verifies(x, der, false));
        EXPECT_FALSE(verifies(x, der, true));
    }
    {
        auto const x = signOnce(TopBitOfR::Set);
        ASSERT_NE(x.r[0] & 0x80, 0);
        auto const der = sequence(integer(x.r, false), integer(x.s));
        EXPECT_TRUE(verifies(x, der, false));
        EXPECT_FALSE(verifies(x, der, true));
    }
}

// R equal to n is out of range: refused by the strict form, as by ECDSA.
TEST(P256Signature, r_at_the_order_is_refused)
{
    auto const x = signOnce();
    auto const der = sequence(integer(kOrder), integer(x.s));
    EXPECT_FALSE(verifies(x, der, false));
    EXPECT_FALSE(verifies(x, der, true));
}

// verify() without the strictness argument is for keys that are not P-256:
// a caller that does not say which rules apply cannot accept a P-256
// signature in either form.
TEST(P256Signature, verify_without_the_rules_refuses_p256)
{
    auto const x = signOnce();
    auto const der = sequence(integer(x.r), integer(x.s));
    EXPECT_TRUE(verifies(x, der, true));
    EXPECT_FALSE(verify(x.pk, makeSlice(x.message), makeSlice(der)));

    auto const [pk, sk] = generateKeyPair(KeyType::Secp256k1, generateSeed("not p256"));
    auto const sig = sign(pk, sk, makeSlice(x.message));
    EXPECT_TRUE(verify(pk, makeSlice(x.message), Slice(sig.data(), sig.size())));
}
