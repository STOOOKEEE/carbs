// clang-format off
#include <setjmp.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <cmocka.h>
// clang-format on
#include <stdio.h>
#include <string.h>

#include "../src/policy/session_policy.h"
#include "../src/xrp/xrp_parse.h"
#include "../src/xrp/signing_session.h"

parseContext_t parse_context;

#define DROPS_PER_XRP 1000000ULL
#define XRP(n)        ((uint64_t)(n) * DROPS_PER_XRP)
#define TESTCASES     "../../tests/standalone/testcases/"

// Mode C session asking for 50 XRP, 300 s, no per-payment bound, no witness
static session_request_t capped_request(void) {
    session_request_t request = {
        .has_cap = true,
        .cap_is_xrp = true,
        .cap = XRP(50),
        .has_duration = true,
        .duration = 300,
    };
    return request;
}

static session_policy_t enabled_policy(void) {
    session_policy_t policy = {.enabled = 1};
    return policy;
}

static void assert_refused(const session_policy_t* policy,
                           const session_request_t* request,
                           session_policy_violation_t violation,
                           uint64_t value,
                           uint64_t limit) {
    session_policy_verdict_t verdict;
    assert_false(session_policy_check(policy, request, &verdict));
    assert_int_equal(verdict.violation, violation);
    assert_int_equal(verdict.value, value);
    assert_int_equal(verdict.limit, limit);
}

static void assert_allowed(const session_policy_t* policy, const session_request_t* request) {
    session_policy_verdict_t verdict;
    assert_true(session_policy_check(policy, request, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_OK);
}

static void test_policy_off(void** state) {
    (void)state;
    // All zero: what a fresh install holds. Limits are ignored while off.
    session_policy_t policy = {
        .max_cap = XRP(1),
        .max_per_tx = XRP(1),
        .max_duration = 60,
        .require_witness = 1,
    };
    session_request_t request = capped_request();
    assert_allowed(&policy, &request);

    session_request_t all = {.all_transactions = true, .has_duration = true, .duration = 60};
    assert_allowed(&policy, &all);
}

static void test_mode_all(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = {.all_transactions = true, .has_duration = true, .duration = 60};
    assert_refused(&policy, &request, SESSION_POLICY_MODE_ALL_BLOCKED, 0, 0);

    policy.allow_all_transactions = 1;
    assert_allowed(&policy, &request);
}

static void test_mode_permissions(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = {.has_permissions = true, .has_duration = true, .duration = 60};
    assert_refused(&policy, &request, SESSION_POLICY_MODE_PERMISSIONS_BLOCKED, 0, 0);

    policy.allow_permissions = 1;
    assert_allowed(&policy, &request);

    // Allowing mode P does not allow mode A
    session_request_t all = {.all_transactions = true, .has_duration = true, .duration = 60};
    assert_refused(&policy, &all, SESSION_POLICY_MODE_ALL_BLOCKED, 0, 0);
}

// The node accepts exactly one mode (SigningSessionSet::preflight)
static void test_mode_invalid(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    policy.allow_all_transactions = 1;
    policy.allow_permissions = 1;

    session_request_t flag_and_cap = capped_request();
    flag_and_cap.all_transactions = true;
    assert_refused(&policy, &flag_and_cap, SESSION_POLICY_MODE_INVALID, 0, 0);

    session_request_t permissions_and_cap = capped_request();
    permissions_and_cap.has_permissions = true;
    assert_refused(&policy, &permissions_and_cap, SESSION_POLICY_MODE_INVALID, 0, 0);

    session_request_t permissions_and_flag = {
        .all_transactions = true,
        .has_permissions = true,
        .has_duration = true,
        .duration = 60,
    };
    assert_refused(&policy, &permissions_and_flag, SESSION_POLICY_MODE_INVALID, 0, 0);

    session_request_t no_mode = {.has_duration = true, .duration = 60};
    assert_refused(&policy, &no_mode, SESSION_POLICY_MODE_INVALID, 0, 0);
}

// What the node refuses is refused with the policy on, whatever its limits
static void test_node_rules(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();

    session_request_t per_tx_without_cap = {
        .all_transactions = true,
        .has_max_per_tx = true,
        .max_per_tx_is_xrp = true,
        .max_per_tx = XRP(1),
        .has_duration = true,
        .duration = 60,
    };
    policy.allow_all_transactions = 1;
    assert_refused(&policy, &per_tx_without_cap, SESSION_POLICY_PER_TX_WITHOUT_CAP, 0, 0);

    session_request_t request = capped_request();
    request.has_max_per_tx = true;
    request.max_per_tx_is_xrp = true;
    request.max_per_tx = XRP(50);
    assert_allowed(&policy, &request);
    request.max_per_tx = XRP(50) + 1;
    assert_refused(&policy, &request, SESSION_POLICY_PER_TX_ABOVE_CAP, XRP(50) + 1, XRP(50));

    request = capped_request();
    request.duration = 0;
    assert_refused(&policy, &request, SESSION_POLICY_DURATION_INVALID, 0, SESSION_MAX_DURATION);
    request.duration = SESSION_MAX_DURATION + 1;
    assert_refused(&policy,
                   &request,
                   SESSION_POLICY_DURATION_INVALID,
                   SESSION_MAX_DURATION + 1,
                   SESSION_MAX_DURATION);
    request.duration = SESSION_MAX_DURATION;
    assert_allowed(&policy, &request);

    request.has_duration = false;
    assert_refused(&policy, &request, SESSION_POLICY_DURATION_MISSING, 0, 0);
}

// A SessionCap read from its 8 serialized bytes (session_request_read)
static session_request_t request_with_cap(uint64_t raw) {
    static uint8_t bytes[8];
    for (size_t i = 0; i < sizeof(bytes); i++) {
        bytes[i] = (uint8_t)(raw >> (8 * (sizeof(bytes) - 1 - i)));
    }
    parseResult_t result;
    memset(&result, 0, sizeof(result));
    result.num_fields = 1;
    result.fields[0].data_type = STI_AMOUNT;
    result.fields[0].id = XRP_UINT64_SESSION_CAP;
    result.fields[0].data.ptr = bytes;
    result.fields[0].length = sizeof(bytes);

    session_request_t request;
    session_request_read(&result, 0, &request);
    assert_true(request.has_cap);
    return request;
}

#define AMOUNT_POSITIVE 0x4000000000000000ULL
#define AMOUNT_MPT      0x2000000000000000ULL

static void test_amounts(void** state) {
    (void)state;
    session_request_t request = request_with_cap(AMOUNT_POSITIVE | XRP(20));
    assert_true(request.cap_is_xrp);
    assert_int_equal(request.cap, XRP(20));

    request = request_with_cap(AMOUNT_POSITIVE | SESSION_MAX_XRP_DROPS);
    assert_true(request.cap_is_xrp);

    // Zero, above 10^17 drops, an MPT amount, a negative amount
    assert_false(request_with_cap(AMOUNT_POSITIVE).cap_is_xrp);
    assert_false(request_with_cap(AMOUNT_POSITIVE | (SESSION_MAX_XRP_DROPS + 1)).cap_is_xrp);
    assert_false(request_with_cap(AMOUNT_POSITIVE | AMOUNT_MPT | XRP(20)).cap_is_xrp);
    assert_false(request_with_cap(XRP(20)).cap_is_xrp);

    // Refused with the policy on, even without a limit
    session_policy_t policy = enabled_policy();
    request = request_with_cap(AMOUNT_POSITIVE);
    request.has_duration = true;
    request.duration = 60;
    assert_refused(&policy, &request, SESSION_POLICY_CAP_NOT_XRP, 0, 0);
}

static void test_cap(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = capped_request();

    // No limit: any cap
    request.cap = XRP(100000);
    assert_allowed(&policy, &request);

    policy.max_cap = XRP(50);
    request.cap = XRP(50);
    assert_allowed(&policy, &request);

    request.cap = XRP(50) + 1;
    assert_refused(&policy, &request, SESSION_POLICY_CAP_ABOVE, XRP(50) + 1, XRP(50));

    request.cap = XRP(10);
    request.cap_is_xrp = false;
    assert_refused(&policy, &request, SESSION_POLICY_CAP_NOT_XRP, 0, 0);
}

static void test_max_per_tx(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = capped_request();

    // No limit: not required
    assert_allowed(&policy, &request);

    policy.max_per_tx = XRP(10);
    assert_refused(&policy, &request, SESSION_POLICY_PER_TX_MISSING, 0, XRP(10));

    request.has_max_per_tx = true;
    request.max_per_tx_is_xrp = true;
    request.max_per_tx = XRP(10);
    assert_allowed(&policy, &request);

    request.max_per_tx = XRP(10) + 1;
    assert_refused(&policy, &request, SESSION_POLICY_PER_TX_ABOVE, XRP(10) + 1, XRP(10));

    request.max_per_tx_is_xrp = false;
    assert_refused(&policy, &request, SESSION_POLICY_PER_TX_NOT_XRP, 0, 0);

    // Mode A has no per-payment bound: not required there
    session_request_t all = {.all_transactions = true, .has_duration = true, .duration = 60};
    policy.allow_all_transactions = 1;
    assert_allowed(&policy, &all);
}

static void test_duration(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = capped_request();

    policy.max_duration = 300;
    request.duration = 300;
    assert_allowed(&policy, &request);

    request.duration = 301;
    assert_refused(&policy, &request, SESSION_POLICY_DURATION_ABOVE, 301, 300);

    request.has_duration = false;
    assert_refused(&policy, &request, SESSION_POLICY_DURATION_MISSING, 0, 0);
}

static void test_witness(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = capped_request();
    assert_allowed(&policy, &request);

    policy.require_witness = 1;
    assert_refused(&policy, &request, SESSION_POLICY_WITNESS_MISSING, 0, 0);

    request.has_witness = true;
    assert_allowed(&policy, &request);
}

static void assert_reason(const session_policy_verdict_t* verdict, const char* expected) {
    char reason[96];
    assert_true(session_policy_format_refusal(verdict, reason, sizeof(reason)));
    assert_string_equal(reason, expected);
}

static void test_format_refusal(void** state) {
    (void)state;
    session_policy_verdict_t verdict = {
        .violation = SESSION_POLICY_CAP_ABOVE,
        .value = XRP(500),
        .limit = XRP(50),
    };
    assert_reason(&verdict, "Max spend XRP 500 is above XRP 50");

    verdict.group = 2;
    assert_reason(&verdict, "Transaction 2: Max spend XRP 500 is above XRP 50");

    session_policy_verdict_t duration = {
        .violation = SESSION_POLICY_DURATION_ABOVE,
        .value = 600,
        .limit = 300,
    };
    assert_reason(&duration, "Duration 600 s is above 300 s");

    session_policy_verdict_t per_tx = {
        .violation = SESSION_POLICY_PER_TX_MISSING,
        .limit = XRP(10),
    };
    assert_reason(&per_tx, "No max per payment (limit XRP 10)");

    session_policy_verdict_t above_cap = {
        .violation = SESSION_POLICY_PER_TX_ABOVE_CAP,
        .value = XRP(30),
        .limit = XRP(20),
    };
    assert_reason(&above_cap, "Max per payment XRP 30 is above max spend XRP 20");

    session_policy_verdict_t invalid = {
        .violation = SESSION_POLICY_DURATION_INVALID,
        .value = 601,
        .limit = SESSION_MAX_DURATION,
    };
    assert_reason(&invalid, "Duration 601 s is not 1 to 600 s");

    session_policy_verdict_t unread = {.violation = SESSION_POLICY_UNREAD};
    assert_reason(&unread, "Too long to check against your policy");

    session_policy_verdict_t modes = {.violation = SESSION_POLICY_MODE_INVALID, .group = 3};
    assert_reason(&modes, "Transaction 3: Not exactly one session mode");

    // The largest amount the node accepts still fits
    session_policy_verdict_t largest = {
        .violation = SESSION_POLICY_CAP_ABOVE,
        .value = SESSION_MAX_XRP_DROPS,
        .limit = XRP(50),
        .group = 8,
    };
    assert_reason(&largest, "Transaction 8: Max spend XRP 100000000000 is above XRP 50");

    // Too small a buffer is reported, not truncated
    char small[8];
    assert_false(session_policy_format_refusal(&verdict, small, sizeof(small)));
}

// Big-endian bytes of the INS 0x08 answer
#define BE32(v)                                                                 \
    (uint8_t)((v) >> 24), (uint8_t)((v) >> 16), (uint8_t)((v) >> 8), (uint8_t)(v)
#define BE64(v) BE32((uint64_t)(v) >> 32), BE32((uint64_t)(v) & 0xFFFFFFFFULL)

// The profiles as a fresh install answers them: on, default limits
#define FRESH_PROFILES                                                                     \
    SESSION_PROFILES_NB,                                                                   \
    /* agent: on, mode C, 50 XRP, 5 XRP, 180 s, 20 transactions, no permission */          \
    SESSION_PROFILE_AGENT, 0x01, 0x01, BE64(XRP(50)), BE64(XRP(5)), BE32(180), BE32(20), 0, \
    /* game: on, mode C, 5 XRP, 0.1 XRP, 600 s, 500 transactions */                        \
    SESSION_PROFILE_GAME, 0x01, 0x01, BE64(XRP(5)), BE64(100000), BE32(600), BE32(500), 0,  \
    /* trading: on, mode P, 600 s, 200 transactions, OfferCreate and OfferCancel */         \
    SESSION_PROFILE_TRADING, 0x01, 0x04, BE64(0), BE64(0), BE32(600), BE32(200), 2,         \
    BE32(8), BE32(9),                                                                      \
    /* streaming: on, mode C, 2 XRP, 0.01 XRP, 600 s, 1000 transactions */                 \
    SESSION_PROFILE_STREAMING, 0x01, 0x01, BE64(XRP(2)), BE64(10000), BE32(600),           \
    BE32(1000), 0,                                                                         \
    /* minting: on, mode P, 600 s, 100 transactions, NFTokenMint */                         \
    SESSION_PROFILE_MINTING, 0x01, 0x04, BE64(0), BE64(0), BE32(600), BE32(100), 1, BE32(26)

static void test_serialize(void** state) {
    (void)state;
    session_policy_t policy = {
        .enabled = 1,
        .allow_permissions = 1,
        .require_witness = 1,
        .max_duration = 300,
        .max_cap = XRP(50),
        .max_per_tx = XRP(10),
    };
    const uint8_t expected[] = {
        0x02,                                            // version
        0x0D,                                            // enabled, P, witness
        0x00, 0x00, 0x00, 0x00, 0x02, 0xFA, 0xF0, 0x80,  // 50 000 000 drops
        0x00, 0x00, 0x00, 0x00, 0x00, 0x98, 0x96, 0x80,  // 10 000 000 drops
        0x00, 0x00, 0x01, 0x2C,                          // 300 s
        FRESH_PROFILES,
    };
    assert_true(sizeof(expected) <= SESSION_POLICY_SERIALIZED_MAX_SIZE);
    uint8_t out[SESSION_POLICY_SERIALIZED_MAX_SIZE];
    assert_int_equal(session_policy_serialize(&policy, out, sizeof(out)), sizeof(expected));
    assert_memory_equal(out, expected, sizeof(expected));

    // Fresh install: policy off, no default limit, every profile on
    session_policy_t off = {0};
    const uint8_t fresh[] = {
        SESSION_POLICY_FORMAT_VERSION, 0, BE64(0), BE64(0), BE32(0), FRESH_PROFILES,
    };
    assert_int_equal(session_policy_serialize(&off, out, sizeof(out)), sizeof(fresh));
    assert_memory_equal(out, fresh, sizeof(fresh));

    // A profile edited on the device: game off, max spend 10 XRP (4th preset),
    // 50 transactions (3rd preset)
    off.profiles[SESSION_PROFILE_GAME].disabled = 1;
    off.profiles[SESSION_PROFILE_GAME].limits[SESSION_PROFILE_LIMIT_CAP] = 4;
    off.profiles[SESSION_PROFILE_GAME].limits[SESSION_PROFILE_LIMIT_TX_COUNT] = 3;
    const uint8_t game[] = {
        SESSION_PROFILE_GAME, 0x00, 0x01, BE64(XRP(10)), BE64(100000), BE32(600), BE32(50), 0,
    };
    size_t game_offset = SESSION_POLICY_HEADER_SIZE + 1 + SESSION_PROFILE_RECORD_SIZE;
    assert_int_equal(session_policy_serialize(&off, out, sizeof(out)), sizeof(fresh));
    assert_memory_equal(out + game_offset, game, sizeof(game));

    assert_int_equal(session_policy_serialize(&policy, out, sizeof(expected) - 1), 0);
}

static uint8_t* load_file(const char* filename, size_t* size) {
    FILE* f = fopen(filename, "rb");
    assert_non_null(f);
    assert_int_equal(fseek(f, 0, SEEK_END), 0);
    long filesize = ftell(f);
    assert_true(filesize > 0);
    assert_int_equal(fseek(f, 0, SEEK_SET), 0);

    uint8_t* data = malloc((size_t)filesize);
    assert_non_null(data);
    assert_true(fread(data, 1, (size_t)filesize, f) == (size_t)filesize);
    fclose(f);
    *size = (size_t)filesize;
    return data;
}

// Parses a vector into parse_context (parse_tx() must give expected_parse)
// and checks it against policy. The parsed fields point into the file data,
// freed once the check is done.
static bool check_parsed_vector(const char* filename,
                                int expected_parse,
                                const session_policy_t* policy,
                                session_policy_verdict_t* verdict) {
    printf("[*] %s\n", filename);
    size_t size;
    uint8_t* data = load_file(filename, &size);

    memset(&parse_context, 0, sizeof(parse_context));
    parse_context.data = data;
    parse_context.length = size;
    assert_int_equal(parse_tx(&parse_context), expected_parse);

    bool allowed = session_policy_check_transaction(policy, verdict);
    free(data);
    return allowed;
}

static bool check_vector(const char* filename,
                         const session_policy_t* policy,
                         session_policy_verdict_t* verdict) {
    return check_parsed_vector(filename, 0, policy, verdict);
}

static void test_vectors(void** state) {
    (void)state;
    session_policy_verdict_t verdict;
    session_policy_t policy = enabled_policy();
    policy.max_cap = XRP(50);

    // 20 XRP cap under a 50 XRP limit
    assert_true(check_vector(TESTCASES "33-session-policy/01-within-policy.raw", &policy, &verdict));

    // 500 XRP cap above it
    assert_false(check_vector(TESTCASES "33-session-policy/02-above-policy.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_CAP_ABOVE);
    assert_int_equal(verdict.group, 0);
    assert_int_equal(verdict.value, XRP(500));
    assert_int_equal(verdict.limit, XRP(50));

    // Policy off: the same transaction goes to review
    session_policy_t off = {0};
    assert_true(check_vector(TESTCASES "33-session-policy/02-above-policy.raw", &off, &verdict));

    // SessionMaxPerTx 5 XRP and a SessionWitness, read from the fields
    policy.max_per_tx = XRP(1);
    assert_false(
        check_vector(TESTCASES "33-session-policy/03-per-tx-and-witness.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_PER_TX_ABOVE);
    assert_int_equal(verdict.value, XRP(5));

    policy.max_per_tx = XRP(5);
    policy.require_witness = 1;
    assert_true(
        check_vector(TESTCASES "33-session-policy/03-per-tx-and-witness.raw", &policy, &verdict));

    // Witness required, none in the transaction
    policy.max_per_tx = SESSION_POLICY_NO_LIMIT;
    assert_false(check_vector(TESTCASES "33-session-policy/01-within-policy.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_WITNESS_MISSING);
}

static void test_vector_modes(void** state) {
    (void)state;
    session_policy_verdict_t verdict;
    session_policy_t policy = enabled_policy();

    assert_false(
        check_vector(TESTCASES "30-signing-session-set/01-mode-all.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_MODE_ALL_BLOCKED);

    assert_false(
        check_vector(TESTCASES "30-signing-session-set/02-mode-permissions.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_MODE_PERMISSIONS_BLOCKED);

    policy.allow_all_transactions = 1;
    policy.allow_permissions = 1;
    assert_true(
        check_vector(TESTCASES "30-signing-session-set/01-mode-all.raw", &policy, &verdict));
    assert_true(
        check_vector(TESTCASES "30-signing-session-set/02-mode-permissions.raw", &policy, &verdict));

    // Not a SigningSessionSet: never affected
    policy.allow_all_transactions = 0;
    policy.allow_permissions = 0;
    policy.max_cap = XRP(1);
    assert_true(check_vector(TESTCASES "01-payment/01-basic.raw", &policy, &verdict));
    assert_true(check_vector(TESTCASES "31-signing-session-delete/01-own-close.raw",
                             &policy,
                             &verdict));

    // Two modes at once: the node refuses it, so does the policy
    policy.allow_all_transactions = 1;
    policy.allow_permissions = 1;
    policy.max_cap = SESSION_POLICY_NO_LIMIT;
    assert_false(
        check_vector(TESTCASES "30-signing-session-set/14-flag-and-cap.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_MODE_INVALID);
    assert_false(check_vector(
        TESTCASES "30-signing-session-set/15-permissions-and-cap.raw", &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_MODE_INVALID);
}

static void test_vector_batch(void** state) {
    (void)state;
    session_policy_verdict_t verdict;
    session_policy_t policy = enabled_policy();
    const char* batch = TESTCASES "32-batch/01-session-and-payment.raw";

    // Inner transaction 1 opens a 20 XRP, 600 s session
    policy.max_cap = XRP(50);
    assert_true(check_vector(batch, &policy, &verdict));

    policy.max_cap = XRP(10);
    assert_false(check_vector(batch, &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_CAP_ABOVE);
    assert_int_equal(verdict.group, 1);
    assert_int_equal(verdict.value, XRP(20));

    policy.max_cap = XRP(50);
    policy.max_duration = 300;
    assert_false(check_vector(batch, &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_DURATION_ABOVE);
    assert_int_equal(verdict.group, 1);
    assert_int_equal(verdict.value, 600);
}

// A Batch whose parsing stops at the field limit, before its inner
// SigningSessionSet (mode A): the policy cannot read it, so refuses it.
static void test_vector_batch_unread(void** state) {
    (void)state;
    session_policy_verdict_t verdict;
    session_policy_t policy = enabled_policy();
    policy.allow_all_transactions = 1;
    const char* batch = TESTCASES "32-batch/06-session-after-field-limit.raw";

    assert_false(check_parsed_vector(batch, SESSION_BLIND_SIGN_REFUSED, &policy, &verdict));
    assert_int_equal(verdict.violation, SESSION_POLICY_UNREAD);
    assert_int_equal(verdict.group, 0);
    // Parsing stopped inside RawTransactions, before the session's type
    assert_true(is_batch_unread(&parse_context));
    for (uint8_t i = 0; i < parse_context.batch.inner_count; i++) {
        assert_int_not_equal(parse_context.batch.inner[i].transaction_type,
                             TRANSACTION_SIGNING_SESSION_SET);
    }

    // Policy off: nothing to check (parse_tx() still refuses blind signing)
    session_policy_t off = {0};
    assert_true(check_parsed_vector(batch, SESSION_BLIND_SIGN_REFUSED, &off, &verdict));
}

static session_profile_t resolved(const session_policy_t* policy, session_profile_id_t id) {
    session_profile_t profile;
    session_profile_resolve(id, &policy->profiles[id], &profile);
    return profile;
}

// A session naming the profile that reaches every one of its limits
static session_request_t profile_request(const session_policy_t* policy, session_profile_id_t id) {
    session_profile_t profile = resolved(policy, id);
    session_request_t request = {
        .has_duration = true,
        .duration = profile.max_duration,
        .has_max_tx_count = true,
        .max_tx_count = profile.max_tx_count,
        .profile_memo = SESSION_PROFILE_MEMO_FOUND,
        .profile = id,
    };
    if ((profile.modes & SESSION_MODE_CAP) != 0) {
        request.has_cap = true;
        request.cap_is_xrp = true;
        request.cap = profile.max_cap;
        request.has_max_per_tx = true;
        request.max_per_tx_is_xrp = true;
        request.max_per_tx = profile.max_per_tx;
    } else {
        request.has_permissions = true;
        request.permissions_nb = profile.permissions_nb;
        memcpy(request.permissions, profile.permissions, sizeof(profile.permissions));
    }
    return request;
}

static void assert_profile_refused(const session_policy_t* policy,
                                   const session_request_t* request,
                                   session_policy_violation_t violation,
                                   uint64_t value,
                                   uint64_t limit) {
    session_policy_verdict_t verdict;
    assert_false(session_policy_check(policy, request, &verdict));
    assert_int_equal(verdict.violation, violation);
    assert_int_equal(verdict.value, value);
    assert_int_equal(verdict.limit, limit);
    assert_true(verdict.has_profile);
    assert_int_equal(verdict.profile, request->profile);
}

static void test_profile_defaults(void** state) {
    (void)state;
    session_policy_t policy = {0};
    const struct {
        session_profile_id_t id;
        uint8_t modes;
        uint64_t max_cap;
        uint64_t max_per_tx;
        uint32_t max_duration;
        uint32_t max_tx_count;
        uint8_t permissions_nb;
        uint32_t permissions[SESSION_PROFILE_MAX_PERMISSIONS];
    } expected[SESSION_PROFILES_NB] = {
        {SESSION_PROFILE_AGENT, SESSION_MODE_CAP, XRP(50), XRP(5), 180, 20, 0, {0}},
        {SESSION_PROFILE_GAME, SESSION_MODE_CAP, XRP(5), 100000, 600, 500, 0, {0}},
        {SESSION_PROFILE_TRADING, SESSION_MODE_PERMISSIONS, 0, 0, 600, 200, 2, {8, 9}},
        {SESSION_PROFILE_STREAMING, SESSION_MODE_CAP, XRP(2), 10000, 600, 1000, 0, {0}},
        {SESSION_PROFILE_MINTING, SESSION_MODE_PERMISSIONS, 0, 0, 600, 100, 1, {26}},
    };
    for (int i = 0; i < SESSION_PROFILES_NB; i++) {
        session_profile_t profile = resolved(&policy, expected[i].id);
        assert_true(profile.enabled);
        assert_int_equal(profile.modes, expected[i].modes);
        assert_int_equal(profile.max_cap, expected[i].max_cap);
        assert_int_equal(profile.max_per_tx, expected[i].max_per_tx);
        assert_int_equal(profile.max_duration, expected[i].max_duration);
        assert_int_equal(profile.max_tx_count, expected[i].max_tx_count);
        assert_int_equal(profile.permissions_nb, expected[i].permissions_nb);
        assert_memory_equal(profile.permissions,
                            expected[i].permissions,
                            expected[i].permissions_nb * sizeof(uint32_t));
    }
}

// Every profile: within its limits, then above each one of them
static void test_profile_limits(void** state) {
    (void)state;
    for (int i = 0; i < SESSION_PROFILES_NB; i++) {
        session_profile_id_t id = (session_profile_id_t)i;
        printf("[*] profile %s\n", session_profile_title(id));
        session_policy_t policy = enabled_policy();
        session_profile_t profile = resolved(&policy, id);
        const session_request_t within = profile_request(&policy, id);

        session_policy_verdict_t verdict;
        assert_true(session_policy_check(&policy, &within, &verdict));
        assert_true(verdict.has_profile);
        assert_int_equal(verdict.profile, id);

        session_request_t request = within;
        request.max_tx_count++;
        assert_profile_refused(&policy,
                               &request,
                               SESSION_POLICY_TX_COUNT_ABOVE,
                               profile.max_tx_count + 1,
                               profile.max_tx_count);

        request = within;
        request.has_max_tx_count = false;
        assert_profile_refused(&policy,
                               &request,
                               SESSION_POLICY_TX_COUNT_MISSING,
                               0,
                               profile.max_tx_count);

        // The 1 minute preset of max duration
        session_policy_t short_policy = policy;
        short_policy.profiles[id].limits[SESSION_PROFILE_LIMIT_DURATION] = 1;
        request = within;
        request.duration = 61;
        assert_profile_refused(&short_policy, &request, SESSION_POLICY_DURATION_ABOVE, 61, 60);

        if ((profile.modes & SESSION_MODE_CAP) != 0) {
            request = within;
            request.cap++;
            assert_profile_refused(&policy,
                                   &request,
                                   SESSION_POLICY_CAP_ABOVE,
                                   profile.max_cap + 1,
                                   profile.max_cap);

            request = within;
            request.max_per_tx++;
            assert_profile_refused(&policy,
                                   &request,
                                   SESSION_POLICY_PER_TX_ABOVE,
                                   profile.max_per_tx + 1,
                                   profile.max_per_tx);

            request = within;
            request.has_max_per_tx = false;
            assert_profile_refused(&policy,
                                   &request,
                                   SESSION_POLICY_PER_TX_MISSING,
                                   0,
                                   profile.max_per_tx);

            // Mode P under a mode C profile
            request = within;
            request.has_cap = false;
            request.has_max_per_tx = false;
            request.has_permissions = true;
            request.permissions_nb = 1;
            request.permissions[0] = 1;
            assert_profile_refused(&policy, &request, SESSION_POLICY_PROFILE_MODE, 0, 0);
        } else {
            // Payment (0 + 1) is in no mode P profile
            request = within;
            request.permissions[request.permissions_nb++] = 1;
            assert_profile_refused(&policy, &request, SESSION_POLICY_PROFILE_PERMISSION, 1, 0);

            // Mode C under a mode P profile
            request = within;
            request.has_permissions = false;
            request.permissions_nb = 0;
            request.has_cap = true;
            request.cap_is_xrp = true;
            request.cap = XRP(1);
            assert_profile_refused(&policy, &request, SESSION_POLICY_PROFILE_MODE, 0, 0);
        }

        // Mode A is in no profile
        request = within;
        request.has_cap = false;
        request.has_max_per_tx = false;
        request.has_permissions = false;
        request.permissions_nb = 0;
        request.all_transactions = true;
        assert_profile_refused(&policy, &request, SESSION_POLICY_PROFILE_MODE, 0, 0);

        // Turned off in the settings
        session_policy_t off_profile = policy;
        off_profile.profiles[id].disabled = 1;
        assert_profile_refused(&off_profile, &within, SESSION_POLICY_PROFILE_OFF, 0, 0);

        // An unknown name, or two memos, whatever the profile
        request = within;
        request.profile_memo = SESSION_PROFILE_MEMO_UNKNOWN;
        assert_refused(&policy, &request, SESSION_POLICY_PROFILE_UNKNOWN, 0, 0);
        request.profile_memo = SESSION_PROFILE_MEMO_DUPLICATE;
        assert_refused(&policy, &request, SESSION_POLICY_PROFILE_DUPLICATE, 0, 0);

        // Policy off: nothing is checked
        session_policy_t off = {0};
        request = within;
        request.max_tx_count++;
        assert_allowed(&off, &request);
    }
}

// A profile replaces the default limits; the witness switch holds for all
static void test_profile_and_default(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    policy.max_cap = XRP(1);
    policy.max_duration = 60;

    // Mode P is off by default, the trading profile allows it
    session_request_t trading = profile_request(&policy, SESSION_PROFILE_TRADING);
    assert_allowed(&policy, &trading);
    // 5 XRP and 600 s are above the default limits, within the game profile
    session_request_t game = profile_request(&policy, SESSION_PROFILE_GAME);
    assert_allowed(&policy, &game);
    // Without the memo, the default limits apply
    game.profile_memo = SESSION_PROFILE_MEMO_NONE;
    assert_refused(&policy, &game, SESSION_POLICY_CAP_ABOVE, XRP(5), XRP(1));

    policy.require_witness = 1;
    assert_profile_refused(&policy, &trading, SESSION_POLICY_WITNESS_MISSING, 0, 0);
    trading.has_witness = true;
    assert_allowed(&policy, &trading);
}

// The node accepts 1 to 100000 (SigningSessionSet::preflight)
static void test_tx_count_node_rule(void** state) {
    (void)state;
    session_policy_t policy = enabled_policy();
    session_request_t request = capped_request();
    request.has_max_tx_count = true;

    request.max_tx_count = 0;
    assert_refused(&policy, &request, SESSION_POLICY_TX_COUNT_INVALID, 0, SESSION_MAX_TX_COUNT);
    request.max_tx_count = SESSION_MAX_TX_COUNT + 1;
    assert_refused(&policy,
                   &request,
                   SESSION_POLICY_TX_COUNT_INVALID,
                   SESSION_MAX_TX_COUNT + 1,
                   SESSION_MAX_TX_COUNT);
    request.max_tx_count = SESSION_MAX_TX_COUNT;
    assert_allowed(&policy, &request);
}

static void test_profile_settings(void** state) {
    (void)state;
    session_profile_settings_t settings = {0};
    session_profile_t profile;

    // Max spend of the game profile: from its 5 XRP default through every
    // preset (1, 2, 5, 10, 20, 50, 100 XRP) and back
    const uint64_t cycle[] = {XRP(10), XRP(20), XRP(50), XRP(100), XRP(1), XRP(2), XRP(5)};
    for (size_t i = 0; i < sizeof(cycle) / sizeof(cycle[0]); i++) {
        uint8_t* stored = &settings.limits[SESSION_PROFILE_LIMIT_CAP];
        *stored = session_profile_next_limit(SESSION_PROFILE_GAME, SESSION_PROFILE_LIMIT_CAP, *stored);
        session_profile_resolve(SESSION_PROFILE_GAME, &settings, &profile);
        assert_int_equal(profile.max_cap, cycle[i]);
    }

    // A stored index no preset has falls back to the default
    settings.limits[SESSION_PROFILE_LIMIT_TX_COUNT] = 200;
    session_profile_resolve(SESSION_PROFILE_GAME, &settings, &profile);
    assert_int_equal(profile.max_tx_count, 500);

    // Mode P profiles have no amount to limit
    assert_false(session_profile_has_limit(SESSION_PROFILE_TRADING, SESSION_PROFILE_LIMIT_CAP));
    assert_false(session_profile_has_limit(SESSION_PROFILE_MINTING, SESSION_PROFILE_LIMIT_PER_TX));
    assert_true(session_profile_has_limit(SESSION_PROFILE_MINTING, SESSION_PROFILE_LIMIT_TX_COUNT));
    assert_true(session_profile_has_limit(SESSION_PROFILE_AGENT, SESSION_PROFILE_LIMIT_PER_TX));

    // MemoData names, exactly
    session_profile_id_t id;
    assert_true(session_profile_from_memo((const uint8_t*)"streaming", 9, &id));
    assert_int_equal(id, SESSION_PROFILE_STREAMING);
    assert_false(session_profile_from_memo((const uint8_t*)"Game", 4, &id));
    assert_false(session_profile_from_memo((const uint8_t*)"games", 5, &id));
    assert_false(session_profile_from_memo((const uint8_t*)"gam", 3, &id));
}

static void test_profile_refusal_text(void** state) {
    (void)state;
    session_policy_verdict_t verdict = {
        .violation = SESSION_POLICY_CAP_ABOVE,
        .has_profile = true,
        .profile = SESSION_PROFILE_GAME,
        .value = XRP(50),
        .limit = XRP(5),
    };
    assert_reason(&verdict, "Profile Game: Max spend XRP 50 is above XRP 5");

    session_policy_verdict_t count = {
        .violation = SESSION_POLICY_TX_COUNT_MISSING,
        .has_profile = true,
        .profile = SESSION_PROFILE_STREAMING,
        .limit = 1000,
    };
    assert_reason(&count, "Profile Streaming: Set a transaction limit (at most 1000)");

    session_policy_verdict_t above = {
        .violation = SESSION_POLICY_TX_COUNT_ABOVE,
        .has_profile = true,
        .profile = SESSION_PROFILE_AGENT,
        .value = 21,
        .limit = 20,
    };
    assert_reason(&above, "Profile Agent: Max transactions 21 is above 20");

    session_policy_verdict_t permission = {
        .violation = SESSION_POLICY_PROFILE_PERMISSION,
        .has_profile = true,
        .profile = SESSION_PROFILE_TRADING,
        .value = 1,
    };
    assert_reason(&permission, "Profile Trading: Payment is not allowed");

    session_policy_verdict_t off = {
        .violation = SESSION_POLICY_PROFILE_OFF,
        .has_profile = true,
        .profile = SESSION_PROFILE_MINTING,
    };
    assert_reason(&off, "Profile Minting: This profile is off in your settings");

    session_policy_verdict_t unknown = {.violation = SESSION_POLICY_PROFILE_UNKNOWN};
    assert_reason(&unknown, "Unknown session profile");
    session_policy_verdict_t duplicate = {.violation = SESSION_POLICY_PROFILE_DUPLICATE};
    assert_reason(&duplicate, "More than one session profile");
    session_policy_verdict_t invalid = {
        .violation = SESSION_POLICY_TX_COUNT_INVALID,
        .value = 0,
        .limit = SESSION_MAX_TX_COUNT,
    };
    assert_reason(&invalid, "Max transactions 0 is not 1 to 100000");
}

// Index of the review row of the given type and id, or -1
static int row_index(field_type_t data_type, uint8_t id) {
    for (uint8_t i = 0; i < parse_context.result.num_fields; i++) {
        const field_t* field = &parse_context.result.fields[i];
        if (field->data_type == data_type && field->id == id) {
            return i;
        }
    }
    return -1;
}

static void assert_profile_row(const char* title) {
    int agent_id = row_index(STI_ACCOUNT, XRP_ACCOUNT_AGENT_ID);
    int row = row_index(STI_VL, XRP_VL_SESSION_PROFILE);
    assert_true(agent_id > 0);
    // Right after the session key and its Agent ID
    assert_int_equal(row, agent_id + 1);
    const field_t* field = &parse_context.result.fields[row];
    assert_int_equal(field->length, strlen(title));
    assert_memory_equal(field->data.ptr, title, field->length);
}

static void assert_vector_refused(const char* filename,
                                  const session_policy_t* policy,
                                  session_policy_violation_t violation,
                                  uint64_t value,
                                  uint64_t limit) {
    session_policy_verdict_t verdict;
    assert_false(check_vector(filename, policy, &verdict));
    assert_int_equal(verdict.violation, violation);
    assert_int_equal(verdict.value, value);
    assert_int_equal(verdict.limit, limit);
}

#define PROFILE_VECTORS TESTCASES "33-session-policy/"

static void test_profile_vectors(void** state) {
    (void)state;
    session_policy_verdict_t verdict;
    session_policy_t policy = enabled_policy();

    // Game: 5 XRP, 0.1 XRP per payment, 300 transactions, 600 s
    assert_true(check_vector(PROFILE_VECTORS "04-profile-game.raw", &policy, &verdict));
    assert_true(verdict.has_profile);
    assert_int_equal(verdict.profile, SESSION_PROFILE_GAME);
    assert_profile_row("Game");

    // Trading: OfferCreate and OfferCancel, 200 transactions
    assert_true(check_vector(PROFILE_VECTORS "07-profile-trading.raw", &policy, &verdict));
    assert_int_equal(verdict.profile, SESSION_PROFILE_TRADING);
    assert_profile_row("Trading");

    assert_vector_refused(PROFILE_VECTORS "05-profile-game-above-cap.raw",
                          &policy,
                          SESSION_POLICY_CAP_ABOVE,
                          XRP(50),
                          XRP(5));
    assert_vector_refused(PROFILE_VECTORS "06-profile-game-no-tx-count.raw",
                          &policy,
                          SESSION_POLICY_TX_COUNT_MISSING,
                          0,
                          500);
    assert_vector_refused(PROFILE_VECTORS "08-profile-trading-payment.raw",
                          &policy,
                          SESSION_POLICY_PROFILE_PERMISSION,
                          1,
                          0);
    // A memo naming no profile, or two: refused, and no Profile row
    assert_vector_refused(PROFILE_VECTORS "09-profile-unknown.raw",
                          &policy,
                          SESSION_POLICY_PROFILE_UNKNOWN,
                          0,
                          0);
    assert_int_equal(row_index(STI_VL, XRP_VL_SESSION_PROFILE), -1);
    assert_vector_refused(PROFILE_VECTORS "10-profile-duplicate.raw",
                          &policy,
                          SESSION_POLICY_PROFILE_DUPLICATE,
                          0,
                          0);
    assert_int_equal(row_index(STI_VL, XRP_VL_SESSION_PROFILE), -1);

    // The game profile turned off in the settings
    session_policy_t game_off = policy;
    game_off.profiles[SESSION_PROFILE_GAME].disabled = 1;
    assert_vector_refused(PROFILE_VECTORS "04-profile-game.raw",
                          &game_off,
                          SESSION_POLICY_PROFILE_OFF,
                          0,
                          0);

    // A tighter limit set on the device: 200 transactions
    session_policy_t tighter = policy;
    tighter.profiles[SESSION_PROFILE_GAME].limits[SESSION_PROFILE_LIMIT_TX_COUNT] = 5;
    assert_vector_refused(PROFILE_VECTORS "04-profile-game.raw",
                          &tighter,
                          SESSION_POLICY_TX_COUNT_ABOVE,
                          300,
                          200);

    // Policy off: nothing is checked, the review still names the profile
    // (the real app's game and trading openings, field report from a Stax)
    session_policy_t off = {0};
    assert_true(check_vector(PROFILE_VECTORS "04-profile-game.raw", &off, &verdict));
    assert_false(verdict.has_profile);
    assert_profile_row("Game");
    assert_true(check_vector(PROFILE_VECTORS "07-profile-trading.raw", &off, &verdict));
    assert_profile_row("Trading");
    assert_true(check_vector(PROFILE_VECTORS "09-profile-unknown.raw", &off, &verdict));
}

int main() {
    const struct CMUnitTest tests[] = {
        cmocka_unit_test(test_policy_off),
        cmocka_unit_test(test_mode_all),
        cmocka_unit_test(test_mode_permissions),
        cmocka_unit_test(test_mode_invalid),
        cmocka_unit_test(test_node_rules),
        cmocka_unit_test(test_amounts),
        cmocka_unit_test(test_cap),
        cmocka_unit_test(test_max_per_tx),
        cmocka_unit_test(test_duration),
        cmocka_unit_test(test_witness),
        cmocka_unit_test(test_format_refusal),
        cmocka_unit_test(test_serialize),
        cmocka_unit_test(test_vectors),
        cmocka_unit_test(test_vector_modes),
        cmocka_unit_test(test_vector_batch),
        cmocka_unit_test(test_vector_batch_unread),
        cmocka_unit_test(test_profile_defaults),
        cmocka_unit_test(test_profile_limits),
        cmocka_unit_test(test_profile_and_default),
        cmocka_unit_test(test_tx_count_node_rule),
        cmocka_unit_test(test_profile_settings),
        cmocka_unit_test(test_profile_refusal_text),
        cmocka_unit_test(test_profile_vectors),
    };

    return cmocka_run_group_tests(tests, NULL, NULL);
}
