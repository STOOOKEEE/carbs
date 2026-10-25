/*******************************************************************************
 *   carbs: session policy checks (see session_policy.h).
 *
 *   Pure code: no NVM, no UI. The device reads the policy from N_storage and
 *   shows the refusal (transaction.c, ui/other/session_policy_refusal.c).
 ********************************************************************************/

#include "session_policy.h"

#include <string.h>

#include "amount.h"
#include "batch.h"
#include "readers.h"
#include "os.h"
#include "sign_transaction.h"
#include "signing_session.h"
#include "xrp_helpers.h"

// Native XRP amount: bit 63 clear (not an issued currency), bit 62 set
// (positive), the value in drops below.
#define AMOUNT_NOT_XRP_BIT  0x8000000000000000ULL
#define AMOUNT_POSITIVE_BIT 0x4000000000000000ULL
#define AMOUNT_DROPS_MASK   0x3FFFFFFFFFFFFFFFULL

// "XRP <drops as XRP>" from xrp_print_amount: up to 24 characters, and it
// wants one byte more than the NUL
#define XRP_TEXT_SIZE 26

static bool is_limited(uint64_t limit) {
    return limit != SESSION_POLICY_NO_LIMIT;
}

static bool refuse(session_policy_verdict_t *verdict,
                   session_policy_violation_t violation,
                   uint64_t value,
                   uint64_t limit) {
    verdict->violation = violation;
    verdict->value = value;
    verdict->limit = limit;
    return false;
}

bool session_policy_check(const session_policy_t *policy,
                          const session_request_t *request,
                          session_policy_verdict_t *verdict) {
    verdict->violation = SESSION_POLICY_OK;
    if (!policy->enabled) {
        return true;
    }

    // The ledger accepts exactly one mode: A (the flag), C (SessionCap) or P
    // (Permissions). Neither the flag nor a cap means mode P (or a
    // transaction the ledger rejects), so it needs mode P to be allowed.
    if (request->all_transactions) {
        if (!policy->allow_all_transactions) {
            return refuse(verdict, SESSION_POLICY_MODE_ALL_BLOCKED, 0, 0);
        }
    } else if (!request->has_cap && !policy->allow_permissions) {
        return refuse(verdict, SESSION_POLICY_MODE_PERMISSIONS_BLOCKED, 0, 0);
    }

    if (request->has_cap && is_limited(policy->max_cap)) {
        if (!request->cap_is_xrp) {
            return refuse(verdict, SESSION_POLICY_CAP_NOT_XRP, 0, policy->max_cap);
        }
        if (request->cap > policy->max_cap) {
            return refuse(verdict, SESSION_POLICY_CAP_ABOVE, request->cap, policy->max_cap);
        }
    }

    if (is_limited(policy->max_per_tx)) {
        // A per-payment bound only exists under a cap (mode C): required
        // there, checked wherever it appears.
        if (request->has_cap && !request->has_max_per_tx) {
            return refuse(verdict, SESSION_POLICY_PER_TX_MISSING, 0, policy->max_per_tx);
        }
        if (request->has_max_per_tx) {
            if (!request->max_per_tx_is_xrp) {
                return refuse(verdict, SESSION_POLICY_PER_TX_NOT_XRP, 0, policy->max_per_tx);
            }
            if (request->max_per_tx > policy->max_per_tx) {
                return refuse(verdict,
                              SESSION_POLICY_PER_TX_ABOVE,
                              request->max_per_tx,
                              policy->max_per_tx);
            }
        }
    }

    if (is_limited(policy->max_duration)) {
        if (!request->has_duration) {
            return refuse(verdict, SESSION_POLICY_DURATION_MISSING, 0, policy->max_duration);
        }
        if (request->duration > policy->max_duration) {
            return refuse(verdict,
                          SESSION_POLICY_DURATION_ABOVE,
                          request->duration,
                          policy->max_duration);
        }
    }

    if (policy->require_witness && !request->has_witness) {
        return refuse(verdict, SESSION_POLICY_WITNESS_MISSING, 0, 0);
    }

    return true;
}

// Reads a native XRP amount. Returns false for an issued currency, an MPT
// amount or a non-positive value.
static bool read_xrp_drops(const field_t *field, uint64_t *drops) {
    if (field->length != XRP_AMOUNT_LEN) {
        return false;
    }
    uint64_t raw = read_unsigned64(field->data.ptr);
    if ((raw & AMOUNT_NOT_XRP_BIT) != 0 || (raw & AMOUNT_POSITIVE_BIT) == 0) {
        return false;
    }
    *drops = raw & AMOUNT_DROPS_MASK;
    return true;
}

// Group 0 holds the top-level fields of the transaction; a nested field
// (a Permission, a Memo) is never one of the session's own fields.
static bool is_in_group(const field_t *field, uint8_t group) {
    if (group == BATCH_OUTER_GROUP) {
        return field->object_depth == 0;
    }
    return batch_group(field) == group;
}

static void read_amount_field(const field_t *field, bool *present, bool *is_xrp, uint64_t *drops) {
    *present = true;
    *is_xrp = read_xrp_drops(field, drops);
}

void session_request_read(const parseResult_t *result, uint8_t group, session_request_t *request) {
    memset(request, 0, sizeof(*request));

    for (uint8_t i = 0; i < result->num_fields; i++) {
        const field_t *field = &result->fields[i];
        if (!is_in_group(field, group)) {
            continue;
        }

        switch (field->data_type) {
            case STI_UINT32:
                if (field->id == XRP_UINT32_FLAGS) {
                    request->all_transactions = (field->data.u32 & TF_ALL_TRANSACTIONS) != 0;
                } else if (field->id == XRP_UINT32_SESSION_DURATION) {
                    request->has_duration = true;
                    request->duration = field->data.u32;
                }
                break;
            case STI_AMOUNT:
                if (field->id == XRP_UINT64_SESSION_CAP) {
                    read_amount_field(field,
                                      &request->has_cap,
                                      &request->cap_is_xrp,
                                      &request->cap);
                } else if (field->id == XRP_UINT64_SESSION_MAX_PER_TX) {
                    read_amount_field(field,
                                      &request->has_max_per_tx,
                                      &request->max_per_tx_is_xrp,
                                      &request->max_per_tx);
                }
                break;
            case STI_ACCOUNT:
                if (field->id == XRP_ACCOUNT_SESSION_WITNESS) {
                    request->has_witness = true;
                }
                break;
            default:
                break;
        }
    }
}

static bool check_group(const session_policy_t *policy,
                        uint8_t group,
                        session_policy_verdict_t *verdict) {
    session_request_t request;
    session_request_read(&parse_context.result, group, &request);
    verdict->group = group;
    return session_policy_check(policy, &request, verdict);
}

bool session_policy_check_transaction(const session_policy_t *policy,
                                      session_policy_verdict_t *verdict) {
    verdict->violation = SESSION_POLICY_OK;
    verdict->group = BATCH_OUTER_GROUP;

    if (parse_context.transaction_type == TRANSACTION_SIGNING_SESSION_SET) {
        return check_group(policy, BATCH_OUTER_GROUP, verdict);
    }

    if (parse_context.transaction_type == TRANSACTION_BATCH) {
        for (uint8_t i = 0; i < parse_context.batch.inner_count; i++) {
            if (parse_context.batch.inner[i].transaction_type == TRANSACTION_SIGNING_SESSION_SET &&
                !check_group(policy, i + 1, verdict)) {
                return false;
            }
        }
    }

    return true;
}

// "XRP 50" for 50 000 000 drops
static bool format_xrp(uint64_t drops, char *out) {
    return xrp_print_amount(drops, out, XRP_TEXT_SIZE) == 0;
}

static bool format_amount_above(const char *name,
                                const session_policy_verdict_t *verdict,
                                char *out,
                                size_t out_len) {
    char value[XRP_TEXT_SIZE];
    char limit[XRP_TEXT_SIZE];
    if (!format_xrp(verdict->value, value) || !format_xrp(verdict->limit, limit)) {
        return false;
    }
    int written = snprintf(out, out_len, "%s %s is above %s", name, value, limit);
    return written > 0 && (size_t) written < out_len;
}

static bool format_reason(const session_policy_verdict_t *verdict, char *out, size_t out_len) {
    char limit[XRP_TEXT_SIZE];
    int written;

    switch (verdict->violation) {
        case SESSION_POLICY_MODE_ALL_BLOCKED:
            written = snprintf(out, out_len, "Sessions for all transactions are not allowed");
            break;
        case SESSION_POLICY_MODE_PERMISSIONS_BLOCKED:
            written = snprintf(out, out_len, "Sessions with permissions are not allowed");
            break;
        case SESSION_POLICY_CAP_NOT_XRP:
            written = snprintf(out, out_len, "Max spend is not an XRP amount");
            break;
        case SESSION_POLICY_CAP_ABOVE:
            return format_amount_above("Max spend", verdict, out, out_len);
        case SESSION_POLICY_PER_TX_MISSING:
            if (!format_xrp(verdict->limit, limit)) {
                return false;
            }
            written = snprintf(out, out_len, "No max per payment (limit %s)", limit);
            break;
        case SESSION_POLICY_PER_TX_NOT_XRP:
            written = snprintf(out, out_len, "Max per payment is not an XRP amount");
            break;
        case SESSION_POLICY_PER_TX_ABOVE:
            return format_amount_above("Max per payment", verdict, out, out_len);
        case SESSION_POLICY_DURATION_MISSING:
            written = snprintf(out, out_len, "No session duration");
            break;
        case SESSION_POLICY_DURATION_ABOVE:
            written = snprintf(out,
                               out_len,
                               "Duration %u s is above %u s",
                               (unsigned int) verdict->value,
                               (unsigned int) verdict->limit);
            break;
        case SESSION_POLICY_WITNESS_MISSING:
            written = snprintf(out, out_len, "No witness, your policy requires one");
            break;
        default:
            return false;
    }

    return written > 0 && (size_t) written < out_len;
}

bool session_policy_format_refusal(const session_policy_verdict_t *verdict,
                                   char *out,
                                   size_t out_len) {
    if (out_len == 0) {
        return false;
    }
    if (verdict->group == BATCH_OUTER_GROUP) {
        return format_reason(verdict, out, out_len);
    }

    // Inner transaction of a Batch: say which one
    int written = snprintf(out, out_len, "Transaction %u: ", (unsigned int) verdict->group);
    if (written <= 0 || (size_t) written >= out_len) {
        return false;
    }
    return format_reason(verdict, out + written, out_len - (size_t) written);
}

static void write_u64_be(uint64_t value, uint8_t *out) {
    for (size_t i = 0; i < sizeof(value); i++) {
        out[i] = (uint8_t) (value >> (8 * (sizeof(value) - 1 - i)));
    }
}

static void write_u32_be(uint32_t value, uint8_t *out) {
    for (size_t i = 0; i < sizeof(value); i++) {
        out[i] = (uint8_t) (value >> (8 * (sizeof(value) - 1 - i)));
    }
}

size_t session_policy_serialize(const session_policy_t *policy, uint8_t *out, size_t out_len) {
    if (out_len < SESSION_POLICY_SERIALIZED_SIZE) {
        return 0;
    }

    uint8_t flags = 0;
    if (policy->enabled) {
        flags |= SESSION_POLICY_FLAG_ENABLED;
    }
    if (policy->allow_all_transactions) {
        flags |= SESSION_POLICY_FLAG_ALLOW_ALL;
    }
    if (policy->allow_permissions) {
        flags |= SESSION_POLICY_FLAG_ALLOW_PERMISSION;
    }
    if (policy->require_witness) {
        flags |= SESSION_POLICY_FLAG_REQUIRE_WITNESS;
    }

    size_t offset = 0;
    out[offset++] = SESSION_POLICY_FORMAT_VERSION;
    out[offset++] = flags;
    write_u64_be(policy->max_cap, out + offset);
    offset += sizeof(uint64_t);
    write_u64_be(policy->max_per_tx, out + offset);
    offset += sizeof(uint64_t);
    write_u32_be(policy->max_duration, out + offset);
    offset += sizeof(uint32_t);

    return offset;
}
