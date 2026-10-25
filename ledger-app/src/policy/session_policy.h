/*******************************************************************************
 *   carbs: session policy, the user's own limits on the signing sessions this
 *   device agrees to open (mirror of Ledger's Agent Policies, on the device).
 *
 *   Stored in NVM, edited only from the device settings, read by the host
 *   through INS_GET_SESSION_POLICY. When it is on, every SigningSessionSet
 *   (alone or inside a Batch) is checked before its review is shown; one that
 *   goes beyond it is refused with SW_SESSION_POLICY_REFUSED. A
 *   SigningSessionSet that names a profile (session_profiles.h) is checked
 *   against that profile instead of the default limits.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_SESSION_POLICY_H
#define LEDGER_APP_XRP_SESSION_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "session_profiles.h"
#include "xrp_parse.h"

// Status word of a session transaction refused by the policy
#define SW_SESSION_POLICY_REFUSED 0x6986

// A limit set to this value is not checked
#define SESSION_POLICY_NO_LIMIT 0

// INS_GET_SESSION_POLICY answer (docs/device-contract.md section 7). The
// default policy: version, flags, max cap, max per payment (drops,
// big-endian uint64), max duration (seconds, big-endian uint32). Then the
// number of profiles and one record each: id, flags, modes, max cap, max per
// payment, max duration, max transactions (big-endian uint32), the number of
// permissions and each PermissionValue (big-endian uint32).
#define SESSION_POLICY_FORMAT_VERSION 2
#define SESSION_POLICY_HEADER_SIZE    22
#define SESSION_PROFILE_RECORD_SIZE   28  // without its permissions
#define SESSION_POLICY_SERIALIZED_MAX_SIZE \
    (SESSION_POLICY_HEADER_SIZE + 1 +      \
     SESSION_PROFILES_NB *                 \
         (SESSION_PROFILE_RECORD_SIZE + SESSION_PROFILE_MAX_PERMISSIONS * sizeof(uint32_t)))

#define SESSION_POLICY_FLAG_ENABLED          0x01
#define SESSION_POLICY_FLAG_ALLOW_ALL        0x02
#define SESSION_POLICY_FLAG_ALLOW_PERMISSION 0x04
#define SESSION_POLICY_FLAG_REQUIRE_WITNESS  0x08

#define SESSION_PROFILE_FLAG_ENABLED 0x01

// NVM layout (part of internal_storage_t). All zero = policy off, every
// profile on with its default limits.
typedef struct {
    uint8_t enabled;
    uint8_t allow_all_transactions;  // mode A (tfAllTransactions)
    uint8_t allow_permissions;       // mode P (Permissions)
    uint8_t require_witness;         // SessionWitness must be present
    uint32_t max_duration;           // seconds, or SESSION_POLICY_NO_LIMIT
    uint64_t max_cap;                // drops, or SESSION_POLICY_NO_LIMIT
    uint64_t max_per_tx;             // drops, or SESSION_POLICY_NO_LIMIT
    session_profile_settings_t profiles[SESSION_PROFILES_NB];
} session_policy_t;

// What a SigningSessionSet asks for, read from the parsed fields
typedef struct {
    bool all_transactions;  // tfAllTransactions set (mode A)
    bool has_permissions;   // a Permissions array (mode P)
    uint8_t permissions_nb;
    uint32_t permissions[MAX_ARRAY_LEN];  // PermissionValue
    bool has_cap;                         // a SessionCap (mode C)
    bool cap_is_xrp;                      // a positive XRP amount the node accepts
    uint64_t cap;                         // drops
    bool has_max_per_tx;
    bool max_per_tx_is_xrp;
    uint64_t max_per_tx;  // drops
    bool has_duration;
    uint32_t duration;  // seconds
    bool has_max_tx_count;
    uint32_t max_tx_count;
    bool has_witness;
    session_profile_memo_t profile_memo;
    session_profile_id_t profile;  // when profile_memo is SESSION_PROFILE_MEMO_FOUND
} session_request_t;

// The node's own bounds (rippled Protocol.h, SigningSessionSet.cpp): a
// session lasts 1 to 600 seconds and signs 1 to 100000 transactions, an XRP
// amount is at most 10^17 drops.
#define SESSION_MAX_DURATION  600
#define SESSION_MAX_TX_COUNT  100000
#define SESSION_MAX_XRP_DROPS 100000000000000000ULL

typedef enum {
    SESSION_POLICY_OK = 0,
    SESSION_POLICY_UNREAD,
    SESSION_POLICY_MODE_INVALID,
    SESSION_POLICY_MODE_ALL_BLOCKED,
    SESSION_POLICY_MODE_PERMISSIONS_BLOCKED,
    SESSION_POLICY_CAP_NOT_XRP,
    SESSION_POLICY_CAP_ABOVE,
    SESSION_POLICY_PER_TX_WITHOUT_CAP,
    SESSION_POLICY_PER_TX_ABOVE_CAP,
    SESSION_POLICY_PER_TX_MISSING,
    SESSION_POLICY_PER_TX_NOT_XRP,
    SESSION_POLICY_PER_TX_ABOVE,
    SESSION_POLICY_DURATION_MISSING,
    SESSION_POLICY_DURATION_INVALID,
    SESSION_POLICY_DURATION_ABOVE,
    SESSION_POLICY_WITNESS_MISSING,
    SESSION_POLICY_TX_COUNT_INVALID,
    SESSION_POLICY_TX_COUNT_MISSING,
    SESSION_POLICY_TX_COUNT_ABOVE,
    SESSION_POLICY_PROFILE_UNKNOWN,
    SESSION_POLICY_PROFILE_DUPLICATE,
    SESSION_POLICY_PROFILE_OFF,
    SESSION_POLICY_PROFILE_MODE,
    SESSION_POLICY_PROFILE_PERMISSION,
} session_policy_violation_t;

typedef struct {
    session_policy_violation_t violation;
    uint8_t group;                 // 0: the transaction itself, n: inner transaction n of a Batch
    bool has_profile;              // checked against a profile, not the default limits
    session_profile_id_t profile;  // when has_profile
    uint64_t value;  // what the transaction asks (drops, seconds, a count, a permission)
    uint64_t limit;  // what the policy allows (drops, seconds or a count)
} session_policy_verdict_t;

// Pure check of one request. Returns true when it fits the policy (or the
// policy is off); otherwise fills verdict (group left to the caller). Either
// way verdict.has_profile and verdict.profile say which profile applies.
bool session_policy_check(const session_policy_t *policy,
                          const session_request_t *request,
                          session_policy_verdict_t *verdict);

// Reads the request of a SigningSessionSet from the parsed fields of one
// group: 0 for the transaction itself, n for inner transaction n of a Batch.
// Only the transaction itself can name a profile: a memo inside a Batch is
// in a nested array, which the parser never clear-signs.
void session_request_read(const parseResult_t *result, uint8_t group, session_request_t *request);

// Checks every SigningSessionSet of the transaction in parse_context: the
// transaction itself or the inner transactions of a Batch. Returns true when
// all fit. The review keeps its "Profile" row only when the policy is on and
// the session fits the profile it names; otherwise the row is removed from
// parse_context.result.
bool session_policy_check_transaction(const session_policy_t *policy,
                                      session_policy_verdict_t *verdict);

// Reason shown on the refusal screen, e.g. "Cap XRP 500 is above XRP 50".
// Returns false when it does not fit in out.
bool session_policy_format_refusal(const session_policy_verdict_t *verdict,
                                   char *out,
                                   size_t out_len);

// INS_GET_SESSION_POLICY answer. Returns the number of bytes written, or 0
// when out is too small.
size_t session_policy_serialize(const session_policy_t *policy, uint8_t *out, size_t out_len);

#endif  // LEDGER_APP_XRP_SESSION_POLICY_H
