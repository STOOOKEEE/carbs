#pragma once

#include <xrpl/beast/utility/Journal.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/Keylet.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/XRPAmount.h>

#include <optional>
#include <utility>
#include <vector>

namespace xrpl {

/**
 * Signing sessions stay within what was granted (FIANSO-SPEC 6.7).
 *
 * 1. Only SigningSessionSet creates a session, and only SigningSessionDelete
 *    or AccountDelete removes one.
 * 2. Account, SessionKey, Expiration, SessionCap, SessionMaxPerTx,
 *    SessionWitness, Permissions and the entry flags never change.
 * 3. SessionSpent only increases, never exceeds SessionCap, and only changes
 *    in a transaction signed by that session.
 * 4. A session-signed transaction never touches the account's RegularKey or
 *    master-disable flag, its signer list, its passkey list, its delegate
 *    entries, or another session of the account.
 *
 * finalize only sees the final view, where an own close has already erased
 * its session, so every state it needs is captured in visitEntry.
 */
class ValidSigningSession
{
    struct Change
    {
        bool isDelete;
        // Unseated when the entry is being created.
        SLE::const_pointer before;
        SLE::const_pointer after;
    };

    std::vector<Change> sessions_;
    // Account roots modified or deleted: <before, after>.
    std::vector<std::pair<SLE::const_pointer, SLE::const_pointer>> accounts_;
    // Signer lists, passkey lists and delegate entries touched by the transaction.
    std::vector<SLE::const_pointer> authority_;

    /** The session that signed the transaction, if it existed before it. */
    std::optional<Keylet>
    signingSession(STTx const& tx, ReadView const& view) const;

public:
    void
    visitEntry(bool, SLE::const_ref, SLE::const_ref);

    [[nodiscard]] bool
    finalize(STTx const&, TER const, XRPAmount const, ReadView const&, beast::Journal const&);
};

}  // namespace xrpl
