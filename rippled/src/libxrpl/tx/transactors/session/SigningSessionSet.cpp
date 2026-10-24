#include <xrpl/tx/transactors/session/SigningSessionSet.h>

#include <xrpl/basics/Log.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/ledger/helpers/DirectoryHelpers.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/tx/transactors/session/SigningSession.h>

#include <algorithm>
#include <memory>

namespace xrpl {

namespace {

bool
isPositiveXrp(STAmount const& amount)
{
    return isXRP(amount) && amount.signum() > 0;
}

/** True when `key` already has full authority on the account: its regular key or one of its passkeys. */
bool
hasFullAuthority(ReadView const& view, AccountID const& account, AccountID const& key)
{
    auto const sleAccount = view.read(keylet::account(account));
    if (sleAccount && sleAccount->isFieldPresent(sfRegularKey) && sleAccount->getAccountID(sfRegularKey) == key)
        return true;
    auto const passkeys = view.read(keylet::passkeyList(account));
    if (!passkeys)
        return false;
    auto const& list = passkeys->getFieldArray(sfPasskeys);
    return std::any_of(list.begin(), list.end(), [&key](STObject const& passkey) {
        return passkey.isFieldPresent(sfPublicKey) &&
            calcAccountID(PublicKey(makeSlice(passkey.getFieldVL(sfPublicKey)))) == key;
    });
}

}  // namespace

NotTEC
SigningSessionSet::preflight(PreflightContext const& ctx)
{
    auto const account = ctx.tx[sfAccount];
    auto const sessionKey = ctx.tx[sfSessionKey];
    if (sessionKey == account)
        return temMALFORMED;

    auto const duration = ctx.tx[sfSessionDuration];
    if (duration == 0 || duration > kMaxSessionDuration)
        return temBAD_EXPIRATION;

    // Mode C is the only mode for now (modes A and P come later): a cap is required.
    if (!ctx.tx.isFieldPresent(sfSessionCap))
        return temMALFORMED;
    auto const cap = ctx.tx[sfSessionCap];
    if (!isPositiveXrp(cap))
        return temBAD_AMOUNT;

    if (auto const perTx = ctx.tx[~sfSessionMaxPerTx])
    {
        if (!isPositiveXrp(*perTx) || *perTx > cap)
            return temBAD_AMOUNT;
    }

    if (auto const witness = ctx.tx[~sfSessionWitness])
    {
        if (*witness == account || *witness == sessionKey)
            return temMALFORMED;
    }

    return tesSUCCESS;
}

TER
SigningSessionSet::preclaim(PreclaimContext const& ctx)
{
    auto const account = ctx.tx[sfAccount];
    auto const sessionKey = ctx.tx[sfSessionKey];

    // Such a key already has full authority: a session would not bound it.
    if (hasFullAuthority(ctx.view, account, sessionKey))
        return tecNO_PERMISSION;

    if (ctx.view.exists(keylet::signingSession(account, sessionKey)))
        return tecDUPLICATE;

    if (auto const witness = ctx.tx[~sfSessionWitness]; witness && !ctx.view.exists(keylet::account(*witness)))
        return tecNO_TARGET;

    return tesSUCCESS;
}

TER
SigningSessionSet::doApply()
{
    auto const sleOwner = view().peek(keylet::account(accountID_));
    if (!sleOwner)
        return tefINTERNAL;  // LCOV_EXCL_LINE

    if (auto const ret =
            checkReserve(ctx_.getApplyViewContext(), sleOwner, preFeeBalance_, {.ownerCountDelta = 1}, ctx_.journal);
        !isTesSuccess(ret))
        return ret;

    auto const sessionKey = ctx_.tx[sfSessionKey];
    auto const key = keylet::signingSession(accountID_, sessionKey);
    auto const sle = std::make_shared<SLE>(key);
    sle->setAccountID(sfAccount, accountID_);
    sle->setAccountID(sfSessionKey, sessionKey);
    sle->setFieldU32(
        sfExpiration,
        static_cast<std::uint32_t>(view().parentCloseTime().time_since_epoch().count()) +
            ctx_.tx[sfSessionDuration]);
    sle->setFieldAmount(sfSessionCap, ctx_.tx[sfSessionCap]);
    sle->setFieldAmount(sfSessionSpent, STAmount{XRPAmount{0}});
    if (auto const perTx = ctx_.tx[~sfSessionMaxPerTx])
        sle->setFieldAmount(sfSessionMaxPerTx, *perTx);
    if (auto const witness = ctx_.tx[~sfSessionWitness])
        sle->setAccountID(sfSessionWitness, *witness);

    auto const page = view().dirInsert(keylet::ownerDir(accountID_), key, describeOwnerDir(accountID_));
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
    // The ValidSigningSession invariant (FIANSO-SPEC 6.7) is not written yet.
}

bool
SigningSessionSet::finalizeInvariants(STTx const&, TER, XRPAmount, ReadView const&, beast::Journal const&)
{
    return true;
}

}  // namespace xrpl
