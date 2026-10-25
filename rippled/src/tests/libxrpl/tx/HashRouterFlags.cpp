#include <xrpl/core/HashRouter.h>

#include <gtest/gtest.h>

#include <array>
#include <span>
#include <type_traits>

using namespace xrpl;

namespace {

using Flags = std::underlying_type_t<HashRouterFlags>;

// The public flags sit below this bit; the private ones at or above it.
constexpr Flags kFirstPrivateBit = 0x0100;

constexpr std::array<HashRouterFlags, 4> kPublic = {
    HashRouterFlags::BAD,
    HashRouterFlags::SAVED,
    HashRouterFlags::HELD,
    HashRouterFlags::TRUSTED,
};

constexpr std::array<HashRouterFlags, 9> kPrivate = {
    HashRouterFlags::PRIVATE1,
    HashRouterFlags::PRIVATE2,
    HashRouterFlags::PRIVATE3,
    HashRouterFlags::PRIVATE4,
    HashRouterFlags::PRIVATE5,
    HashRouterFlags::PRIVATE6,
    HashRouterFlags::PRIVATE7,
    HashRouterFlags::PRIVATE8,
    HashRouterFlags::PRIVATE9,
};

}  // namespace

// Every private flag is one bit of the private range: none can collide with
// a public flag added later in the free public bits.
TEST(HashRouterFlags, private_flags_are_in_the_private_range)
{
    for (auto const flag : kPrivate)
    {
        auto const bits = static_cast<Flags>(flag);
        EXPECT_GE(bits, kFirstPrivateBit) << bits;
        EXPECT_EQ(bits & (bits - 1), 0) << bits;
    }
    for (auto const flag : kPublic)
        EXPECT_LT(static_cast<Flags>(flag), kFirstPrivateBit);
}

// No two flags share a bit.
TEST(HashRouterFlags, flags_are_distinct)
{
    Flags seen = 0;
    for (auto const& group :
         {std::span<HashRouterFlags const>(kPublic), std::span<HashRouterFlags const>(kPrivate)})
    {
        for (auto const flag : group)
        {
            auto const bits = static_cast<Flags>(flag);
            EXPECT_EQ(seen & bits, 0) << bits;
            seen |= bits;
        }
    }
}
