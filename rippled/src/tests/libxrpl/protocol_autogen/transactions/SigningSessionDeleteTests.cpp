// Auto-generated unit tests for transaction SigningSessionDelete


#include <gtest/gtest.h>

#include <protocol_autogen/TestHelpers.h>

#include <xrpl/protocol/SecretKey.h>
#include <xrpl/protocol/Seed.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol_autogen/transactions/SigningSessionDelete.h>
#include <xrpl/protocol_autogen/transactions/AccountSet.h>

#include <string>

namespace xrpl::transactions {

// 1 & 4) Set fields via builder setters, build, then read them back via
// wrapper getters. After build(), validate() should succeed.
TEST(TransactionsSigningSessionDeleteTests, BuilderSettersRoundTrip)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionDelete"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 1;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific field values
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const ownerValue = canonical_ACCOUNT();

    SigningSessionDeleteBuilder builder{
        accountValue,
        sessionKeyValue,
        sequenceValue,
        feeValue
    };

    // Set optional fields
    builder.setOwner(ownerValue);

    auto tx = builder.build(publicKey, secretKey);

    std::string reason;
    EXPECT_TRUE(tx.validate(reason)) << reason;

    // Verify signing was applied
    EXPECT_FALSE(tx.getSigningPubKey().empty());
    EXPECT_TRUE(tx.hasTxnSignature());

    // Verify common fields
    EXPECT_EQ(tx.getAccount(), accountValue);
    EXPECT_EQ(tx.getSequence(), sequenceValue);
    EXPECT_EQ(tx.getFee(), feeValue);

    // Verify required fields
    {
        auto const& expected = sessionKeyValue;
        auto const actual = tx.getSessionKey();
        expectEqualField(expected, actual, "sfSessionKey");
    }

    // Verify optional fields
    {
        auto const& expected = ownerValue;
        auto const actualOpt = tx.getOwner();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfOwner should be present";
        expectEqualField(expected, *actualOpt, "sfOwner");
        EXPECT_TRUE(tx.hasOwner());
    }

}

// 2 & 4) Start from an STTx, construct a builder from it, build a new wrapper,
// and verify all fields match.
TEST(TransactionsSigningSessionDeleteTests, BuilderFromStTxRoundTrip)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionDeleteFromTx"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 2;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific field values
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const ownerValue = canonical_ACCOUNT();

    // Build an initial transaction
    SigningSessionDeleteBuilder initialBuilder{
        accountValue,
        sessionKeyValue,
        sequenceValue,
        feeValue
    };

    initialBuilder.setOwner(ownerValue);

    auto initialTx = initialBuilder.build(publicKey, secretKey);

    // Create builder from existing STTx
    SigningSessionDeleteBuilder builderFromTx{initialTx.getSTTx()};

    auto rebuiltTx = builderFromTx.build(publicKey, secretKey);

    std::string reason;
    EXPECT_TRUE(rebuiltTx.validate(reason)) << reason;

    // Verify common fields
    EXPECT_EQ(rebuiltTx.getAccount(), accountValue);
    EXPECT_EQ(rebuiltTx.getSequence(), sequenceValue);
    EXPECT_EQ(rebuiltTx.getFee(), feeValue);

    // Verify required fields
    {
        auto const& expected = sessionKeyValue;
        auto const actual = rebuiltTx.getSessionKey();
        expectEqualField(expected, actual, "sfSessionKey");
    }

    // Verify optional fields
    {
        auto const& expected = ownerValue;
        auto const actualOpt = rebuiltTx.getOwner();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfOwner should be present";
        expectEqualField(expected, *actualOpt, "sfOwner");
    }

}

// 3) Verify wrapper throws when constructed from wrong transaction type.
TEST(TransactionsSigningSessionDeleteTests, WrapperThrowsOnWrongTxType)
{
    // Build a valid transaction of a different type
    auto const [pk, sk] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testWrongType"));
    auto const account = calcAccountID(pk);

    AccountSetBuilder wrongBuilder{account, 1, canonical_AMOUNT()};
    auto wrongTx = wrongBuilder.build(pk, sk);

    EXPECT_THROW(SigningSessionDelete{wrongTx.getSTTx()}, std::runtime_error);
}

// 4) Verify builder throws when constructed from wrong transaction type.
TEST(TransactionsSigningSessionDeleteTests, BuilderThrowsOnWrongTxType)
{
    // Build a valid transaction of a different type
    auto const [pk, sk] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testWrongTypeBuilder"));
    auto const account = calcAccountID(pk);

    AccountSetBuilder wrongBuilder{account, 1, canonical_AMOUNT()};
    auto wrongTx = wrongBuilder.build(pk, sk);

    EXPECT_THROW(SigningSessionDeleteBuilder{wrongTx.getSTTx()}, std::runtime_error);
}

// 5) Build with only required fields and verify optional fields return nullopt.
TEST(TransactionsSigningSessionDeleteTests, OptionalFieldsReturnNullopt)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionDeleteNullopt"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 3;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific required field values
    auto const sessionKeyValue = canonical_ACCOUNT();

    SigningSessionDeleteBuilder builder{
        accountValue,
        sessionKeyValue,
        sequenceValue,
        feeValue
    };

    // Do NOT set optional fields

    auto tx = builder.build(publicKey, secretKey);

    // Verify optional fields are not present
    EXPECT_FALSE(tx.hasOwner());
    EXPECT_FALSE(tx.getOwner().has_value());
}

}
