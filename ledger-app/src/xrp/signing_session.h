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

// SigningSessionSet flag: mode A (6.1). SigningSessionDelete has no flag.
#define TF_ALL_TRANSACTIONS 0x00010000u

// Not a real XRPL field code: the synthetic "Note" row the app appends to a
// SigningSessionSet review (7.3 f). A real field carrying this id in the
// signed data is refused by the parser, so the row cannot be spoofed.
#define XRP_VL_SESSION_NOTE 0xFD
#define SESSION_NOTE_TEXT   "Cannot change keys, signers or the account"

#endif  // LEDGER_APP_XRP_SIGNING_SESSION_H
