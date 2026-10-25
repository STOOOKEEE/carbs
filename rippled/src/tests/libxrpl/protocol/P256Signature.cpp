#include <xrpl/basics/Slice.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SecretKey.h>
#include <xrpl/protocol/Seed.h>

#include <gtest/gtest.h>

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

}  // namespace

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
