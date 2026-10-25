#include <xrpl/tx/transactors/session/SigningSessionDelete.h>

#include <xrpl/basics/Log.h>
#include <xrpl/beast/utility/Journal.h>
#include <xrpl/ledger/ApplyView.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/XRPAmount.h>
#include <xrpl/tx/SigningSession.h>
#include <xrpl/tx/Transactor.h>
#include <xrpl/tx/applySteps.h>

#include <cstdint>

namespace xrpl {

bool
SigningSessionDelete::checkExtraFeatures(PreflightContext const& ctx)
{
    return ctx.rules.enabled(featurePermissionDelegationV1_1);
}

std::uint32_t
SigningSessionDelete::getFlagsMask(PreflightContext const&)
{
    // No flag of its own: every bit is refused but the universal flags
    // (tfFullyCanonicalSig, and tfInnerBatchTxn on a Batch inner transaction).
    return tfUniversalMask;
}

TxConsequences
SigningSessionDelete::makeTxConsequences(PreflightContext const& ctx)
{
    if (ctx.tx.isFieldPresent(sfOwner))
        return TxConsequences{ctx.tx};
    return TxConsequences{ctx.tx, TxConsequences::Category::Blocker};
}

NotTEC
SigningSessionDelete::preflight(PreflightContext const& ctx)
{
    // The owner closes its own session without Owner.
    if (ctx.tx[~sfOwner] == ctx.tx[sfAccount])
    {
        JLOG(ctx.j.trace()) << "SigningSessionDelete: Owner is the account";
        return temMALFORMED;
    }

    return tesSUCCESS;
}

TER
SigningSessionDelete::preclaim(PreclaimContext const& ctx)
{
    auto const owner = ctx.tx[~sfOwner];
    auto const sle = ctx.view.read(
        keylet::signingSession(owner.value_or(ctx.tx[sfAccount]), ctx.tx[sfSessionKey]));
    if (!sle)
        return tecNO_ENTRY;

    // Any account may clean up a session of another account, once it has
    // expired: an expired session is unusable and only holds a reserve.
    if (owner && !isSessionExpired(ctx.view, *sle))
    {
        JLOG(ctx.j.trace()) << "SigningSessionDelete: the session has not expired";
        return tecNO_PERMISSION;
    }

    return tesSUCCESS;
}

TER
SigningSessionDelete::doApply()
{
    auto const sle = view().peek(
        keylet::signingSession(ctx_.tx[~sfOwner].value_or(accountID_), ctx_.tx[sfSessionKey]));
    if (!sle)
        return tecINTERNAL;  // LCOV_EXCL_LINE

    return deleteSession(view(), sle, j_);
}

TER
SigningSessionDelete::deleteSession(ApplyView& view, SLE::ref sle, beast::Journal j)
{
    if (!sle)
        return tecINTERNAL;  // LCOV_EXCL_LINE

    auto const owner = (*sle)[sfAccount];
    if (!view.dirRemove(keylet::ownerDir(owner), (*sle)[sfOwnerNode], sle->key(), false))
    {
        // LCOV_EXCL_START
        JLOG(j.fatal()) << "SigningSessionDelete: cannot remove the session from the owner "
                           "directory";
        return tefBAD_LEDGER;
        // LCOV_EXCL_STOP
    }

    auto const sleOwner = view.peek(keylet::account(owner));
    if (!sleOwner)
        return tecINTERNAL;  // LCOV_EXCL_LINE

    decreaseOwnerCountForObject(view, sleOwner, sle, 1, j);
    view.erase(sle);

    return tesSUCCESS;
}

void
SigningSessionDelete::visitInvariantEntry(bool, SLE::const_ref, SLE::const_ref)
{
    // No transaction-specific invariants yet.
}

bool
SigningSessionDelete::finalizeInvariants(
    STTx const&,
    TER,
    XRPAmount,
    ReadView const&,
    beast::Journal const&)
{
    // No transaction-specific invariants yet.
    return true;
}

}  // namespace xrpl
