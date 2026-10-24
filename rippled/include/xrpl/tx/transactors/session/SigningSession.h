#pragma once

#include <xrpl/ledger/ApplyView.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/Keylet.h>
#include <xrpl/protocol/Permissions.h>
#include <xrpl/protocol/Rules.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFormats.h>
#include <xrpl/protocol/XRPAmount.h>

#include <array>
#include <cstdint>
#include <optional>
#include <unordered_set>

namespace xrpl {

struct PreclaimContext;

/** Longest session the node accepts, in seconds (FIANSO-SPEC 6.9, D2). */
constexpr std::uint32_t kMaxSessionDuration = 600;
/** Multiple of the base fee unit a session transaction may pay on top of its required fee. */
constexpr std::uint32_t kSessionFeeMultiple = 1000;
/** A session transaction must expire within this many ledgers (LastLedgerSequence). */
constexpr std::uint32_t kSessionMaxLedgerWindow = 256;

/**
 * Delegable transaction types no session may sign, in any mode (FIANSO-SPEC
 * 6.8): they grant or change authority, or open rights for a third party that
 * no amount fixed at signing bounds.
 */
inline constexpr std::array<TxType, 3> kSessionExcluded{
    ttPASSKEY_LIST_SET,
    ttSUBSCRIPTION_SET,
    ttSPONSORSHIP_SET,
};

/** True when `type` is in kSessionExcluded. */
bool
isSessionExcluded(TxType type);

/**
 * A permission value a mode P session may hold: delegable (transaction level
 * or granular) and not tied to an excluded transaction type.
 */
bool
isSessionPermission(std::uint32_t permissionValue, Rules const& rules);

/** The transactor's T::checkGranularSemantics, which mode P runs like
 * Transactor::invokeCheckPermission<T>. */
using GranularSemanticsCheck = NotTEC (*)(
    ReadView const& view,
    STTx const& tx,
    std::unordered_set<GranularPermissionType> const& heldGranularPermissions);

/**
 * The session of a session-signed transaction, if it is one (FIANSO-SPEC 6.4):
 * single-signed, no Delegate, no sponsor, not a Batch inner transaction, no
 * CounterpartySignature, and a SigningSession exists for (Account,
 * AccountID(SigningPubKey)). One function serves authorization and accounting
 * so that they cannot disagree.
 */
std::optional<Keylet>
sessionOf(ReadView const& view, STTx const& tx);

/** SigningSessionDelete without Owner, whose SessionKey is the signer: a session closing itself. */
bool
isOwnClose(STTx const& tx);

/**
 * Authorizes a session-signed transaction in place of checkSign (FIANSO-SPEC
 * 6.5): eligibility for the session's mode (A: any delegable, non-excluded
 * type; P: its Permissions, checked like a delegate's, `granularSemantics`
 * included; C: XRP payments only), LastLedgerSequence window, expiry, fee
 * ceiling, the caps in mode C, and the witness when the session has one.
 * Every refusal is a tef: no fee is charged.
 */
NotTEC
checkSession(
    PreclaimContext const& ctx,
    Keylet const& session,
    GranularSemanticsCheck granularSemantics);

/**
 * Adds what a session-signed transaction cost to SessionSpent (FIANSO-SPEC
 * 6.6), mode C only: the fee for every outcome that claims it, plus the
 * amount of a successful payment. A session closing itself is not charged.
 */
void
chargeSession(ApplyView& view, Keylet const& session, STTx const& tx, TER result, XRPAmount fee);

}  // namespace xrpl
