/*******************************************************************************
 *   carbs: session profiles, named sets of limits a SigningSessionSet selects
 *   with a memo (MemoType "carbs-profile", MemoData the profile's name).
 *
 *   The limits of each profile are edited only from the device settings and
 *   stored in NVM as preset indices (session_profile_settings_t): all zero is
 *   a profile on, with its default limits. The modes and permissions a
 *   profile allows are fixed. Pure code: no NVM, no UI.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_SESSION_PROFILES_H
#define LEDGER_APP_XRP_SESSION_PROFILES_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "xrp_parse.h"

typedef enum {
    SESSION_PROFILE_AGENT = 0,
    SESSION_PROFILE_GAME,
    SESSION_PROFILE_TRADING,
    SESSION_PROFILE_STREAMING,
    SESSION_PROFILE_MINTING,
    SESSION_PROFILES_NB,
} session_profile_id_t;

// MemoType of the memo that selects a profile
#define SESSION_PROFILE_MEMO_TYPE "carbs-profile"

// Session modes a profile allows (bit mask)
#define SESSION_MODE_CAP         0x01  // C: SessionCap
#define SESSION_MODE_ALL         0x02  // A: tfAllTransactions
#define SESSION_MODE_PERMISSIONS 0x04  // P: Permissions

// Most permissions a profile allows (trading: OfferCreate, OfferCancel)
#define SESSION_PROFILE_MAX_PERMISSIONS 2

// The limits a user edits, one per profile
typedef enum {
    SESSION_PROFILE_LIMIT_CAP = 0,
    SESSION_PROFILE_LIMIT_PER_TX,
    SESSION_PROFILE_LIMIT_DURATION,
    SESSION_PROFILE_LIMIT_TX_COUNT,
    SESSION_PROFILE_LIMITS_NB,
} session_profile_limit_t;

// NVM layout of one profile (part of session_policy_t): 5 bytes.
typedef struct {
    uint8_t disabled;                          // 0: on (fresh install)
    uint8_t limits[SESSION_PROFILE_LIMITS_NB];  // preset index + 1, 0: the default
} session_profile_settings_t;

// A profile's effective rules, resolved from its settings
typedef struct {
    bool enabled;
    uint8_t modes;  // SESSION_MODE_*
    uint8_t permissions_nb;
    uint32_t permissions[SESSION_PROFILE_MAX_PERMISSIONS];  // PermissionValue
    uint64_t max_cap;                                       // drops, 0 outside mode C
    uint64_t max_per_tx;                                    // drops, 0 outside mode C
    uint32_t max_duration;                                  // seconds
    uint32_t max_tx_count;
} session_profile_t;

// "Game"
const char *session_profile_title(session_profile_id_t id);

// The MemoData that selects a profile ("game"). Returns false when data
// names none.
bool session_profile_from_memo(const uint8_t *data, size_t length, session_profile_id_t *id);

void session_profile_resolve(session_profile_id_t id,
                             const session_profile_settings_t *settings,
                             session_profile_t *profile);

// Whether a limit applies to this profile: max spend and max per payment
// only to the profiles of mode C.
bool session_profile_has_limit(session_profile_id_t id, session_profile_limit_t limit);

// The stored setting of the next preset of a limit, after the current one.
uint8_t session_profile_next_limit(session_profile_id_t id,
                                   session_profile_limit_t limit,
                                   uint8_t setting);

// The carbs-profile memos of a transaction
typedef enum {
    SESSION_PROFILE_MEMO_NONE = 0,  // the default limits apply
    SESSION_PROFILE_MEMO_FOUND,
    SESSION_PROFILE_MEMO_UNKNOWN,    // a name no profile has
    SESSION_PROFILE_MEMO_DUPLICATE,  // more than one
} session_profile_memo_t;

// Reads the carbs-profile memos among the top-level Memos of a parsed
// transaction; id is set when one names a profile (SESSION_PROFILE_MEMO_FOUND).
session_profile_memo_t session_profile_read_memo(const parseResult_t *result,
                                                 session_profile_id_t *id);

#endif  // LEDGER_APP_XRP_SESSION_PROFILES_H
