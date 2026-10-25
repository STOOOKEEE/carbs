#pragma once

#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/AccountID.h>
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
 * signing bounds, and that outlive the session (FIANSO-SPEC 6.8, decision
 * D4). A credential is a lasting attestation that other accounts' deposit
 * preauthorizations and permissioned domains accept; a DID is the account's
 * lasting identity document. Every other type follows its XLS-75
 * `delegable` setting.
 */
inline constexpr std::array<TxType, 5> kSessionExcluded = {
    ttPASSKEY_LIST_SET,
    ttSPONSORSHIP_SET,
    ttSUBSCRIPTION_SET,
    ttCREDENTIAL_CREATE,
    ttDID_SET,
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
 * The keylet of the session that would authorize `tx`, from its shape alone:
 * the conditions of signingSessionOf except that the session exists. The
 * invariant uses it to find a session the transaction itself deleted.
 */
[[nodiscard]] std::optional<Keylet>
sessionKeyletOf(Rules const& rules, STTx const& tx);

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
 * Whether `tx` has a shape a session in mode C may sign: a Payment of XRP
 * whose only flag is tfFullyCanonicalSig and whose only fields besides the
 * common ones are Destination, DestinationTag and Amount. A closed whitelist:
 * SendMax, Paths, DeliverMin, partial payments and the sponsored creation of
 * an account move value the cap does not see.
 */
[[nodiscard]] bool
isSessionCapPayment(STTx const& tx);

/**
 * Whether `session` has expired: the parent close time has reached its
 * Expiration. A session is usable strictly before Expiration.
 */
[[nodiscard]] bool
isSessionExpired(ReadView const& view, SLE const& session);

/**
 * Whether `tx` carries a WitnessSignature made by a key of `witness`: its
 * master key, if enabled, or its RegularKey. The signature itself is verified
 * with the transaction's (STTx::checkSign); this checks that the key belongs
 * to the witness account.
 */
[[nodiscard]] bool
isSessionWitnessed(ReadView const& view, STTx const& tx, AccountID const& witness);

}  // namespace xrpl
