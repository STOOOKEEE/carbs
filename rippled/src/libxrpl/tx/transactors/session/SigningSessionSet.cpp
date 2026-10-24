#include <xrpl/tx/transactors/session/SigningSessionSet.h>

#include <xrpl/basics/Log.h>
#include <xrpl/beast/utility/Journal.h>
#include <xrpl/ledger/ApplyView.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/ledger/helpers/DirectoryHelpers.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/XRPAmount.h>
#include <xrpl/tx/Transactor.h>

#include <cstdint>
#include <memory>

namespace xrpl {

bool
SigningSessionSet::checkExtraFeatures(PreflightContext const& ctx)
{
    // Modes A and P are read through the XLS-75 permission engine.
    return ctx.rules.enabled(featurePermissionDelegationV1_1);
}

std::uint32_t
SigningSessionSet::getFlagsMask(PreflightContext const&)
{
    return tfSigningSessionSetMask;
}

NotTEC
SigningSessionSet::preflight(PreflightContext const&)
{
    return tesSUCCESS;
}

TER
SigningSessionSet::preclaim(PreclaimContext const& ctx)
{
    // No update: a session is deleted and opened again.
    if (ctx.view.exists(keylet::signingSession(ctx.tx[sfAccount], ctx.tx[sfSessionKey])))
    {
        JLOG(ctx.j.trace()) << "SigningSessionSet: the session already exists";
        return tecDUPLICATE;
    }

    return tesSUCCESS;
}

TER
SigningSessionSet::doApply()
{
    auto const sleOwner = view().peek(keylet::account(accountID_));
    if (!sleOwner)
        return tefINTERNAL;  // LCOV_EXCL_LINE

    // The session's reserve is never sponsored: SigningSessionSet is not in
    // isReserveSponsorAllowed, so preflight1 refuses a reserve sponsor.
    if (auto const ret = checkReserve(
            ctx_.getApplyViewContext(),
            sleOwner,
            preFeeBalance_,
            {.ownerCountDelta = 1},
            ctx_.journal);
        !isTesSuccess(ret))
        return ret;

    Keylet const sessionKeylet = keylet::signingSession(accountID_, ctx_.tx[sfSessionKey]);
    auto const sle = std::make_shared<SLE>(sessionKeylet);
    (*sle)[sfAccount] = accountID_;
    (*sle)[sfSessionKey] = ctx_.tx[sfSessionKey];
    (*sle)[sfExpiration] =
        view().parentCloseTime().time_since_epoch().count() + ctx_.tx[sfSessionDuration];

    if (ctx_.tx.isFlag(tfAllTransactions))
        sle->setFlag(lsfAllTransactions);

    if (ctx_.tx.isFieldPresent(sfPermissions))
        sle->setFieldArray(sfPermissions, ctx_.tx.getFieldArray(sfPermissions));

    if (auto const cap = ctx_.tx[~sfSessionCap])
    {
        (*sle)[sfSessionCap] = *cap;
        (*sle)[sfSessionSpent] = STAmount{XRPAmount{0}};
    }

    auto const page =
        view().dirInsert(keylet::ownerDir(accountID_), sessionKeylet, describeOwnerDir(accountID_));
    if (!page)
        return tecDIR_FULL;  // LCOV_EXCL_LINE
    (*sle)[sfOwnerNode] = *page;

    view().insert(sle);
    increaseOwnerCount(ctx_.getApplyViewContext(), sleOwner, 1, ctx_.journal);

    return tesSUCCESS;
}

void
SigningSessionSet::visitInvariantEntry(bool, SLE::const_ref, SLE::const_ref)
{
    // The ValidSigningSession check covers this transaction.
}

bool
SigningSessionSet::finalizeInvariants(
    STTx const&,
    TER,
    XRPAmount,
    ReadView const&,
    beast::Journal const&)
{
    // The ValidSigningSession check covers this transaction.
    return true;
}

}  // namespace xrpl
