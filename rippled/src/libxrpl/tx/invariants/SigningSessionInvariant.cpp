#include <xrpl/tx/invariants/SigningSessionInvariant.h>

#include <xrpl/basics/Log.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/LedgerFormats.h>
#include <xrpl/protocol/Protocol.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STArray.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFormats.h>
#include <xrpl/protocol/XRPAmount.h>
#include <xrpl/tx/SigningSession.h>

#include <cstdint>
#include <map>
#include <tuple>

namespace xrpl {

namespace {

XRPAmount
spentOf(SLE::const_pointer const& session)
{
    return session && session->isFieldPresent(sfSessionSpent)
        ? session->getFieldAmount(sfSessionSpent).xrp()
        : XRPAmount{0};
}

// Whether an entry of the account's authority belongs to `account`.
bool
isAuthorityOf(SLE const& sle, AccountID const& account)
{
    switch (sle.getType())
    {
        case ltSIGNER_LIST:
            return sle.key() == keylet::signerList(account).key;
        case ltPASSKEY_LIST:
            return sle.key() == keylet::passkeyList(account).key;
        case ltFIREWALL:
            return sle.key() == keylet::firewall(account).key;
        case ltDELEGATE:
        case ltBENEFICIARY:
            return sle.getAccountID(sfAccount) == account;
        default:
            return false;  // LCOV_EXCL_LINE
    }
}

bool
sameImmutableFields(SLE const& before, SLE const& after)
{
    auto const permissionsOf = [](SLE const& sle) {
        return sle.isFieldPresent(sfPermissions) ? sle.getFieldArray(sfPermissions) : STArray{};
    };
    return before[sfAccount] == after[sfAccount] && before[sfSessionKey] == after[sfSessionKey] &&
        before[sfExpiration] == after[sfExpiration] &&
        before[~sfSessionCap] == after[~sfSessionCap] &&
        before.isFlag(lsfAllTransactions) == after.isFlag(lsfAllTransactions) &&
        permissionsOf(before) == permissionsOf(after);
}

}  // namespace

void
ValidSigningSession::visitEntry(bool isDelete, SLE::const_ref before, SLE::const_ref after)
{
    auto const& sle = after ? after : before;
    if (!sle)
        return;  // LCOV_EXCL_LINE

    Change const change{before, isDelete ? nullptr : after};
    switch (sle->getType())
    {
        case ltSIGNING_SESSION:
            sessions_[sle->key()] = change;
            break;
        case ltACCOUNT_ROOT:
            accounts_[sle->getAccountID(sfAccount)] = change;
            break;
        case ltSIGNER_LIST:
        case ltPASSKEY_LIST:
        case ltDELEGATE:
        case ltBENEFICIARY:
        case ltFIREWALL:
            authority_.push_back(change);
            break;
        default:
            break;
    }
}

bool
ValidSigningSession::finalize(
    STTx const& tx,
    TER const,
    XRPAmount const,
    ReadView const& view,
    beast::Journal const& j)
{
    // The session the transaction's shape names, if any; nothing to check
    // when no session moved and none could have signed.
    auto const candidate = sessionKeyletOf(view.rules(), tx);
    if (sessions_.empty() && !candidate)
        return true;

    bool ok = true;
    auto const fail = [&](char const* what) {
        JLOG(j.fatal()) << "Invariant failed: " << what;
        ok = false;
    };

    AccountID const account = tx.getAccountID(sfAccount);
    auto const type = tx.getTxnType();

    // Session-signed: the named session existed before the transaction.
    bool sessionSigned = false;
    SLE::const_pointer sessionBefore;
    SLE::const_pointer sessionAfter;
    if (candidate)
    {
        if (auto const it = sessions_.find(candidate->key); it != sessions_.end())
        {
            std::tie(sessionBefore, sessionAfter) = it->second;
        }
        else
        {
            sessionBefore = sessionAfter = view.read(*candidate);
        }
        sessionSigned = sessionBefore != nullptr;
    }
    bool const ownClose = sessionSigned && isSessionOwnClose(tx);

    // Rules 1, 2 and 3, session by session.
    std::uint32_t const now = view.parentCloseTime().time_since_epoch().count();
    std::map<AccountID, std::int64_t> ownerDelta;
    for (auto const& [key, change] : sessions_)
    {
        auto const& [before, after] = change;
        if (!before && after)
        {
            if (type != ttSIGNING_SESSION_SET)
                fail("a signing session was created by a transaction other than SigningSessionSet");
            ++ownerDelta[after->getAccountID(sfAccount)];

            bool const hasCap = after->isFieldPresent(sfSessionCap);
            int const modes = static_cast<int>(after->isFlag(lsfAllTransactions)) +
                static_cast<int>(after->isFieldPresent(sfPermissions)) + static_cast<int>(hasCap);
            if (modes != 1 || hasCap != after->isFieldPresent(sfSessionSpent) ||
                spentOf(after) != XRPAmount{0})
                fail("a signing session does not have exactly one mode");

            auto const expiration = (*after)[sfExpiration];
            if (expiration <= now || expiration - now > kMaxSessionDuration)
                fail("a signing session expires beyond its maximum duration");
        }
        else if (before && !after)
        {
            if (type != ttSIGNING_SESSION_DELETE && type != ttACCOUNT_DELETE)
            {
                fail(
                    "a signing session was deleted by a transaction other than "
                    "SigningSessionDelete or AccountDelete");
            }
            if (type != ttACCOUNT_DELETE)
                --ownerDelta[before->getAccountID(sfAccount)];
        }
        else if (before && after)
        {
            if (!sameImmutableFields(*before, *after))
                fail("a signing session changed a field that never changes");

            auto const spentBefore = spentOf(before);
            auto const spentAfter = spentOf(after);
            if (spentAfter < spentBefore)
                fail("a signing session's SessionSpent decreased");
            if (auto const cap = (*after)[~sfSessionCap]; cap && spentAfter > cap->xrp())
                fail("a signing session spent more than its SessionCap");
            if (spentAfter != spentBefore && !(sessionSigned && !ownClose && key == candidate->key))
                fail("a signing session's SessionSpent changed outside a transaction it signed");
        }
    }

    // Rule 1: the owner count follows the sessions created and deleted. A
    // ticket the transaction consumes lowers the account's count by one more.
    for (auto const& [owner, delta] : ownerDelta)
    {
        auto expected = delta;
        if (owner == account && tx.isFieldPresent(sfTicketSequence))
            --expected;
        if (expected == 0)
            continue;

        auto const it = accounts_.find(owner);
        if (it == accounts_.end() || !it->second.first || !it->second.second ||
            std::int64_t{(*it->second.second)[sfOwnerCount]} -
                    std::int64_t{(*it->second.first)[sfOwnerCount]} !=
                expected)
            fail("a signing session was created or deleted without its owner count");
    }

    if (!sessionSigned)
        return ok;

    auto const accountIt = accounts_.find(account);
    bool const accountChanged =
        accountIt != accounts_.end() && accountIt->second.first && accountIt->second.second;

    // Rule 4: a mode-C session transaction that keeps its session.
    if (!ownClose && sessionAfter && sessionAfter->isFieldPresent(sfSessionCap) && accountChanged)
    {
        auto const& [before, after] = accountIt->second;
        auto const counted = spentOf(sessionAfter) - spentOf(sessionBefore);
        auto const taken = (*before)[sfBalance].xrp() - (*after)[sfBalance].xrp();
        if (taken > counted)
            fail("a mode-C session transaction took more XRP than its session counted");
        if ((*after)[sfOwnerCount] > (*before)[sfOwnerCount])
            fail("a mode-C session transaction raised the owner count");
        if ((*before)[~sfSponsoringOwnerCount] != (*after)[~sfSponsoringOwnerCount] ||
            (*before)[~sfSponsoringAccountCount] != (*after)[~sfSponsoringAccountCount])
            fail("a mode-C session transaction changed a sponsoring count");
    }

    // Rule 5: the authority of the account, and its other sessions.
    bool authorityChanged = false;
    if (accountChanged)
    {
        auto const& [before, after] = accountIt->second;
        authorityChanged = (*before)[~sfRegularKey] != (*after)[~sfRegularKey] ||
            before->isFlag(lsfDisableMaster) != after->isFlag(lsfDisableMaster);
    }
    for (auto const& [before, after] : authority_)
    {
        if (isAuthorityOf(after ? *after : *before, account))
            authorityChanged = true;
    }
    if (authorityChanged)
        fail("a session-signed transaction changed the account's authority");

    for (auto const& [key, change] : sessions_)
    {
        auto const& sle = change.second ? change.second : change.first;
        if (key != candidate->key && sle->getAccountID(sfAccount) == account)
        {
            fail("a session-signed transaction changed another session of the account");
            break;
        }
    }

    return ok;
}

}  // namespace xrpl
