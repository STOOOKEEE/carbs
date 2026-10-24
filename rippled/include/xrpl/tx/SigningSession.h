#pragma once

#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/Keylet.h>
#include <xrpl/protocol/Rules.h>
#include <xrpl/protocol/STLedgerEntry.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TxFormats.h>

#include <array>
#include <optional>

namespace xrpl {

/**
 * Delegable transaction types that a signing session never signs: each one
 * grants rights to a new key or to a third party that no amount fixed at
 * signing bounds (FIANSO-SPEC 6.8). Every other type follows its XLS-75
 * `delegable` setting.
 */
inline constexpr std::array<TxType, 3> kSessionExcluded = {
    ttPASSKEY_LIST_SET,
    ttSPONSORSHIP_SET,
    ttSUBSCRIPTION_SET,
};

/**
 * Whether `type` is in kSessionExcluded.
 */
[[nodiscard]] bool
isSessionExcluded(TxType type) noexcept;

/**
 * Whether a session in mode A may sign `type`, and whether a session in mode P
 * may list it: the type is delegable and not excluded.
 */
[[nodiscard]] bool
isSessionEligibleType(TxType type, Rules const& rules);

/**
 * The session that authorizes `tx`, if `tx` is session-signed.
 *
 * A transaction is session-signed when the SigningSessions amendment is
 * enabled; it is single-signed with a key of a known type and has no Signers;
 * it carries no Delegate, Sponsor, SponsorSignature or CounterpartySignature
 * and is not a Batch inner transaction; and a session exists for its Account
 * and the AccountID of its SigningPubKey.
 *
 * Authorization, accounting and the ValidSigningSession invariant all ask this
 * function, so that they cannot disagree.
 */
[[nodiscard]] std::optional<Keylet>
signingSessionOf(ReadView const& view, STTx const& tx);

/**
 * Whether `tx` is session-signed: signingSessionOf finds its session.
 */
[[nodiscard]] bool
isSessionSigned(ReadView const& view, STTx const& tx);

/**
 * Whether `tx` has the shape of a session's own close: a SigningSessionDelete
 * without Owner whose SessionKey is the AccountID of its SigningPubKey.
 */
[[nodiscard]] bool
isSessionOwnClose(STTx const& tx);

/**
 * Whether `session` has expired: the parent close time has reached its
 * Expiration. A session is usable strictly before Expiration.
 */
[[nodiscard]] bool
isSessionExpired(ReadView const& view, SLE const& session);

}  // namespace xrpl
