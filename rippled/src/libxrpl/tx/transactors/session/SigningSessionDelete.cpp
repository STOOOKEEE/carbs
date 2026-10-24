#include <xrpl/tx/transactors/session/SigningSessionDelete.h>

#include <xrpl/basics/Log.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/TER.h>

namespace xrpl {

namespace {

AccountID
ownerOf(STTx const& tx)
{
    return tx.isFieldPresent(sfOwner) ? tx.getAccountID(sfOwner) : tx.getAccountID(sfAccount);
}

}  // namespace

NotTEC
SigningSessionDelete::preflight(PreflightContext const& ctx)
{
    if (auto const owner = ctx.tx[~sfOwner]; owner && *owner == ctx.tx[sfAccount])
        return temMALFORMED;
    return tesSUCCESS;
}

TER
SigningSessionDelete::preclaim(PreclaimContext const& ctx)
{
    auto const sle = ctx.view.read(keylet::signingSession(ownerOf(ctx.tx), ctx.tx[sfSessionKey]));
    if (!sle)
        return tecNO_ENTRY;

    // A third party may only clean up a session that has expired.
    if (ctx.tx.isFieldPresent(sfOwner) &&
        ctx.view.parentCloseTime().time_since_epoch().count() < (*sle)[sfExpiration])
        return tecNO_PERMISSION;

    return tesSUCCESS;
}

TER
SigningSessionDelete::doApply()
{
    auto const sle = view().peek(keylet::signingSession(ownerOf(ctx_.tx), ctx_.tx[sfSessionKey]));
    return deleteSession(view(), sle, ctx_.journal);
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
        JLOG(j.fatal()) << "Unable to delete SigningSession from owner.";
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
    // The ValidSigningSession invariant (FIANSO-SPEC 6.7) is not written yet.
}

bool
SigningSessionDelete::finalizeInvariants(STTx const&, TER, XRPAmount, ReadView const&, beast::Journal const&)
{
    return true;
}

}  // namespace xrpl
