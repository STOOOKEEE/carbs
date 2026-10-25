/*******************************************************************************
 *   carbs: session policy, the user's own limits on the signing sessions this
 *   device agrees to open (mirror of Ledger's Agent Policies, on the device).
 *
 *   Stored in NVM, edited only from the device settings, read by the host
 *   through INS_GET_SESSION_POLICY. When it is on, every SigningSessionSet
 *   (alone or inside a Batch) is checked before its review is shown; one that
 *   goes beyond it is refused with SW_SESSION_POLICY_REFUSED.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_SESSION_POLICY_H
#define LEDGER_APP_XRP_SESSION_POLICY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "xrp_parse.h"

// Status word of a session transaction refused by the policy
#define SW_SESSION_POLICY_REFUSED 0x6986

// A limit set to this value is not checked
#define SESSION_POLICY_NO_LIMIT 0

// INS_GET_SESSION_POLICY answer: version, flags, max cap, max per payment
// (drops, big-endian uint64), max duration (seconds, big-endian uint32)
#define SESSION_POLICY_FORMAT_VERSION  1
#define SESSION_POLICY_SERIALIZED_SIZE 22

#define SESSION_POLICY_FLAG_ENABLED          0x01
#define SESSION_POLICY_FLAG_ALLOW_ALL        0x02
#define SESSION_POLICY_FLAG_ALLOW_PERMISSION 0x04
#define SESSION_POLICY_FLAG_REQUIRE_WITNESS  0x08

// NVM layout (part of internal_storage_t). All zero = policy off.
typedef struct {
    uint8_t enabled;
    uint8_t allow_all_transactions;  // mode A (tfAllTransactions)
    uint8_t allow_permissions;       // mode P (Permissions)
    uint8_t require_witness;         // SessionWitness must be present
    uint32_t max_duration;           // seconds, or SESSION_POLICY_NO_LIMIT
    uint64_t max_cap;                // drops, or SESSION_POLICY_NO_LIMIT
    uint64_t max_per_tx;             // drops, or SESSION_POLICY_NO_LIMIT
} session_policy_t;

// What a SigningSessionSet asks for, read from the parsed fields
typedef struct {
    bool all_transactions;  // tfAllTransactions set
    bool has_cap;
    bool cap_is_xrp;
    uint64_t cap;  // drops
    bool has_max_per_tx;
    bool max_per_tx_is_xrp;
    uint64_t max_per_tx;  // drops
    bool has_duration;
    uint32_t duration;  // seconds
    bool has_witness;
} session_request_t;

typedef enum {
    SESSION_POLICY_OK = 0,
    SESSION_POLICY_MODE_ALL_BLOCKED,
    SESSION_POLICY_MODE_PERMISSIONS_BLOCKED,
    SESSION_POLICY_CAP_NOT_XRP,
    SESSION_POLICY_CAP_ABOVE,
    SESSION_POLICY_PER_TX_MISSING,
    SESSION_POLICY_PER_TX_NOT_XRP,
    SESSION_POLICY_PER_TX_ABOVE,
    SESSION_POLICY_DURATION_MISSING,
    SESSION_POLICY_DURATION_ABOVE,
    SESSION_POLICY_WITNESS_MISSING,
} session_policy_violation_t;

typedef struct {
    session_policy_violation_t violation;
    uint8_t group;   // 0: the transaction itself, n: inner transaction n of a Batch
    uint64_t value;  // what the transaction asks (drops or seconds)
    uint64_t limit;  // what the policy allows (drops or seconds)
} session_policy_verdict_t;

// Pure check of one request. Returns true when it fits the policy (or the
// policy is off); otherwise fills verdict (group left to the caller).
bool session_policy_check(const session_policy_t *policy,
                          const session_request_t *request,
                          session_policy_verdict_t *verdict);

// Reads the request of a SigningSessionSet from the parsed fields of one
// group: 0 for the transaction itself, n for inner transaction n of a Batch.
void session_request_read(const parseResult_t *result, uint8_t group, session_request_t *request);

// Checks every SigningSessionSet of the transaction in parse_context: the
// transaction itself or the inner transactions of a Batch. Returns true when
// all fit.
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
