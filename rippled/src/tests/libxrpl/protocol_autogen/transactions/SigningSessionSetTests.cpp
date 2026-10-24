// Auto-generated unit tests for transaction SigningSessionSet


#include <gtest/gtest.h>

#include <protocol_autogen/TestHelpers.h>

#include <xrpl/protocol/SecretKey.h>
#include <xrpl/protocol/Seed.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol_autogen/transactions/SigningSessionSet.h>
#include <xrpl/protocol_autogen/transactions/AccountSet.h>

#include <string>

namespace xrpl::transactions {

// 1 & 4) Set fields via builder setters, build, then read them back via
// wrapper getters. After build(), validate() should succeed.
TEST(TransactionsSigningSessionSetTests, BuilderSettersRoundTrip)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionSet"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 1;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific field values
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const sessionDurationValue = canonical_UINT32();
    auto const permissionsValue = canonical_ARRAY();
    auto const sessionCapValue = canonical_AMOUNT();

    SigningSessionSetBuilder builder{
        accountValue,
        sessionKeyValue,
        sessionDurationValue,
        sequenceValue,
        feeValue
    };

    // Set optional fields
    builder.setPermissions(permissionsValue);
    builder.setSessionCap(sessionCapValue);

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

    {
        auto const& expected = sessionDurationValue;
        auto const actual = tx.getSessionDuration();
        expectEqualField(expected, actual, "sfSessionDuration");
    }

    // Verify optional fields
    {
        auto const& expected = permissionsValue;
        auto const actualOpt = tx.getPermissions();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfPermissions should be present";
        expectEqualField(expected, *actualOpt, "sfPermissions");
        EXPECT_TRUE(tx.hasPermissions());
    }

    {
        auto const& expected = sessionCapValue;
        auto const actualOpt = tx.getSessionCap();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfSessionCap should be present";
        expectEqualField(expected, *actualOpt, "sfSessionCap");
        EXPECT_TRUE(tx.hasSessionCap());
    }

}

// 2 & 4) Start from an STTx, construct a builder from it, build a new wrapper,
// and verify all fields match.
TEST(TransactionsSigningSessionSetTests, BuilderFromStTxRoundTrip)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionSetFromTx"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 2;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific field values
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const sessionDurationValue = canonical_UINT32();
    auto const permissionsValue = canonical_ARRAY();
    auto const sessionCapValue = canonical_AMOUNT();

    // Build an initial transaction
    SigningSessionSetBuilder initialBuilder{
        accountValue,
        sessionKeyValue,
        sessionDurationValue,
        sequenceValue,
        feeValue
    };

    initialBuilder.setPermissions(permissionsValue);
    initialBuilder.setSessionCap(sessionCapValue);

    auto initialTx = initialBuilder.build(publicKey, secretKey);

    // Create builder from existing STTx
    SigningSessionSetBuilder builderFromTx{initialTx.getSTTx()};

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

    {
        auto const& expected = sessionDurationValue;
        auto const actual = rebuiltTx.getSessionDuration();
        expectEqualField(expected, actual, "sfSessionDuration");
    }

    // Verify optional fields
    {
        auto const& expected = permissionsValue;
        auto const actualOpt = rebuiltTx.getPermissions();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfPermissions should be present";
        expectEqualField(expected, *actualOpt, "sfPermissions");
    }

    {
        auto const& expected = sessionCapValue;
        auto const actualOpt = rebuiltTx.getSessionCap();
        ASSERT_TRUE(actualOpt.has_value()) << "Optional field sfSessionCap should be present";
        expectEqualField(expected, *actualOpt, "sfSessionCap");
    }

}

// 3) Verify wrapper throws when constructed from wrong transaction type.
TEST(TransactionsSigningSessionSetTests, WrapperThrowsOnWrongTxType)
{
    // Build a valid transaction of a different type
    auto const [pk, sk] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testWrongType"));
    auto const account = calcAccountID(pk);

    AccountSetBuilder wrongBuilder{account, 1, canonical_AMOUNT()};
    auto wrongTx = wrongBuilder.build(pk, sk);

    EXPECT_THROW(SigningSessionSet{wrongTx.getSTTx()}, std::runtime_error);
}

// 4) Verify builder throws when constructed from wrong transaction type.
TEST(TransactionsSigningSessionSetTests, BuilderThrowsOnWrongTxType)
{
    // Build a valid transaction of a different type
    auto const [pk, sk] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testWrongTypeBuilder"));
    auto const account = calcAccountID(pk);

    AccountSetBuilder wrongBuilder{account, 1, canonical_AMOUNT()};
    auto wrongTx = wrongBuilder.build(pk, sk);

    EXPECT_THROW(SigningSessionSetBuilder{wrongTx.getSTTx()}, std::runtime_error);
}

// 5) Build with only required fields and verify optional fields return nullopt.
TEST(TransactionsSigningSessionSetTests, OptionalFieldsReturnNullopt)
{
    // Generate a deterministic keypair for signing
    auto const [publicKey, secretKey] =
        generateKeyPair(KeyType::Secp256k1, generateSeed("testSigningSessionSetNullopt"));

    // Common transaction fields
    auto const accountValue = calcAccountID(publicKey);
    std::uint32_t const sequenceValue = 3;
    auto const feeValue = canonical_AMOUNT();

    // Transaction-specific required field values
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const sessionDurationValue = canonical_UINT32();

    SigningSessionSetBuilder builder{
        accountValue,
        sessionKeyValue,
        sessionDurationValue,
        sequenceValue,
        feeValue
    };

    // Do NOT set optional fields

    auto tx = builder.build(publicKey, secretKey);

    // Verify optional fields are not present
    EXPECT_FALSE(tx.hasPermissions());
    EXPECT_FALSE(tx.getPermissions().has_value());
    EXPECT_FALSE(tx.hasSessionCap());
    EXPECT_FALSE(tx.getSessionCap().has_value());
}

}
