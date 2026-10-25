/*******************************************************************************
 *   carbs: protocol numbers of the SigningSessions amendment (FIANSO-SPEC 6.1).
 *
 *   Every number the app relies on for SigningSessionSet / SigningSessionDelete
 *   is here and nowhere else. They must match rippled's protocol macros
 *   (transactions.macro, sfields.macro, TxFlags.h) and the node's
 *   server_definitions: check them again whenever the amendment changes.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_SIGNING_SESSION_H
#define LEDGER_APP_XRP_SIGNING_SESSION_H

#include <stdbool.h>
#include <stdint.h>

// Transaction types (6.1)
#define TRANSACTION_SIGNING_SESSION_SET    130
#define TRANSACTION_SIGNING_SESSION_DELETE 131

// Fields (6.1). Reused existing fields: Owner (ACCOUNT 2), Permissions
// (ARRAY 29) holding Permission objects (OBJECT 15).
#define XRP_ACCOUNT_SESSION_KEY       34   // SessionKey, AccountID
#define XRP_UINT64_SESSION_CAP        47   // SessionCap, Amount (XRP only)
#define XRP_UINT32_SESSION_DURATION   114  // SessionDuration, seconds
#define XRP_UINT32_PERMISSION_VALUE   52   // PermissionValue, inside Permissions
#define XRP_STARRAY_PERMISSIONS       29
#define XRP_STOBJECT_PERMISSION       15

// carbs protections on top of the spec (PR #29): largest single payment, and
// the account that must co-sign every session transaction. Its WitnessSignature
// is not a signing field, so the device never parses it.
#define XRP_UINT64_SESSION_MAX_PER_TX 49   // SessionMaxPerTx, Amount (XRP only)
#define XRP_ACCOUNT_SESSION_WITNESS   35   // SessionWitness, AccountID

// The most transactions the session may sign, in any mode: 1 to 100000, the
// node counts them in the ledger entry's SessionTxCount.
#define XRP_UINT32_SESSION_MAX_TX_COUNT 115  // SessionMaxTxCount

// SigningSessionSet flag: mode A (6.1). SigningSessionDelete has no flag.
#define TF_ALL_TRANSACTIONS 0x00010000u

// Not a real XRPL field code: the synthetic "Note" row the app appends to a
// SigningSessionSet review (7.3 f). A real field carrying this id in the
// signed data is refused by the parser, so the row cannot be spoofed.
#define XRP_VL_SESSION_NOTE 0xFD
#define SESSION_NOTE_TEXT   "Cannot change keys or signers"

// Not a real XRPL field code either: the synthetic "Allows" row of a mode C
// review (a SessionCap is set). The node lets such a session sign a direct
// XRP payment and nothing else, and counts the fee against the cap
// (rippled Transactor.cpp, mode C and rule 5). Refused like the Note id.
#define XRP_VL_SESSION_SCOPE   0xFC
#define SESSION_SCOPE_CAP_TEXT "XRP payments only, fees included"

// Not a real XRPL field code: the synthetic "Agent ID" row the app appends
// after the session key, refused in signed data like the "Note" row. Its
// value is the first 4 bytes of the SessionKey AccountID in uppercase hex,
// grouped "XXXX-XXXX", so the agent can show the same short identifier
// (docs/device-contract.md).
#define XRP_ACCOUNT_AGENT_ID 0xFC

// Not a real XRPL field code: the synthetic "Profile" row the app appends to
// a SigningSessionSet checked against a session profile (session_profiles.h),
// refused in signed data like the "Note" row.
#define XRP_VL_SESSION_PROFILE 0xFB

// Parse result of a session transaction that cannot be clear-signed: it is
// refused, never offered for blind signing, whatever the setting says.
// Follows BLIND_SIGN_REQUIRED (20); the classical path answers 0x6815.
#define SESSION_BLIND_SIGN_REFUSED 21

static inline bool is_session_transaction(uint16_t transaction_type) {
    return transaction_type == TRANSACTION_SIGNING_SESSION_SET ||
           transaction_type == TRANSACTION_SIGNING_SESSION_DELETE;
}

#endif  // LEDGER_APP_XRP_SIGNING_SESSION_H
