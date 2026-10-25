#include <xrpl/tx/SigningSession.h>

#include <xrpl/basics/Slice.h>
#include <xrpl/basics/chrono.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/Keylet.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/Permissions.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/Rules.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STObject.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/TxFormats.h>

#include <algorithm>
#include <optional>
#include <unordered_set>

namespace xrpl {

namespace {

// The AccountID of the single signer, if tx is single-signed with a key of a
// known type.
std::optional<AccountID>
singleSigner(STTx const& tx)
{
    if (tx.isFieldPresent(sfSigners))
        return std::nullopt;

    auto const pk = tx.getFieldVL(sfSigningPubKey);
    if (pk.empty() || !publicKeyType(makeSlice(pk)))
        return std::nullopt;

    return calcAccountID(PublicKey(makeSlice(pk)));
}

}  // namespace

bool
isSessionExcluded(TxType type) noexcept
{
    return std::ranges::find(kSessionExcluded, type) != kSessionExcluded.end();
}

bool
isSessionEligibleType(TxType type, Rules const& rules)
{
    return !isSessionExcluded(type) && Permission::getInstance().isDelegable(type + 1, rules);
}

std::optional<Keylet>
sessionKeyletOf(Rules const& rules, STTx const& tx)
{
    // No ledger read for any transaction before the amendment is enabled.
    if (!rules.enabled(featureSigningSessions))
        return std::nullopt;

    // Shapes that follow the existing rules: delegated, sponsored and
    // co-signed transactions, and Batch inner transactions.
    if (tx.isFieldPresent(sfDelegate) || tx.isFieldPresent(sfSponsor) ||
        tx.isFieldPresent(sfSponsorSignature) || tx.isFieldPresent(sfCounterpartySignature) ||
        tx.isFlag(tfInnerBatchTxn))
        return std::nullopt;

    auto const signer = singleSigner(tx);
    if (!signer)
        return std::nullopt;

    return keylet::signingSession(tx.getAccountID(sfAccount), *signer);
}

std::optional<Keylet>
signingSessionOf(ReadView const& view, STTx const& tx)
{
    auto const keylet = sessionKeyletOf(view.rules(), tx);
    if (!keylet || !view.exists(*keylet))
        return std::nullopt;

    return keylet;
}

bool
isSessionSigned(ReadView const& view, STTx const& tx)
{
    return signingSessionOf(view, tx).has_value();
}

bool
isSessionOwnClose(STTx const& tx)
{
    if (tx.getTxnType() != ttSIGNING_SESSION_DELETE || tx.isFieldPresent(sfOwner))
        return false;

    auto const signer = singleSigner(tx);
    return signer && *signer == tx.getAccountID(sfSessionKey);
}

bool
isSessionCapPayment(STTx const& tx)
{
    if (tx.getTxnType() != ttPAYMENT)
        return false;

    if ((tx.getFlags() & ~tfFullyCanonicalSig) != 0)
        return false;

    if (!isXRP(tx[sfAmount]))
        return false;

    static std::unordered_set<SField const*> const kCommon = [] {
        std::unordered_set<SField const*> common;
        for (auto const& element : TxFormats::getCommonFields())
            common.insert(&element.sField());
        return common;
    }();

    for (auto const& field : tx)
    {
        if (field.getSType() == STI_NOTPRESENT)
            continue;

        auto const& name = field.getFName();
        if (name == sfDestination || name == sfDestinationTag || name == sfAmount ||
            kCommon.contains(&name))
            continue;

        return false;
    }

    return true;
}

bool
isSessionExpired(ReadView const& view, SLE const& session)
{
    return view.parentCloseTime() >=
        NetClock::time_point{NetClock::duration{session.getFieldU32(sfExpiration)}};
}

bool
isSessionWitnessed(ReadView const& view, STTx const& tx, AccountID const& witness)
{
    if (!tx.isFieldPresent(sfWitnessSignature))
        return false;

    auto const pk = tx.getFieldObject(sfWitnessSignature).getFieldVL(sfSigningPubKey);
    if (!publicKeyType(makeSlice(pk)))
        return false;

    auto const sle = view.read(keylet::account(witness));
    if (!sle)
        return false;

    auto const signer = calcAccountID(PublicKey(makeSlice(pk)));
    if (signer == witness)
        return !sle->isFlag(lsfDisableMaster);

    return (*sle)[~sfRegularKey] == signer;
}

}  // namespace xrpl
