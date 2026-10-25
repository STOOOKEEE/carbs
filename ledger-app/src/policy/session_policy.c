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
#include "session_permissions.h"
#include "signing_session.h"
#include "xrp_helpers.h"

// Native XRP amount: bit 63 clear (not an issued currency), bit 62 set
// (positive), bit 61 clear (not an MPT amount), the value in drops below.
#define AMOUNT_NOT_XRP_BIT  0x8000000000000000ULL
#define AMOUNT_POSITIVE_BIT 0x4000000000000000ULL
#define AMOUNT_MPT_BIT      0x2000000000000000ULL
#define AMOUNT_DROPS_MASK   0x1FFFFFFFFFFFFFFFULL

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

// What the node itself refuses (SigningSessionSet::preflight) is never
// counted as fitting the policy: the review would show it as acceptable.
static bool check_node_rules(const session_request_t *request, session_policy_verdict_t *verdict) {
    // Exactly one mode: A (the flag), P (Permissions) or C (SessionCap)
    int modes = (int) request->all_transactions + (int) request->has_permissions +
                (int) request->has_cap;
    if (modes != 1) {
        return refuse(verdict, SESSION_POLICY_MODE_INVALID, 0, 0);
    }
    if (request->has_cap && !request->cap_is_xrp) {
        return refuse(verdict, SESSION_POLICY_CAP_NOT_XRP, 0, 0);
    }
    // A per-payment bound only exists under a cap, within it
    if (request->has_max_per_tx) {
        if (!request->has_cap) {
            return refuse(verdict, SESSION_POLICY_PER_TX_WITHOUT_CAP, 0, 0);
        }
        if (!request->max_per_tx_is_xrp) {
            return refuse(verdict, SESSION_POLICY_PER_TX_NOT_XRP, 0, 0);
        }
        if (request->max_per_tx > request->cap) {
            return refuse(verdict,
                          SESSION_POLICY_PER_TX_ABOVE_CAP,
                          request->max_per_tx,
                          request->cap);
        }
    }
    if (!request->has_duration) {
        return refuse(verdict, SESSION_POLICY_DURATION_MISSING, 0, 0);
    }
    if (request->duration == 0 || request->duration > SESSION_MAX_DURATION) {
        return refuse(verdict,
                      SESSION_POLICY_DURATION_INVALID,
                      request->duration,
                      SESSION_MAX_DURATION);
    }
    if (request->has_max_tx_count &&
        (request->max_tx_count == 0 || request->max_tx_count > SESSION_MAX_TX_COUNT)) {
        return refuse(verdict,
                      SESSION_POLICY_TX_COUNT_INVALID,
                      request->max_tx_count,
                      SESSION_MAX_TX_COUNT);
    }
    return true;
}

// Max spend, max per payment (required under a cap) and duration
static bool check_limits(uint64_t max_cap,
                         uint64_t max_per_tx,
                         uint32_t max_duration,
                         const session_request_t *request,
                         session_policy_verdict_t *verdict) {
    if (request->has_cap && is_limited(max_cap) && request->cap > max_cap) {
        return refuse(verdict, SESSION_POLICY_CAP_ABOVE, request->cap, max_cap);
    }

    if (is_limited(max_per_tx)) {
        // Required under a cap (mode C), the only mode that has one
        if (request->has_cap && !request->has_max_per_tx) {
            return refuse(verdict, SESSION_POLICY_PER_TX_MISSING, 0, max_per_tx);
        }
        if (request->has_max_per_tx && request->max_per_tx > max_per_tx) {
            return refuse(verdict, SESSION_POLICY_PER_TX_ABOVE, request->max_per_tx, max_per_tx);
        }
    }

    if (is_limited(max_duration) && request->duration > max_duration) {
        return refuse(verdict, SESSION_POLICY_DURATION_ABOVE, request->duration, max_duration);
    }

    return true;
}

// The user's own default limits, for a session that names no profile
static bool check_default_limits(const session_policy_t *policy,
                                 const session_request_t *request,
                                 session_policy_verdict_t *verdict) {
    if (request->all_transactions && !policy->allow_all_transactions) {
        return refuse(verdict, SESSION_POLICY_MODE_ALL_BLOCKED, 0, 0);
    }
    if (request->has_permissions && !policy->allow_permissions) {
        return refuse(verdict, SESSION_POLICY_MODE_PERMISSIONS_BLOCKED, 0, 0);
    }
    return check_limits(policy->max_cap,
                        policy->max_per_tx,
                        policy->max_duration,
                        request,
                        verdict);
}

static uint8_t mode_of(const session_request_t *request) {
    if (request->all_transactions) {
        return SESSION_MODE_ALL;
    }
    return request->has_permissions ? SESSION_MODE_PERMISSIONS : SESSION_MODE_CAP;
}

static bool is_allowed_permission(const session_profile_t *profile, uint32_t permission) {
    for (uint8_t i = 0; i < profile->permissions_nb; i++) {
        if (profile->permissions[i] == permission) {
            return true;
        }
    }
    return false;
}

// The limits of the profile the session names
static bool check_profile_limits(const session_profile_t *profile,
                                 const session_request_t *request,
                                 session_policy_verdict_t *verdict) {
    if (!profile->enabled) {
        return refuse(verdict, SESSION_POLICY_PROFILE_OFF, 0, 0);
    }
    if ((profile->modes & mode_of(request)) == 0) {
        return refuse(verdict, SESSION_POLICY_PROFILE_MODE, 0, 0);
    }
    for (uint8_t i = 0; i < request->permissions_nb; i++) {
        if (!is_allowed_permission(profile, request->permissions[i])) {
            return refuse(verdict, SESSION_POLICY_PROFILE_PERMISSION, request->permissions[i], 0);
        }
    }
    if (!check_limits(profile->max_cap,
                      profile->max_per_tx,
                      profile->max_duration,
                      request,
                      verdict)) {
        return false;
    }
    if (!request->has_max_tx_count) {
        return refuse(verdict, SESSION_POLICY_TX_COUNT_MISSING, 0, profile->max_tx_count);
    }
    if (request->max_tx_count > profile->max_tx_count) {
        return refuse(verdict,
                      SESSION_POLICY_TX_COUNT_ABOVE,
                      request->max_tx_count,
                      profile->max_tx_count);
    }
    return true;
}

static bool check_user_limits(const session_policy_t *policy,
                              const session_request_t *request,
                              session_policy_verdict_t *verdict) {
    switch (request->profile_memo) {
        case SESSION_PROFILE_MEMO_NONE:
            if (!check_default_limits(policy, request, verdict)) {
                return false;
            }
            break;
        case SESSION_PROFILE_MEMO_FOUND: {
            session_profile_t profile;
            session_profile_resolve(request->profile, &policy->profiles[request->profile], &profile);
            verdict->has_profile = true;
            verdict->profile = request->profile;
            if (!check_profile_limits(&profile, request, verdict)) {
                return false;
            }
            break;
        }
        case SESSION_PROFILE_MEMO_DUPLICATE:
            return refuse(verdict, SESSION_POLICY_PROFILE_DUPLICATE, 0, 0);
        default:
            return refuse(verdict, SESSION_POLICY_PROFILE_UNKNOWN, 0, 0);
    }

    // The witness switch holds for every session, profile or not
    if (policy->require_witness && !request->has_witness) {
        return refuse(verdict, SESSION_POLICY_WITNESS_MISSING, 0, 0);
    }
    return true;
}

bool session_policy_check(const session_policy_t *policy,
                          const session_request_t *request,
                          session_policy_verdict_t *verdict) {
    verdict->violation = SESSION_POLICY_OK;
    verdict->has_profile = false;
    if (!policy->enabled) {
        return true;
    }
    return check_node_rules(request, verdict) && check_user_limits(policy, request, verdict);
}

// Reads a native XRP amount the node accepts in a session: positive, at
// most SESSION_MAX_XRP_DROPS. Returns false for anything else (an issued
// currency, an MPT amount, zero).
static bool read_xrp_drops(const field_t *field, uint64_t *drops) {
    if (field->length != XRP_AMOUNT_LEN) {
        return false;
    }
    uint64_t raw = read_unsigned64(field->data.ptr);
    if ((raw & AMOUNT_NOT_XRP_BIT) != 0 || (raw & AMOUNT_POSITIVE_BIT) == 0 ||
        (raw & AMOUNT_MPT_BIT) != 0) {
        return false;
    }
    *drops = raw & AMOUNT_DROPS_MASK;
    return *drops != 0 && *drops <= SESSION_MAX_XRP_DROPS;
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

static void read_permission(const field_t *field, session_request_t *request) {
    request->has_permissions = true;
    if (request->permissions_nb < MAX_ARRAY_LEN) {
        request->permissions[request->permissions_nb++] = field->data.u32;
    }
}

void session_request_read(const parseResult_t *result, uint8_t group, session_request_t *request) {
    memset(request, 0, sizeof(*request));
    if (group == BATCH_OUTER_GROUP) {
        request->profile_memo = session_profile_read_memo(result, &request->profile);
    }

    for (uint8_t i = 0; i < result->num_fields; i++) {
        const field_t *field = &result->fields[i];
        // A PermissionValue sits inside Permissions, below the top level; a
        // nested array sends a Batch to blind signing, so only the
        // transaction itself can be in mode P.
        if (group == BATCH_OUTER_GROUP && is_permission_value(field) &&
            field->array_info.type == XRP_STARRAY_PERMISSIONS) {
            read_permission(field, request);
        }
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
                } else if (field->id == XRP_UINT32_SESSION_MAX_TX_COUNT) {
                    request->has_max_tx_count = true;
                    request->max_tx_count = field->data.u32;
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
    verdict->has_profile = false;

    bool may_open_session = parse_context.transaction_type == TRANSACTION_SIGNING_SESSION_SET ||
                            parse_context.transaction_type == TRANSACTION_BATCH;
    // Parsing stopped before the end (too many fields, a nested array): a
    // session the policy cannot read may be in what is left
    if (policy->enabled && may_open_session && parse_context.offset != parse_context.length) {
        return refuse(verdict, SESSION_POLICY_UNREAD, 0, 0);
    }

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

// "<name> XRP 500 <relation> XRP 50"
static bool format_amount_above(const char *name,
                                const char *relation,
                                const session_policy_verdict_t *verdict,
                                char *out,
                                size_t out_len) {
    char value[XRP_TEXT_SIZE];
    char limit[XRP_TEXT_SIZE];
    if (!format_xrp(verdict->value, value) || !format_xrp(verdict->limit, limit)) {
        return false;
    }
    int written = snprintf(out, out_len, "%s %s %s %s", name, value, relation, limit);
    return written > 0 && (size_t) written < out_len;
}

// "Payment is not allowed" (the number when the app cannot name it)
static int format_permission(uint64_t permission, char *out, size_t out_len) {
    const char *name = resolve_permission_name((uint32_t) permission);
    if (name == NULL) {
        return snprintf(out,
                        out_len,
                        "Permission %u is not allowed",
                        (unsigned int) permission);
    }
    return snprintf(out, out_len, "%s is not allowed", name);
}

static bool format_reason(const session_policy_verdict_t *verdict, char *out, size_t out_len) {
    char limit[XRP_TEXT_SIZE];
    int written;

    switch (verdict->violation) {
        case SESSION_POLICY_UNREAD:
            written = snprintf(out, out_len, "Too long to check against your policy");
            break;
        case SESSION_POLICY_MODE_INVALID:
            written = snprintf(out, out_len, "Not exactly one session mode");
            break;
        case SESSION_POLICY_MODE_ALL_BLOCKED:
            written = snprintf(out, out_len, "Sessions for all transactions are not allowed");
            break;
        case SESSION_POLICY_MODE_PERMISSIONS_BLOCKED:
            written = snprintf(out, out_len, "Sessions with permissions are not allowed");
            break;
        case SESSION_POLICY_CAP_NOT_XRP:
            written = snprintf(out, out_len, "Max spend is not a positive XRP amount");
            break;
        case SESSION_POLICY_CAP_ABOVE:
            return format_amount_above("Max spend", "is above", verdict, out, out_len);
        case SESSION_POLICY_PER_TX_WITHOUT_CAP:
            written = snprintf(out, out_len, "Max per payment without a max spend");
            break;
        case SESSION_POLICY_PER_TX_ABOVE_CAP:
            return format_amount_above("Max per payment",
                                       "is above max spend",
                                       verdict,
                                       out,
                                       out_len);
        case SESSION_POLICY_PER_TX_MISSING:
            if (!format_xrp(verdict->limit, limit)) {
                return false;
            }
            written = snprintf(out, out_len, "No max per payment (limit %s)", limit);
            break;
        case SESSION_POLICY_PER_TX_NOT_XRP:
            written = snprintf(out, out_len, "Max per payment is not a positive XRP amount");
            break;
        case SESSION_POLICY_PER_TX_ABOVE:
            return format_amount_above("Max per payment", "is above", verdict, out, out_len);
        case SESSION_POLICY_DURATION_MISSING:
            written = snprintf(out, out_len, "No session duration");
            break;
        case SESSION_POLICY_DURATION_INVALID:
            written = snprintf(out,
                               out_len,
                               "Duration %u s is not 1 to %u s",
                               (unsigned int) verdict->value,
                               (unsigned int) verdict->limit);
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
        case SESSION_POLICY_TX_COUNT_INVALID:
            written = snprintf(out,
                               out_len,
                               "Max transactions %u is not 1 to %u",
                               (unsigned int) verdict->value,
                               (unsigned int) verdict->limit);
            break;
        case SESSION_POLICY_TX_COUNT_MISSING:
            written = snprintf(out,
                               out_len,
                               "Set a transaction limit (at most %u)",
                               (unsigned int) verdict->limit);
            break;
        case SESSION_POLICY_TX_COUNT_ABOVE:
            written = snprintf(out,
                               out_len,
                               "Max transactions %u is above %u",
                               (unsigned int) verdict->value,
                               (unsigned int) verdict->limit);
            break;
        case SESSION_POLICY_PROFILE_UNKNOWN:
            written = snprintf(out, out_len, "Unknown session profile");
            break;
        case SESSION_POLICY_PROFILE_DUPLICATE:
            written = snprintf(out, out_len, "More than one session profile");
            break;
        case SESSION_POLICY_PROFILE_OFF:
            written = snprintf(out, out_len, "This profile is off in your settings");
            break;
        case SESSION_POLICY_PROFILE_MODE:
            written = snprintf(out, out_len, "Session mode not allowed by this profile");
            break;
        case SESSION_POLICY_PROFILE_PERMISSION:
            written = format_permission(verdict->value, out, out_len);
            break;
        default:
            return false;
    }

    return written > 0 && (size_t) written < out_len;
}

// Moves offset past what snprintf just wrote; false when it did not fit
static bool advance(size_t *offset, size_t out_len, int written) {
    if (written <= 0 || *offset + (size_t) written >= out_len) {
        return false;
    }
    *offset += (size_t) written;
    return true;
}

bool session_policy_format_refusal(const session_policy_verdict_t *verdict,
                                   char *out,
                                   size_t out_len) {
    if (out_len == 0) {
        return false;
    }
    size_t offset = 0;

    // Inner transaction of a Batch: say which one
    if (verdict->group != BATCH_OUTER_GROUP &&
        !advance(&offset,
                 out_len,
                 snprintf(out, out_len, "Transaction %u: ", (unsigned int) verdict->group))) {
        return false;
    }
    // Checked against a profile: say which one
    if (verdict->has_profile) {
        const char *title = session_profile_title(verdict->profile);
        if (!advance(&offset,
                     out_len,
                     snprintf(out + offset, out_len - offset, "Profile %s: ", title))) {
            return false;
        }
    }
    return format_reason(verdict, out + offset, out_len - offset);
}

static size_t write_u64_be(uint64_t value, uint8_t *out) {
    for (size_t i = 0; i < sizeof(value); i++) {
        out[i] = (uint8_t) (value >> (8 * (sizeof(value) - 1 - i)));
    }
    return sizeof(value);
}

static size_t write_u32_be(uint32_t value, uint8_t *out) {
    for (size_t i = 0; i < sizeof(value); i++) {
        out[i] = (uint8_t) (value >> (8 * (sizeof(value) - 1 - i)));
    }
    return sizeof(value);
}

static uint8_t policy_flags(const session_policy_t *policy) {
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
    return flags;
}

static size_t serialized_size(const session_policy_t *policy) {
    size_t size = SESSION_POLICY_HEADER_SIZE + 1;
    for (uint8_t id = 0; id < SESSION_PROFILES_NB; id++) {
        session_profile_t profile;
        session_profile_resolve((session_profile_id_t) id, &policy->profiles[id], &profile);
        size += SESSION_PROFILE_RECORD_SIZE + profile.permissions_nb * sizeof(uint32_t);
    }
    return size;
}

static size_t serialize_profile(uint8_t id, const session_profile_t *profile, uint8_t *out) {
    size_t offset = 0;
    out[offset++] = id;
    out[offset++] = profile->enabled ? SESSION_PROFILE_FLAG_ENABLED : 0;
    out[offset++] = profile->modes;
    offset += write_u64_be(profile->max_cap, out + offset);
    offset += write_u64_be(profile->max_per_tx, out + offset);
    offset += write_u32_be(profile->max_duration, out + offset);
    offset += write_u32_be(profile->max_tx_count, out + offset);
    out[offset++] = profile->permissions_nb;
    for (uint8_t i = 0; i < profile->permissions_nb; i++) {
        offset += write_u32_be(profile->permissions[i], out + offset);
    }
    return offset;
}

size_t session_policy_serialize(const session_policy_t *policy, uint8_t *out, size_t out_len) {
    if (out_len < serialized_size(policy)) {
        return 0;
    }

    size_t offset = 0;
    out[offset++] = SESSION_POLICY_FORMAT_VERSION;
    out[offset++] = policy_flags(policy);
    offset += write_u64_be(policy->max_cap, out + offset);
    offset += write_u64_be(policy->max_per_tx, out + offset);
    offset += write_u32_be(policy->max_duration, out + offset);

    out[offset++] = SESSION_PROFILES_NB;
    for (uint8_t id = 0; id < SESSION_PROFILES_NB; id++) {
        session_profile_t profile;
        session_profile_resolve((session_profile_id_t) id, &policy->profiles[id], &profile);
        offset += serialize_profile(id, &profile, out + offset);
    }

    return offset;
}
