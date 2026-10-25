#pragma once

#include <xrpl/basics/base_uint.h>
#include <xrpl/beast/utility/Journal.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/XRPAmount.h>

#include <map>
#include <vector>

namespace xrpl {

/**
 * @brief Invariant: signing sessions keep their bounds (FIANSO-SPEC 6.7).
 *
 * The checks, for every transaction:
 *  1. Only SigningSessionSet creates a session, and only SigningSessionDelete
 *     or AccountDelete removes one; the owner count moves by one with each.
 *  2. Account, SessionKey, Expiration, Permissions, SessionCap,
 *     SessionMaxPerTx, SessionMaxTxCount, SessionWitness and the mode flag
 *     never change; a session has exactly one mode, SessionSpent only
 *     with SessionCap and zero at creation, SessionTxCount only with
 *     SessionMaxTxCount (within 1..kMaxSessionTxCount) and zero at creation;
 *     Expiration is within kMaxSessionDuration of the parent close time at
 *     creation.
 *  3. SessionSpent only increases, never above SessionCap, and only in a
 *     transaction its session signed (the own close is exempt).
 *     SessionTxCount increases by exactly one in each transaction its
 *     session signs and keeps (the own close is exempt), never otherwise,
 *     and never above SessionMaxTxCount.
 *  4. A mode-C session transaction other than the own close has the shape
 *     of a session cap payment (isSessionCapPayment), and counts at most
 *     SessionMaxPerTx beyond its fee. When it does not delete its session,
 *     it takes no more XRP from the account than SessionSpent counts,
 *     raises no owner count and changes no sponsoring count.
 *  5. A session-signed transaction never changes the account's RegularKey,
 *     master-disable flag, signer list, passkey list, delegate entries,
 *     beneficiary or firewall, nor another session of the account, and
 *     creates no sponsorship, subscription, credential or DID entry (the
 *     excluded types of isSessionExcluded).
 *
 * finalize sees only the final view, so visitEntry keeps every state it
 * needs. A transaction is session-signed when the session its shape names
 * (sessionKeyletOf) existed before it: visited with a `before` state, or not
 * visited and still in the view.
 */
class ValidSigningSession
{
    // <before, after>; before is null for a creation, after for a deletion.
    using Change = std::pair<SLE::const_pointer, SLE::const_pointer>;

    std::map<uint256, Change> sessions_;
    std::map<AccountID, Change> accounts_;
    std::vector<Change> authority_;
    // A sponsorship, subscription, credential or DID entry was created.
    bool excludedCreated_ = false;

public:
    void
    visitEntry(bool, SLE::const_ref, SLE::const_ref);

    [[nodiscard]] bool
    finalize(STTx const&, TER const, XRPAmount const, ReadView const&, beast::Journal const&);
};

}  // namespace xrpl
