#include <xrpl/tx/invariants/SigningSessionInvariant.h>

#include <xrpl/basics/Log.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STAccount.h>  // IWYU pragma: keep
#include <xrpl/protocol/STAmount.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/TxFormats.h>
#include <xrpl/tx/transactors/session/SigningSession.h>

#include <array>

namespace xrpl {

namespace {

/** Fields of a session fixed at creation (rule 2). sfFlags carries the mode. */
std::array<SField const*, 8> const kFixedSessionFields{
    &sfAccount,
    &sfSessionKey,
    &sfExpiration,
    &sfSessionCap,
    &sfSessionMaxPerTx,
    &sfSessionWitness,
    &sfPermissions,
    &sfFlags,
};

/** Both entries have the field with the same value, or neither has it. */
bool
sameField(SLE const& before, SLE const& after, SField const& field)
{
    bool const present = before.isFieldPresent(field);
    if (present != after.isFieldPresent(field))
        return false;
    if (!present)
        return true;
    auto const* const lhs = before.peekAtPField(field);
    auto const* const rhs = after.peekAtPField(field);
    return lhs != nullptr && rhs != nullptr && *lhs == *rhs;
}

XRPAmount
spentOf(SLE const& session)
{
    return session.isFieldPresent(sfSessionSpent) ? session.getFieldAmount(sfSessionSpent).xrp()
                                                  : XRPAmount{0};
}

/** The entry is one of the account's authority entries (rule 4). */
bool
isAuthorityOf(SLE const& sle, AccountID const& account)
{
    switch (sle.getType())
    {
        case ltSIGNER_LIST:
            return sle.key() == keylet::signerList(account).key;
        case ltPASSKEY_LIST:
            return sle.key() == keylet::passkeyList(account).key;
        case ltDELEGATE:
            return sle.getAccountID(sfAccount) == account;
        default:
            return false;
    }
}

}  // namespace

void
ValidSigningSession::visitEntry(bool isDelete, SLE::const_ref before, SLE::const_ref after)
{
    auto const& sle = after ? after : before;
    if (!sle)
        return;  // LCOV_EXCL_LINE

    switch (sle->getType())
    {
        case ltSIGNING_SESSION:
            sessions_.push_back({isDelete, before, after});
            break;
        case ltACCOUNT_ROOT:
            if (before && after)
                accounts_.emplace_back(before, after);
            break;
        case ltSIGNER_LIST:
        case ltPASSKEY_LIST:
        case ltDELEGATE:
            authority_.push_back(sle);
            break;
        default:
            break;
    }
}

std::optional<Keylet>
ValidSigningSession::signingSession(STTx const& tx, ReadView const& view) const
{
    // An own close has erased its session by now: the signer is its SessionKey.
    if (isOwnClose(tx))
        return keylet::signingSession(tx.getAccountID(sfAccount), tx.getAccountID(sfSessionKey));

    auto const session = sessionOf(view, tx);
    if (!session)
        return std::nullopt;

    // A session this transaction created did not sign it.
    for (auto const& change : sessions_)
    {
        if (!change.before && change.after && change.after->key() == session->key)
            return std::nullopt;
    }
    return session;
}

bool
ValidSigningSession::finalize(
    STTx const& tx,
    TER const,
    XRPAmount const,
    ReadView const& view,
    beast::Journal const& j)
{
    // A session cannot exist unless the amendment is enabled, so the amendment
    // needs no separate check here.
    auto const txType = tx.getTxnType();
    auto const account = tx.getAccountID(sfAccount);
    auto const signedBy = signingSession(tx, view);

    for (auto const& [isDelete, before, after] : sessions_)
    {
        // Rule 1: who creates and who removes a session.
        if (isDelete && txType != ttSIGNING_SESSION_DELETE && txType != ttACCOUNT_DELETE)
        {
            JLOG(j.fatal())
                << "Invariant failed: a signing session was removed by transaction type " << txType;
            return false;
        }
        if (!before && !isDelete && txType != ttSIGNING_SESSION_SET)
        {
            JLOG(j.fatal())
                << "Invariant failed: a signing session was created by transaction type " << txType;
            return false;
        }

        // Rule 4: a session-signed transaction leaves the account's other sessions alone.
        auto const& sle = after ? after : before;
        if (signedBy && sle->key() != signedBy->key && sle->getAccountID(sfAccount) == account)
        {
            JLOG(j.fatal()) << "Invariant failed: a session-signed transaction changed "
                               "another signing session of its account";
            return false;
        }

        if (!after)
            continue;  // LCOV_EXCL_LINE

        // Rule 3: SessionSpent stays within SessionCap.
        auto const spentAfter = spentOf(*after);
        if (after->isFieldPresent(sfSessionCap) &&
            spentAfter > after->getFieldAmount(sfSessionCap).xrp())
        {
            JLOG(j.fatal()) << "Invariant failed: a signing session spent more than its cap";
            return false;
        }

        if (!before)
            continue;

        // Rule 2: what was granted never changes.
        for (auto const* field : kFixedSessionFields)
        {
            if (!sameField(*before, *after, *field))
            {
                JLOG(j.fatal()) << "Invariant failed: a signing session's " << field->getName()
                                << " changed";
                return false;
            }
        }

        // Rule 3: SessionSpent only grows, and only under its own session.
        auto const spentBefore = spentOf(*before);
        if (spentAfter < spentBefore)
        {
            JLOG(j.fatal()) << "Invariant failed: a signing session's SessionSpent decreased";
            return false;
        }
        if (spentAfter != spentBefore && (!signedBy || after->key() != signedBy->key))
        {
            JLOG(j.fatal()) << "Invariant failed: a signing session's SessionSpent changed "
                               "outside a transaction it signed";
            return false;
        }
    }

    if (!signedBy)
        return true;

    // Rule 4: a session-signed transaction never changes who controls the account.
    for (auto const& [before, after] : accounts_)
    {
        if (after->getAccountID(sfAccount) != account)
            continue;
        if (!sameField(*before, *after, sfRegularKey) ||
            before->isFlag(lsfDisableMaster) != after->isFlag(lsfDisableMaster))
        {
            JLOG(j.fatal()) << "Invariant failed: a session-signed transaction changed the "
                               "account's RegularKey or master key flag";
            return false;
        }
    }

    for (auto const& sle : authority_)
    {
        if (isAuthorityOf(*sle, account))
        {
            JLOG(j.fatal()) << "Invariant failed: a session-signed transaction changed the "
                               "account's signer list, passkey list or delegate entries";
            return false;
        }
    }

    return true;
}

}  // namespace xrpl
