#pragma once

#include <xrpl/ledger/ApplyView.h>
#include <xrpl/ledger/ReadView.h>
#include <xrpl/protocol/Keylet.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/XRPAmount.h>

#include <cstdint>
#include <optional>

namespace xrpl {

struct PreclaimContext;

/** Longest session the node accepts, in seconds (FIANSO-SPEC 6.9, D2). */
constexpr std::uint32_t kMaxSessionDuration = 600;
/** Multiple of the base fee unit a session transaction may pay on top of its required fee. */
constexpr std::uint32_t kSessionFeeMultiple = 1000;
/** A session transaction must expire within this many ledgers (LastLedgerSequence). */
constexpr std::uint32_t kSessionMaxLedgerWindow = 256;

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
 * 6.5): eligibility (mode C: XRP payments only), LastLedgerSequence window,
 * expiry, fee ceiling, total and per-transaction caps, and the witness when
 * the session has one. Every refusal is a tef: no fee is charged.
 */
NotTEC
checkSession(PreclaimContext const& ctx, Keylet const& session);

/**
 * Adds what a session-signed transaction cost to SessionSpent (FIANSO-SPEC
 * 6.6): the fee for every outcome that claims it, plus the amount of a
 * successful payment. A session closing itself is not charged.
 */
void
chargeSession(ApplyView& view, Keylet const& session, STTx const& tx, TER result, XRPAmount fee);

}  // namespace xrpl
