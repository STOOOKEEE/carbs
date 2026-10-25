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
    const uint8_t expected[SESSION_POLICY_SERIALIZED_SIZE] = {
        0x01,                                            // version
        0x0D,                                            // enabled, P, witness
        0x00, 0x00, 0x00, 0x00, 0x02, 0xFA, 0xF0, 0x80,  // 50 000 000 drops
        0x00, 0x00, 0x00, 0x00, 0x00, 0x98, 0x96, 0x80,  // 10 000 000 drops
        0x00, 0x00, 0x01, 0x2C,                          // 300 s
    };
    uint8_t out[SESSION_POLICY_SERIALIZED_SIZE];
    assert_int_equal(session_policy_serialize(&policy, out, sizeof(out)), sizeof(out));
    assert_memory_equal(out, expected, sizeof(expected));

    // Policy off (fresh install): only the version byte is set
    session_policy_t off = {0};
    uint8_t zeros[SESSION_POLICY_SERIALIZED_SIZE] = {SESSION_POLICY_FORMAT_VERSION};
    assert_int_equal(session_policy_serialize(&off, out, sizeof(out)), sizeof(out));
    assert_memory_equal(out, zeros, sizeof(zeros));

    assert_int_equal(session_policy_serialize(&policy, out, sizeof(out) - 1), 0);
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
    };

    return cmocka_run_group_tests(tests, NULL, NULL);
}
