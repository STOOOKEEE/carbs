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
        EXPECT_TRUE(verify(pk, makeSlice(message), Slice(sig.data(), sig.size())));
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
    EXPECT_FALSE(verify(pk, makeSlice(message), Slice(at, sig.size())));

    munmap(region, 2 * pageSize);
}
#endif
