#include <xrpl/tx/transactors/session/SigningSession.h>

#include <xrpl/basics/Log.h>
#include <xrpl/ledger/helpers/AccountRootHelpers.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/PublicKey.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/tx/Transactor.h>
#include <xrpl/tx/applySteps.h>

#include <array>

namespace xrpl {

namespace {

/**
 * Payment fields a mode C session may not use: they move value the cap does not
 * see (SendMax, Paths, DeliverMin, partial payments) or bring in other rules.
 * The flags rule below closes the rest: only tfFullyCanonicalSig is allowed.
 */
std::array<SField const*, 5> const kSessionForbiddenPaymentFields{
    &sfSendMax,
    &sfPaths,
    &sfDeliverMin,
    &sfCredentialIDs,
    &sfDomainID,
};

/** The AccountID of the single key that signed the transaction. */
std::optional<AccountID>
signerOf(STTx const& tx)
{
    auto const pk = tx.getFieldVL(sfSigningPubKey);
    if (pk.empty() || !publicKeyType(makeSlice(pk)))
        return std::nullopt;
    return calcAccountID(PublicKey(makeSlice(pk)));
}

/** Mode C: an XRP payment to one destination, nothing else (closed whitelist). */
bool
isCapEligiblePayment(STTx const& tx)
{
    if (tx.getTxnType() != ttPAYMENT)
        return false;
    if ((tx.getFlags() & ~tfFullyCanonicalSig) != 0u)
        return false;
    for (auto const* field : kSessionForbiddenPaymentFields)
    {
        if (tx.isFieldPresent(*field))
            return false;
    }
    return isXRP(tx.getFieldAmount(sfAmount));
}

/** The witness key must be the witness account's enabled master key or its regular key. */
bool
witnessKeyIsValid(ReadView const& view, AccountID const& witness, STObject const& signature)
{
    auto const pk = signature.getFieldVL(sfSigningPubKey);
    if (!publicKeyType(makeSlice(pk)))
        return false;
    auto const signer = calcAccountID(PublicKey(makeSlice(pk)));
    auto const sle = view.read(keylet::account(witness));
    if (!sle)
        return false;
    if (signer == witness)
        return !sle->isFlag(lsfDisableMaster);
    return sle->isFieldPresent(sfRegularKey) && sle->getAccountID(sfRegularKey) == signer;
}

XRPAmount
paymentAmount(STTx const& tx)
{
    return tx.getTxnType() == ttPAYMENT ? tx.getFieldAmount(sfAmount).xrp() : XRPAmount{0};
}

}  // namespace

std::optional<Keylet>
sessionOf(ReadView const& view, STTx const& tx)
{
    if (!view.rules().enabled(featureSigningSessions))
        return std::nullopt;
    if (tx.isFieldPresent(sfSigners) || tx.isFieldPresent(sfDelegate) ||
        tx.isFieldPresent(sfSponsor) || tx.isFieldPresent(sfSponsorSignature) ||
        tx.isFieldPresent(sfCounterpartySignature) || ((tx.getFlags() & tfInnerBatchTxn) != 0u))
        return std::nullopt;
    auto const signer = signerOf(tx);
    if (!signer)
        return std::nullopt;
    auto const session = keylet::signingSession(tx.getAccountID(sfAccount), *signer);
    if (!view.exists(session))
        return std::nullopt;
    return session;
}

bool
isOwnClose(STTx const& tx)
{
    if (tx.getTxnType() != ttSIGNING_SESSION_DELETE || tx.isFieldPresent(sfOwner))
        return false;
    auto const signer = signerOf(tx);
    return signer && *signer == tx.getAccountID(sfSessionKey);
}

NotTEC
checkSession(PreclaimContext const& ctx, Keylet const& session)
{
    auto const& tx = ctx.tx;
    auto const& view = ctx.view;
    auto const sle = view.read(session);
    if (!sle)
        return tefINTERNAL;  // LCOV_EXCL_LINE: sessionOf found it

    // What Transactor::checkSign would have refused for any signer.
    if (isPseudoAccount(view, tx.getAccountID(sfAccount)))
        return tefBAD_AUTH;

    bool const ownClose = isOwnClose(tx);

    // 1. Eligibility. Mode C is the only mode for now: XRP payments only.
    if (!ownClose && !(sle->isFieldPresent(sfSessionCap) && isCapEligiblePayment(tx)))
        return tefSESSION_TX_NOT_ALLOWED;

    // 2. The transaction must expire soon: a refused one cannot land later
    //    under another session opened with the same key.
    auto const lastLedger = tx[~sfLastLedgerSequence];
    if (!lastLedger || *lastLedger > view.seq() + kSessionMaxLedgerWindow)
        return tefSESSION_TX_NOT_ALLOWED;

    // 3. Expiry, measured on the parent ledger close time.
    auto const now = view.parentCloseTime().time_since_epoch().count();
    if (!ownClose && now >= (*sle)[sfExpiration])
        return tefSESSION_EXPIRED;

    // 4. Fee ceiling, every session transaction: what it must pay plus a margin.
    auto const fee = tx.getFieldAmount(sfFee).xrp();
    auto const required = calculateBaseFee(view, tx);
    if (!required)
        return tefINTERNAL;  // LCOV_EXCL_LINE
    if (fee > *required + view.fees().base * kSessionFeeMultiple)
        return tefSESSION_LIMIT;

    if (ownClose)
        return tesSUCCESS;

    // 5. Caps: the whole cost against what is left, and the amount per transaction.
    auto const cap = sle->getFieldAmount(sfSessionCap).xrp();
    auto const spent = sle->isFieldPresent(sfSessionSpent) ? sle->getFieldAmount(sfSessionSpent).xrp()
                                                           : XRPAmount{0};
    auto const amount = paymentAmount(tx);
    if (fee + amount > cap - spent)
        return tefSESSION_LIMIT;
    if (sle->isFieldPresent(sfSessionMaxPerTx) && amount > sle->getFieldAmount(sfSessionMaxPerTx).xrp())
        return tefSESSION_LIMIT;

    // 6. Witness: its signature was verified with the transaction's
    //    (STTx::checkSign); here it must come from the session's witness.
    if (auto const witness = (*sle)[~sfSessionWitness])
    {
        if (!tx.isFieldPresent(sfWitnessSignature) ||
            !witnessKeyIsValid(view, *witness, tx.getFieldObject(sfWitnessSignature)))
            return tefSESSION_NO_WITNESS;
    }

    return tesSUCCESS;
}

void
chargeSession(ApplyView& view, Keylet const& session, STTx const& tx, TER result, XRPAmount fee)
{
    if (isOwnClose(tx))
        return;
    auto const sle = view.peek(session);
    if (!sle)
        return;
    auto const spent = sle->isFieldPresent(sfSessionSpent) ? sle->getFieldAmount(sfSessionSpent).xrp()
                                                           : XRPAmount{0};
    auto const charged = fee + (isTesSuccess(result) ? paymentAmount(tx) : XRPAmount{0});
    sle->setFieldAmount(sfSessionSpent, STAmount{spent + charged});
    view.update(sle);
}

}  // namespace xrpl
