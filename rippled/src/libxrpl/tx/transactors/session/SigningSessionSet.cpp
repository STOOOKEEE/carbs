#include <xrpl/tx/transactors/session/SigningSessionSet.h>

#include <xrpl/basics/Log.h>
#include <xrpl/basics/Slice.h>
#include <xrpl/beast/utility/Journal.h>
#include <xrpl/ledger/ApplyView.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/ledger/helpers/DirectoryHelpers.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/Permissions.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/TxFormats.h>
#include <xrpl/protocol/XRPAmount.h>
#include <xrpl/tx/SigningSession.h>
#include <xrpl/tx/Transactor.h>

#include <cstdint>
#include <limits>
#include <memory>
#include <unordered_set>

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
SigningSessionSet::preflight(PreflightContext const& ctx)
{
    auto const& tx = ctx.tx;

    // Exactly one mode: A (the flag), P (Permissions) or C (SessionCap).
    int const modes = static_cast<int>(tx.isFlag(tfAllTransactions)) +
        static_cast<int>(tx.isFieldPresent(sfPermissions)) +
        static_cast<int>(tx.isFieldPresent(sfSessionCap));
    if (modes != 1)
    {
        JLOG(ctx.j.trace()) << "SigningSessionSet: not exactly one mode";
        return temMALFORMED;
    }

    if (tx[sfSessionKey] == tx[sfAccount])
    {
        JLOG(ctx.j.trace()) << "SigningSessionSet: the session key is the account";
        return temMALFORMED;
    }

    if (auto const duration = tx[sfSessionDuration];
        duration == 0 || duration > kMaxSessionDuration)
    {
        JLOG(ctx.j.trace()) << "SigningSessionSet: the duration is out of range";
        return temBAD_EXPIRATION;
    }

    if (tx.isFieldPresent(sfPermissions))
    {
        auto const& permissions = tx.getFieldArray(sfPermissions);
        if (permissions.empty())
            return temARRAY_EMPTY;
        if (permissions.size() > kPermissionMaxSize)
            return temARRAY_TOO_LARGE;

        std::unordered_set<std::uint32_t> seen;
        for (auto const& permission : permissions)
        {
            auto const value = permission[sfPermissionValue];
            if (!seen.insert(value).second)
                return temMALFORMED;

            if (!Permission::getInstance().isDelegable(value, ctx.rules))
                return temMALFORMED;

            // A transaction-level value is the type plus one; granular values
            // are above every type and never name an excluded one.
            if (value <= std::numeric_limits<std::uint16_t>::max() &&
                isSessionExcluded(static_cast<TxType>(value - 1)))
                return temMALFORMED;
        }
    }

    if (auto const cap = tx[~sfSessionCap]; cap && (!isXRP(*cap) || *cap <= beast::kZero))
    {
        JLOG(ctx.j.trace()) << "SigningSessionSet: the cap is not a positive XRP amount";
        return temBAD_AMOUNT;
    }

    return tesSUCCESS;
}

TER
SigningSessionSet::preclaim(PreclaimContext const& ctx)
{
    AccountID const account = ctx.tx[sfAccount];
    AccountID const sessionKey = ctx.tx[sfSessionKey];

    // A key that already has full authority over the account gains nothing
    // from a session, and would be bounded by it (FIANSO-SPEC 6.4).
    auto const sleAccount = ctx.view.read(keylet::account(account));
    if (!sleAccount)
        return terNO_ACCOUNT;  // LCOV_EXCL_LINE

    if ((*sleAccount)[~sfRegularKey] == sessionKey)
        return tecNO_PERMISSION;

    if (auto const passkeys = ctx.view.read(keylet::passkeyList(account)))
    {
        for (auto const& passkey : passkeys->getFieldArray(sfPasskeys))
        {
            if (passkey.isFieldPresent(sfPublicKey) &&
                calcAccountID(PublicKey(makeSlice(passkey.getFieldVL(sfPublicKey)))) == sessionKey)
                return tecNO_PERMISSION;
        }
    }

    if (auto const beneficiary = ctx.view.read(keylet::beneficiary(account));
        beneficiary && (*beneficiary)[sfBeneficiary] == sessionKey)
        return tecNO_PERMISSION;

    // No update: a session is deleted and opened again.
    if (ctx.view.exists(keylet::signingSession(account, sessionKey)))
        return tecDUPLICATE;

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
    // No transaction-specific invariants yet.
}

bool
SigningSessionSet::finalizeInvariants(
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
