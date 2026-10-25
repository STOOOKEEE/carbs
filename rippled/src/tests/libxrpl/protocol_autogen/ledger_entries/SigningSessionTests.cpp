// Auto-generated unit tests for ledger entry SigningSession


#include <gtest/gtest.h>

#include <protocol_autogen/TestHelpers.h>

#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol_autogen/ledger_entries/SigningSession.h>
#include <xrpl/protocol_autogen/ledger_entries/Ticket.h>

#include <string>

namespace xrpl::ledger_entries {

// 1 & 4) Set fields via builder setters, build, then read them back via
// wrapper getters. After build(), validate() should succeed for both the
// builder's STObject and the wrapper's SLE.
TEST(SigningSessionTests, BuilderSettersRoundTrip)
{
    uint256 const index{1u};

    auto const accountValue = canonical_ACCOUNT();
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const expirationValue = canonical_UINT32();
    auto const permissionsValue = canonical_ARRAY();
    auto const sessionCapValue = canonical_AMOUNT();
    auto const sessionSpentValue = canonical_AMOUNT();
    auto const sessionMaxPerTxValue = canonical_AMOUNT();
    auto const sessionWitnessValue = canonical_ACCOUNT();
    auto const sessionMaxTxCountValue = canonical_UINT32();
    auto const sessionTxCountValue = canonical_UINT32();
    auto const ownerNodeValue = canonical_UINT64();
    auto const previousTxnIDValue = canonical_UINT256();
    auto const previousTxnLgrSeqValue = canonical_UINT32();

    SigningSessionBuilder builder{
        accountValue,
        sessionKeyValue,
        expirationValue,
        ownerNodeValue,
        previousTxnIDValue,
        previousTxnLgrSeqValue
    };

    builder.setPermissions(permissionsValue);
    builder.setSessionCap(sessionCapValue);
    builder.setSessionSpent(sessionSpentValue);
    builder.setSessionMaxPerTx(sessionMaxPerTxValue);
    builder.setSessionWitness(sessionWitnessValue);
    builder.setSessionMaxTxCount(sessionMaxTxCountValue);
    builder.setSessionTxCount(sessionTxCountValue);

    builder.setLedgerIndex(index);
    builder.setFlags(0x1u);

    EXPECT_TRUE(builder.validate());

    auto const entry = builder.build(index);

    EXPECT_TRUE(entry.validate());

    {
        auto const& expected = accountValue;
        auto const actual = entry.getAccount();
        expectEqualField(expected, actual, "sfAccount");
    }

    {
        auto const& expected = sessionKeyValue;
        auto const actual = entry.getSessionKey();
        expectEqualField(expected, actual, "sfSessionKey");
    }

    {
        auto const& expected = expirationValue;
        auto const actual = entry.getExpiration();
        expectEqualField(expected, actual, "sfExpiration");
    }

    {
        auto const& expected = ownerNodeValue;
        auto const actual = entry.getOwnerNode();
        expectEqualField(expected, actual, "sfOwnerNode");
    }

    {
        auto const& expected = previousTxnIDValue;
        auto const actual = entry.getPreviousTxnID();
        expectEqualField(expected, actual, "sfPreviousTxnID");
    }

    {
        auto const& expected = previousTxnLgrSeqValue;
        auto const actual = entry.getPreviousTxnLgrSeq();
        expectEqualField(expected, actual, "sfPreviousTxnLgrSeq");
    }

    {
        auto const& expected = permissionsValue;
        auto const actualOpt = entry.getPermissions();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfPermissions");
        EXPECT_TRUE(entry.hasPermissions());
    }

    {
        auto const& expected = sessionCapValue;
        auto const actualOpt = entry.getSessionCap();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionCap");
        EXPECT_TRUE(entry.hasSessionCap());
    }

    {
        auto const& expected = sessionSpentValue;
        auto const actualOpt = entry.getSessionSpent();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionSpent");
        EXPECT_TRUE(entry.hasSessionSpent());
    }

    {
        auto const& expected = sessionMaxPerTxValue;
        auto const actualOpt = entry.getSessionMaxPerTx();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionMaxPerTx");
        EXPECT_TRUE(entry.hasSessionMaxPerTx());
    }

    {
        auto const& expected = sessionWitnessValue;
        auto const actualOpt = entry.getSessionWitness();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionWitness");
        EXPECT_TRUE(entry.hasSessionWitness());
    }

    {
        auto const& expected = sessionMaxTxCountValue;
        auto const actualOpt = entry.getSessionMaxTxCount();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionMaxTxCount");
        EXPECT_TRUE(entry.hasSessionMaxTxCount());
    }

    {
        auto const& expected = sessionTxCountValue;
        auto const actualOpt = entry.getSessionTxCount();
        ASSERT_TRUE(actualOpt.has_value());
        expectEqualField(expected, *actualOpt, "sfSessionTxCount");
        EXPECT_TRUE(entry.hasSessionTxCount());
    }

    EXPECT_TRUE(entry.hasLedgerIndex());
    auto const ledgerIndex = entry.getLedgerIndex();
    ASSERT_TRUE(ledgerIndex.has_value());
    EXPECT_EQ(*ledgerIndex, index);
    EXPECT_EQ(entry.getKey(), index);
}

// 2 & 4) Start from an SLE, set fields directly on it, construct a builder
// from that SLE, build a new wrapper, and verify all fields (and validate()).
TEST(SigningSessionTests, BuilderFromSleRoundTrip)
{
    uint256 const index{2u};

    auto const accountValue = canonical_ACCOUNT();
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const expirationValue = canonical_UINT32();
    auto const permissionsValue = canonical_ARRAY();
    auto const sessionCapValue = canonical_AMOUNT();
    auto const sessionSpentValue = canonical_AMOUNT();
    auto const sessionMaxPerTxValue = canonical_AMOUNT();
    auto const sessionWitnessValue = canonical_ACCOUNT();
    auto const sessionMaxTxCountValue = canonical_UINT32();
    auto const sessionTxCountValue = canonical_UINT32();
    auto const ownerNodeValue = canonical_UINT64();
    auto const previousTxnIDValue = canonical_UINT256();
    auto const previousTxnLgrSeqValue = canonical_UINT32();

    auto sle = std::make_shared<SLE>(SigningSession::entryType, index);

    sle->at(sfAccount) = accountValue;
    sle->at(sfSessionKey) = sessionKeyValue;
    sle->at(sfExpiration) = expirationValue;
    sle->setFieldArray(sfPermissions, permissionsValue);
    sle->at(sfSessionCap) = sessionCapValue;
    sle->at(sfSessionSpent) = sessionSpentValue;
    sle->at(sfSessionMaxPerTx) = sessionMaxPerTxValue;
    sle->at(sfSessionWitness) = sessionWitnessValue;
    sle->at(sfSessionMaxTxCount) = sessionMaxTxCountValue;
    sle->at(sfSessionTxCount) = sessionTxCountValue;
    sle->at(sfOwnerNode) = ownerNodeValue;
    sle->at(sfPreviousTxnID) = previousTxnIDValue;
    sle->at(sfPreviousTxnLgrSeq) = previousTxnLgrSeqValue;

    SigningSessionBuilder builderFromSle{sle};
    EXPECT_TRUE(builderFromSle.validate());

    auto const entryFromBuilder = builderFromSle.build(index);

    SigningSession entryFromSle{sle};
    EXPECT_TRUE(entryFromBuilder.validate());
    EXPECT_TRUE(entryFromSle.validate());

    {
        auto const& expected = accountValue;

        auto const fromSle = entryFromSle.getAccount();
        auto const fromBuilder = entryFromBuilder.getAccount();

        expectEqualField(expected, fromSle, "sfAccount");
        expectEqualField(expected, fromBuilder, "sfAccount");
    }

    {
        auto const& expected = sessionKeyValue;

        auto const fromSle = entryFromSle.getSessionKey();
        auto const fromBuilder = entryFromBuilder.getSessionKey();

        expectEqualField(expected, fromSle, "sfSessionKey");
        expectEqualField(expected, fromBuilder, "sfSessionKey");
    }

    {
        auto const& expected = expirationValue;

        auto const fromSle = entryFromSle.getExpiration();
        auto const fromBuilder = entryFromBuilder.getExpiration();

        expectEqualField(expected, fromSle, "sfExpiration");
        expectEqualField(expected, fromBuilder, "sfExpiration");
    }

    {
        auto const& expected = ownerNodeValue;

        auto const fromSle = entryFromSle.getOwnerNode();
        auto const fromBuilder = entryFromBuilder.getOwnerNode();

        expectEqualField(expected, fromSle, "sfOwnerNode");
        expectEqualField(expected, fromBuilder, "sfOwnerNode");
    }

    {
        auto const& expected = previousTxnIDValue;

        auto const fromSle = entryFromSle.getPreviousTxnID();
        auto const fromBuilder = entryFromBuilder.getPreviousTxnID();

        expectEqualField(expected, fromSle, "sfPreviousTxnID");
        expectEqualField(expected, fromBuilder, "sfPreviousTxnID");
    }

    {
        auto const& expected = previousTxnLgrSeqValue;

        auto const fromSle = entryFromSle.getPreviousTxnLgrSeq();
        auto const fromBuilder = entryFromBuilder.getPreviousTxnLgrSeq();

        expectEqualField(expected, fromSle, "sfPreviousTxnLgrSeq");
        expectEqualField(expected, fromBuilder, "sfPreviousTxnLgrSeq");
    }

    {
        auto const& expected = permissionsValue;

        auto const fromSleOpt = entryFromSle.getPermissions();
        auto const fromBuilderOpt = entryFromBuilder.getPermissions();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfPermissions");
        expectEqualField(expected, *fromBuilderOpt, "sfPermissions");
    }

    {
        auto const& expected = sessionCapValue;

        auto const fromSleOpt = entryFromSle.getSessionCap();
        auto const fromBuilderOpt = entryFromBuilder.getSessionCap();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionCap");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionCap");
    }

    {
        auto const& expected = sessionSpentValue;

        auto const fromSleOpt = entryFromSle.getSessionSpent();
        auto const fromBuilderOpt = entryFromBuilder.getSessionSpent();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionSpent");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionSpent");
    }

    {
        auto const& expected = sessionMaxPerTxValue;

        auto const fromSleOpt = entryFromSle.getSessionMaxPerTx();
        auto const fromBuilderOpt = entryFromBuilder.getSessionMaxPerTx();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionMaxPerTx");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionMaxPerTx");
    }

    {
        auto const& expected = sessionWitnessValue;

        auto const fromSleOpt = entryFromSle.getSessionWitness();
        auto const fromBuilderOpt = entryFromBuilder.getSessionWitness();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionWitness");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionWitness");
    }

    {
        auto const& expected = sessionMaxTxCountValue;

        auto const fromSleOpt = entryFromSle.getSessionMaxTxCount();
        auto const fromBuilderOpt = entryFromBuilder.getSessionMaxTxCount();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionMaxTxCount");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionMaxTxCount");
    }

    {
        auto const& expected = sessionTxCountValue;

        auto const fromSleOpt = entryFromSle.getSessionTxCount();
        auto const fromBuilderOpt = entryFromBuilder.getSessionTxCount();

        ASSERT_TRUE(fromSleOpt.has_value());
        ASSERT_TRUE(fromBuilderOpt.has_value());

        expectEqualField(expected, *fromSleOpt, "sfSessionTxCount");
        expectEqualField(expected, *fromBuilderOpt, "sfSessionTxCount");
    }

    EXPECT_EQ(entryFromSle.getKey(), index);
    EXPECT_EQ(entryFromBuilder.getKey(), index);
}

// 3) Verify wrapper throws when constructed from wrong ledger entry type.
TEST(SigningSessionTests, WrapperThrowsOnWrongEntryType)
{
    uint256 const index{3u};

    // Build a valid ledger entry of a different type
    // Ticket requires: Account, OwnerNode, TicketSequence, PreviousTxnID, PreviousTxnLgrSeq
    // Check requires: Account, Destination, SendMax, Sequence, OwnerNode, DestinationNode, PreviousTxnID, PreviousTxnLgrSeq
    TicketBuilder wrongBuilder{
        canonical_ACCOUNT(),
        canonical_UINT64(),
        canonical_UINT32(),
        canonical_UINT256(),
        canonical_UINT32()};
    auto wrongEntry = wrongBuilder.build(index);

    EXPECT_THROW(SigningSession{wrongEntry.getSle()}, std::runtime_error);
}

// 4) Verify builder throws when constructed from wrong ledger entry type.
TEST(SigningSessionTests, BuilderThrowsOnWrongEntryType)
{
    uint256 const index{4u};

    // Build a valid ledger entry of a different type
    TicketBuilder wrongBuilder{
        canonical_ACCOUNT(),
        canonical_UINT64(),
        canonical_UINT32(),
        canonical_UINT256(),
        canonical_UINT32()};
    auto wrongEntry = wrongBuilder.build(index);

    EXPECT_THROW(SigningSessionBuilder{wrongEntry.getSle()}, std::runtime_error);
}

// 5) Build with only required fields and verify optional fields return nullopt.
TEST(SigningSessionTests, OptionalFieldsReturnNullopt)
{
    uint256 const index{3u};

    auto const accountValue = canonical_ACCOUNT();
    auto const sessionKeyValue = canonical_ACCOUNT();
    auto const expirationValue = canonical_UINT32();
    auto const ownerNodeValue = canonical_UINT64();
    auto const previousTxnIDValue = canonical_UINT256();
    auto const previousTxnLgrSeqValue = canonical_UINT32();

    SigningSessionBuilder builder{
        accountValue,
        sessionKeyValue,
        expirationValue,
        ownerNodeValue,
        previousTxnIDValue,
        previousTxnLgrSeqValue
    };

    auto const entry = builder.build(index);

    // Verify optional fields are not present
    EXPECT_FALSE(entry.hasPermissions());
    EXPECT_FALSE(entry.getPermissions().has_value());
    EXPECT_FALSE(entry.hasSessionCap());
    EXPECT_FALSE(entry.getSessionCap().has_value());
    EXPECT_FALSE(entry.hasSessionSpent());
    EXPECT_FALSE(entry.getSessionSpent().has_value());
    EXPECT_FALSE(entry.hasSessionMaxPerTx());
    EXPECT_FALSE(entry.getSessionMaxPerTx().has_value());
    EXPECT_FALSE(entry.hasSessionWitness());
    EXPECT_FALSE(entry.getSessionWitness().has_value());
    EXPECT_FALSE(entry.hasSessionMaxTxCount());
    EXPECT_FALSE(entry.getSessionMaxTxCount().has_value());
    EXPECT_FALSE(entry.hasSessionTxCount());
    EXPECT_FALSE(entry.getSessionTxCount().has_value());
}
}
