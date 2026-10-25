/*******************************************************************************
 *   carbs: unit tests of the ML-DSA-44 signing path (INS 0x10, 0x11, 0x12).
 *
 *   The real entry.c (instruction dispatch and its context reset), global.c
 *   (reset_transaction_context) and pq_root.c are compiled into this file;
 *   the transaction parser is the real one (libxrp). Only the SDK is
 *   replaced: the APDU answers, the key derivation, ML-DSA signing and the
 *   screens are test doubles that record what they are given (include_pq/).
 *   The vectors are the device track's frozen transactions
 *   (tests/standalone/testcases).
 ********************************************************************************/

// clang-format off
#include <setjmp.h>
#include <stdarg.h>
#include <stddef.h>
#include <cmocka.h>
// clang-format on
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "globals.h"

#if defined(__APPLE__)
/* glibc has it; the macOS libc does not. */
static void explicit_bzero(void* buffer, size_t length) {
    volatile uint8_t* p = buffer;
    while (length-- > 0) {
        *p++ = 0;
    }
}
#endif

/* N_storage reads the settings through PIC(): point it at a mutable copy. */
static internal_storage_t test_storage;
#define PIC(x) ((const void*)&test_storage)

#include "../../src/apdu/entry.c"
#include "../../src/apdu/global.c"
#include "../../src/pq/pq_root.c"

/* ---------------------------------------------------------------- doubles */

parseContext_t parse_context; /* defined by sign_transaction.c in the app */
uint8_t G_io_apdu_buffer[260];
volatile bool G_called_from_swap = false;

#define NO_SW 0xFFFFU

static uint16_t last_sw;
static uint8_t last_data[260];
static size_t last_data_length;
static int answers;

static int review_screens;
static int blind_review_screens;
static int blind_error_screens;
static int session_blind_screens;
static int policy_refusal_screens;
static session_policy_verdict_t policy_verdict;
static resultAction_t review_callback;

static uint8_t signed_message[PQ_MAX_MESSAGE];
static size_t signed_length;
static int signatures;

int io_send_sw(uint16_t sw) {
    last_sw = sw;
    last_data_length = 0;
    answers++;
    return 0;
}

int io_send_response_pointer(const uint8_t* ptr, size_t size, uint16_t sw) {
    assert_true(size <= sizeof(last_data));
    memcpy(last_data, ptr, size);
    last_data_length = size;
    last_sw = sw;
    answers++;
    return 0;
}

cx_err_t os_derive_bip32_with_seed_no_throw(
    unsigned int derivation_mode, cx_curve_t curve, const unsigned int* path,
    unsigned int path_length, unsigned char raw_privkey[64],
    unsigned char* chain_code, unsigned char* seed_key,
    unsigned int seed_key_length) {
    (void)derivation_mode;
    (void)curve;
    (void)path;
    (void)path_length;
    (void)chain_code;
    (void)seed_key;
    (void)seed_key_length;
    memset(raw_privkey, 0x5A, 64);
    return CX_OK;
}

cx_err_t MLDSA_internal_keygen(uint8_t* pk, size_t pk_len, uint8_t* sk,
                               size_t sk_len,
                               const uint8_t seed[MLDSA_SEEDBYTES],
                               MLDSA_param_t param) {
    (void)seed;
    (void)param;
    for (size_t i = 0; i < pk_len; i++) {
        pk[i] = (uint8_t)i;
    }
    memset(sk, 0xA5, sk_len);
    return CX_OK;
}

cx_err_t MLDSA_sign(uint8_t* sig, size_t sig_max_len, size_t* sig_len,
                    const uint8_t* m, size_t mlen, const uint8_t* ctx,
                    size_t ctxlen, const uint8_t* sk, size_t sk_len,
                    MLDSA_param_t param) {
    (void)ctx;
    (void)sk;
    (void)sk_len;
    assert_int_equal(param, MLDSA_44);
    assert_int_equal(ctxlen, 0);
    assert_true(sig_max_len >= MLDSA44_SIGBYTES);
    assert_true(mlen <= sizeof(signed_message));
    memcpy(signed_message, m, mlen);
    signed_length = mlen;
    signatures++;
    for (size_t i = 0; i < MLDSA44_SIGBYTES; i++) {
        sig[i] = (uint8_t)(i * 7);
    }
    *sig_len = MLDSA44_SIGBYTES;
    return CX_OK;
}

void display_review_menu(parseResult_t* transaction_param,
                         resultAction_t callback) {
    (void)transaction_param;
    review_screens++;
    review_callback = callback;
}

void display_blind_signed_review(parseResult_t* transaction_param,
                                 resultAction_t callback) {
    (void)transaction_param;
    blind_review_screens++;
    review_callback = callback;
}

/* The classical handlers that entry.c dispatches to: not under test here. */
int handle_get_public_key(uint8_t p1, uint8_t p2, uint8_t* data_buffer,
                          uint16_t data_length) {
    (void)p1;
    (void)p2;
    (void)data_buffer;
    (void)data_length;
    return io_send_sw(SW_OK);
}

int handle_sign(uint8_t p1, uint8_t p2, uint8_t* work_buffer,
                uint8_t data_length) {
    (void)p1;
    (void)p2;
    (void)work_buffer;
    (void)data_length;
    return io_send_sw(SW_OK);
}

int handle_get_app_configuration(void) { return io_send_sw(SW_OK); }

int handle_get_session_policy(uint8_t p1, uint8_t p2) {
    (void)p1;
    (void)p2;
    return io_send_sw(SW_OK);
}

/* As reject_transaction() in sign_transaction.c (outside a swap): it answers
 * 0x6985 only in PENDING_REVIEW, and always resets the context. */
void reject_transaction(void) {
    if (sign_state == PENDING_REVIEW) {
        io_send_sw(SW_DENY);
    }
    reset_transaction_context();
}

/* As ui_error_blind_signing() in ui/other/blind_signing.c: the error screen,
 * then reject_transaction(). */
int ui_error_blind_signing(void) {
    blind_error_screens++;
    reject_transaction();
    return 0;
}

/* As ui_error_session_blind_signing() in ui/other/blind_signing.c: the screen
 * only, the caller answers. */
void ui_error_session_blind_signing(void) { session_blind_screens++; }

/* As ui_session_policy_refusal() in ui/other/session_policy_refusal.c: the
 * screen, then 0x6986 and the context reset. */
void ui_session_policy_refusal(const session_policy_verdict_t* verdict) {
    policy_refusal_screens++;
    policy_verdict = *verdict;
    io_send_sw(SW_SESSION_POLICY_REFUSED);
    reset_transaction_context();
}

/* ---------------------------------------------------------------- helpers */

#define INS_GET_APP_CONFIG INS_GET_APP_CONFIGURATION
#define SIGNING_DATA_MAX PQ_MAX_MESSAGE

typedef struct {
    uint8_t bytes[SIGNING_DATA_MAX + 64];
    size_t length;
} message_t;

/* Sends one APDU through the real entry.c and returns its status word, or
 * NO_SW when the app answered nothing (a review is on screen). */
static uint16_t apdu(uint8_t ins, uint8_t p1, uint8_t p2, const uint8_t* data,
                     size_t length) {
    assert_true(length <= 255);
    memset(G_io_apdu_buffer, 0, sizeof(G_io_apdu_buffer));
    G_io_apdu_buffer[OFFSET_CLA] = CLA;
    G_io_apdu_buffer[OFFSET_INS] = ins;
    G_io_apdu_buffer[OFFSET_P1] = p1;
    G_io_apdu_buffer[OFFSET_P2] = p2;
    G_io_apdu_buffer[OFFSET_LC] = (uint8_t)length;
    if (length > 0) {
        memcpy(G_io_apdu_buffer + OFFSET_CDATA, data, length);
    }
    int before = answers;
    handle_apdu();
    return answers == before ? NO_SW : last_sw;
}

/* Sends the signing data in chunks of `chunk` bytes (P1 0 then 1, P2 1 on
 * the last). Returns the status word of the last chunk. */
static uint16_t send_signing_data(const message_t* message, size_t chunk) {
    size_t offset = 0;
    uint16_t sw = NO_SW;
    while (offset < message->length) {
        size_t length =
            message->length - offset < chunk ? message->length - offset : chunk;
        bool last = offset + length == message->length;
        sw = apdu(INS_PQ_SIGN, offset == 0 ? 0 : 1, last ? 1 : 0,
                  message->bytes + offset, length);
        offset += length;
        if (!last && sw != SW_OK) {
            return sw;
        }
    }
    return sw;
}

/* "STX\0" followed by a frozen transaction of the device track. */
static void load_signing_data(const char* name, message_t* message) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", TESTCASES_DIR, name);
    FILE* file = fopen(path, "rb");
    assert_non_null(file);
    memcpy(message->bytes, PQ_SIGNING_PREFIX, sizeof(PQ_SIGNING_PREFIX));
    size_t read =
        fread(message->bytes + sizeof(PQ_SIGNING_PREFIX), 1,
              sizeof(message->bytes) - sizeof(PQ_SIGNING_PREFIX), file);
    fclose(file);
    assert_true(read > 0);
    message->length = sizeof(PQ_SIGNING_PREFIX) + read;
}

static void approve(void) {
    assert_non_null(review_callback);
    review_callback(OPTION_SIGN);
}

static void reject(void) {
    assert_non_null(review_callback);
    review_callback(OPTION_REJECT);
}

/* Reads the whole signature through INS 0x12. */
static size_t read_signature(uint8_t* out, size_t capacity) {
    size_t total = 0;
    for (uint8_t index = 0;; index++) {
        uint16_t sw = apdu(INS_PQ_GET_SIGNATURE, index, 0, NULL, 0);
        if (sw != SW_OK) {
            assert_int_equal(sw, SW_WRONG_P1P2);
            return total;
        }
        assert_true(total + last_data_length <= capacity);
        memcpy(out + total, last_data, last_data_length);
        total += last_data_length;
    }
}

static int setup(void** state) {
    (void)state;
    reset_transaction_context();
    pq_signature_length = 0;
    last_ins = 0;
    last_sw = NO_SW;
    last_data_length = 0;
    answers = 0;
    review_screens = 0;
    blind_review_screens = 0;
    blind_error_screens = 0;
    session_blind_screens = 0;
    policy_refusal_screens = 0;
    memset(&policy_verdict, 0, sizeof(policy_verdict));
    review_callback = NULL;
    signed_length = 0;
    signatures = 0;
    test_storage.allow_blind_sign = BlindSignEnabled;
    memset(&test_storage.session_policy, 0,
           sizeof(test_storage.session_policy));
    test_storage.initialized = 1;
    return 0;
}

#define PAYMENT_A "01-payment/01-basic.raw"
#define PAYMENT_B "01-payment/02-destination-tag.raw"

/* ------------------------------------------------------- the 0x10-0x12 path */

static void test_public_key_chunks(void** state) {
    (void)state;
    size_t total = 0;
    for (uint8_t index = 0; index < 6; index++) {
        assert_int_equal(apdu(INS_PQ_GET_PUBLIC_KEY, index, 0, NULL, 0), SW_OK);
        for (size_t i = 0; i < last_data_length; i++) {
            assert_int_equal(last_data[i], (uint8_t)(total + i));
        }
        total += last_data_length;
    }
    assert_int_equal(total, MLDSA44_PUBLICKEYBYTES);
    assert_int_equal(apdu(INS_PQ_GET_PUBLIC_KEY, 6, 0, NULL, 0), SW_WRONG_P1P2);
}

static void test_sign_reassembles_chunks(void** state) {
    (void)state;
    message_t message;
    load_signing_data(PAYMENT_A, &message);

    /* Small chunks so that the transaction spans several APDUs. */
    assert_int_equal(send_signing_data(&message, 40), NO_SW);
    assert_int_equal(review_screens, 1);
    assert_int_equal(blind_review_screens, 0);

    approve();
    assert_int_equal(last_sw, SW_OK);
    assert_int_equal(last_data_length, 2);
    assert_int_equal((last_data[0] << 8) | last_data[1], MLDSA44_SIGBYTES);
    assert_int_equal(signatures, 1);
    assert_int_equal(signed_length, message.length);
    assert_memory_equal(signed_message, message.bytes, message.length);

    uint8_t signature[MLDSA44_SIGBYTES + 250];
    assert_int_equal(read_signature(signature, sizeof(signature)),
                     MLDSA44_SIGBYTES);
    for (size_t i = 0; i < MLDSA44_SIGBYTES; i++) {
        assert_int_equal(signature[i], (uint8_t)(i * 7));
    }
}

static void test_sign_requires_prefix(void** state) {
    (void)state;
    message_t message;
    load_signing_data(PAYMENT_A, &message);

    message.bytes[2] = 'Y'; /* "STY\0" */
    assert_int_equal(send_signing_data(&message, 250), SW_WRONG_DATA);

    static const uint8_t prefix_only[] = {0x53, 0x54, 0x58, 0x00};
    assert_int_equal(apdu(INS_PQ_SIGN, 0, 1, prefix_only, sizeof(prefix_only)),
                     SW_WRONG_DATA);

    assert_int_equal(review_screens + blind_review_screens, 0);
    assert_int_equal(signatures, 0);
}

static void test_sign_rejects_unparsable_data(void** state) {
    (void)state;
    message_t message;
    load_signing_data(PAYMENT_A, &message);
    message.length -= 10; /* truncated transaction */
    assert_int_equal(send_signing_data(&message, 250), SW_WRONG_DATA);
    assert_int_equal(review_screens + blind_review_screens, 0);
}

static void test_sign_length_limit(void** state) {
    (void)state;
    uint8_t chunk[250];
    memset(chunk, 0x11, sizeof(chunk));

    /* 8 x 250 + 48 = 2 048 bytes are accepted... */
    for (int i = 0; i < 8; i++) {
        assert_int_equal(
            apdu(INS_PQ_SIGN, i == 0 ? 0 : 1, 0, chunk, sizeof(chunk)), SW_OK);
    }
    assert_int_equal(apdu(INS_PQ_SIGN, 1, 0, chunk, 48), SW_OK);
    assert_int_equal(PQ->message_length, PQ_MAX_MESSAGE);

    /* ...one more byte is not, and the buffer is dropped. */
    assert_int_equal(apdu(INS_PQ_SIGN, 1, 1, chunk, 1), SW_WRONG_LENGTH);
    assert_int_equal(PQ->message_length, 0);
    assert_int_equal(review_screens + blind_review_screens, 0);
}

static void test_sign_bad_p1_p2(void** state) {
    (void)state;
    static const uint8_t byte = 0;
    assert_int_equal(apdu(INS_PQ_SIGN, 2, 0, &byte, 1), SW_WRONG_P1P2);
    assert_int_equal(apdu(INS_PQ_SIGN, 0, 2, &byte, 1), SW_WRONG_P1P2);
}

static void test_reject_answers_deny(void** state) {
    (void)state;
    message_t message;
    load_signing_data(PAYMENT_A, &message);
    assert_int_equal(send_signing_data(&message, 250), NO_SW);
    reject();
    assert_int_equal(last_sw, SW_DENY);
    assert_int_equal(signatures, 0);
    assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0),
                     SW_NO_SIGNATURE);
}

static void test_new_signing_data_drops_old_signature(void** state) {
    (void)state;
    message_t message;
    load_signing_data(PAYMENT_A, &message);
    assert_int_equal(send_signing_data(&message, 250), NO_SW);
    approve();
    assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0), SW_OK);

    /* A new first chunk (P1 = 0) makes the previous signature unreadable. */
    assert_int_equal(apdu(INS_PQ_SIGN, 0, 0, message.bytes, 10), SW_OK);
    assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0),
                     SW_NO_SIGNATURE);
}

/* ------------------------------------------- what is approved is what is shown
 */

/* While the review of A is on screen, a host sends the whole of B as a new
 * signing request. The app must refuse it (as the classical path does in
 * PENDING_REVIEW) and the approval must sign A, never B. */
static void test_review_refuses_new_signing_data(void** state) {
    (void)state;
    message_t a, b;
    load_signing_data(PAYMENT_A, &a);
    load_signing_data(PAYMENT_B, &b);

    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    assert_int_equal(review_screens, 1);

    assert_int_equal(send_signing_data(&b, 250), SW_WRONG_DATA);
    assert_int_equal(review_screens, 1);

    approve();
    assert_int_equal(last_sw, SW_OK);
    assert_int_equal(signatures, 1);
    assert_int_equal(signed_length, a.length);
    assert_memory_equal(signed_message, a.bytes, a.length);
}

/* Same, with chunks that do not end the request (P2 = 0): they must not
 * reach the buffer under review either. */
static void test_review_refuses_partial_chunks(void** state) {
    (void)state;
    message_t a, b;
    load_signing_data(PAYMENT_A, &a);
    load_signing_data(PAYMENT_B, &b);

    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    assert_int_equal(apdu(INS_PQ_SIGN, 0, 0, b.bytes, b.length), SW_WRONG_DATA);
    assert_int_equal(apdu(INS_PQ_SIGN, 1, 0, b.bytes, b.length), SW_WRONG_DATA);

    approve();
    assert_int_equal(signatures, 1);
    assert_int_equal(signed_length, a.length);
    assert_memory_equal(signed_message, a.bytes, a.length);
}

/* Another instruction during the review resets the context (entry.c): the
 * pending request is gone, so the approval must sign nothing. */
static void test_other_instruction_cancels_review(void** state) {
    (void)state;
    static const uint8_t other_ins[] = {
        INS_PQ_GET_PUBLIC_KEY,
        INS_GET_PUBLIC_KEY,
        INS_GET_APP_CONFIG,
        INS_PQ_GET_SIGNATURE,
    };
    for (size_t i = 0; i < sizeof(other_ins); i++) {
        setup(NULL);
        message_t a;
        load_signing_data(PAYMENT_A, &a);
        assert_int_equal(send_signing_data(&a, 250), NO_SW);

        apdu(other_ins[i], 0, 0, NULL, 0);
        int before = answers;
        approve();
        assert_int_equal(signatures, 0);
        assert_int_equal(answers, before);
        assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0),
                         SW_NO_SIGNATURE);
    }
}

/* Defence in depth: if the bytes under review change by any route, the
 * approval refuses instead of signing them. */
static void test_approval_checks_reviewed_bytes(void** state) {
    (void)state;
    message_t a;
    load_signing_data(PAYMENT_A, &a);
    assert_int_equal(send_signing_data(&a, 250), NO_SW);

    PQ->message[a.length - 1] ^= 0x01;
    approve();
    assert_int_equal(signatures, 0);
    assert_int_equal(last_sw, SW_WRONG_DATA);
    assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0),
                     SW_NO_SIGNATURE);
}

/* After the review ends (signed or rejected), the next request is served. */
static void test_review_lock_ends_with_the_review(void** state) {
    (void)state;
    message_t a, b;
    load_signing_data(PAYMENT_A, &a);
    load_signing_data(PAYMENT_B, &b);

    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    reject();
    assert_int_equal(last_sw, SW_DENY);

    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    approve();
    assert_int_equal(last_sw, SW_OK);

    assert_int_equal(send_signing_data(&b, 250), NO_SW);
    assert_int_equal(review_screens, 3);
    approve();
    assert_int_equal(signatures, 2);
    assert_memory_equal(signed_message, b.bytes, b.length);
}

/* ------------------------------------------------- the blind-signing setting
 */

/* Not a session transaction: those are never offered for blind signing
 * (parse_tx() refuses them), whatever the setting says. */
#define BLIND_TX "blind-sign/03-nftoken-accept-offer.raw"

/* Blind signing disabled in the settings: the app must not offer to sign a
 * transaction it cannot show, exactly as review_transaction() (transaction.c)
 * does on the classical path: the error screen and 0x6985. */
static void test_blind_signing_disabled_refuses(void** state) {
    (void)state;
    test_storage.allow_blind_sign = BlindSignDisabled;
    message_t message;
    load_signing_data(BLIND_TX, &message);

    assert_int_equal(send_signing_data(&message, 250), SW_DENY);
    assert_int_equal(blind_error_screens, 1);
    assert_int_equal(blind_review_screens + review_screens, 0);
    assert_int_equal(signatures, 0);
    assert_int_equal(sign_state, IDLE);

    /* Nothing is left pending: the next request is served normally. */
    message_t a;
    load_signing_data(PAYMENT_A, &a);
    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    assert_int_equal(review_screens, 1);
}

/* Blind signing enabled: the blind review is shown and its approval signs. */
static void test_blind_signing_enabled_reviews(void** state) {
    (void)state;
    message_t message;
    load_signing_data(BLIND_TX, &message);

    assert_int_equal(send_signing_data(&message, 250), NO_SW);
    assert_int_equal(blind_review_screens, 1);
    assert_int_equal(blind_error_screens, 0);
    approve();
    assert_int_equal(last_sw, SW_OK);
    assert_int_equal(signatures, 1);
    assert_memory_equal(signed_message, message.bytes, message.length);
}

/* A clear-signed transaction does not depend on the setting. */
static void test_clear_signing_ignores_the_setting(void** state) {
    (void)state;
    test_storage.allow_blind_sign = BlindSignDisabled;
    message_t a;
    load_signing_data(PAYMENT_A, &a);
    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    assert_int_equal(review_screens, 1);
    approve();
    assert_int_equal(signatures, 1);
}

/* ------------------------------------------- session transactions and policy
 */

#define XRP_DROPS(xrp) ((uint64_t)(xrp) * 1000000ULL)
#define POLICY_MAX_CAP XRP_DROPS(50)
/* SessionCap 20 XRP and 500 XRP (tests/standalone/testcases/33-*). */
#define WITHIN_POLICY_TX "33-session-policy/01-within-policy.raw"
#define ABOVE_POLICY_TX "33-session-policy/02-above-policy.raw"

static void enable_policy(void) {
    test_storage.session_policy.enabled = 1;
    test_storage.session_policy.max_cap = POLICY_MAX_CAP;
}

/* As review_transaction() on the classical path: a session the policy
 * refuses gets the refusal screen and 0x6986 before any review. */
static void test_session_policy_refuses(void** state) {
    (void)state;
    enable_policy();
    message_t message;
    load_signing_data(ABOVE_POLICY_TX, &message);

    assert_int_equal(send_signing_data(&message, 250),
                     SW_SESSION_POLICY_REFUSED);
    assert_int_equal(policy_refusal_screens, 1);
    assert_int_equal(policy_verdict.violation, SESSION_POLICY_CAP_ABOVE);
    assert_int_equal(policy_verdict.value, XRP_DROPS(500));
    assert_int_equal(policy_verdict.limit, POLICY_MAX_CAP);
    assert_int_equal(review_screens + blind_review_screens, 0);
    assert_int_equal(signatures, 0);
    assert_int_equal(apdu(INS_PQ_GET_SIGNATURE, 0, 0, NULL, 0),
                     SW_NO_SIGNATURE);

    /* Nothing is left pending: the next request is served normally. */
    message_t a;
    load_signing_data(PAYMENT_A, &a);
    assert_int_equal(send_signing_data(&a, 250), NO_SW);
    assert_int_equal(review_screens, 1);
    approve();
    assert_int_equal(signatures, 1);
}

/* A session within the policy, or any session with the policy off, is
 * reviewed and signed as before. */
static void test_session_policy_allows(void** state) {
    (void)state;
    enable_policy();
    message_t within;
    load_signing_data(WITHIN_POLICY_TX, &within);
    assert_int_equal(send_signing_data(&within, 250), NO_SW);
    assert_int_equal(review_screens, 1);
    approve();
    assert_int_equal(last_sw, SW_OK);
    assert_memory_equal(signed_message, within.bytes, within.length);

    memset(&test_storage.session_policy, 0,
           sizeof(test_storage.session_policy));
    message_t above;
    load_signing_data(ABOVE_POLICY_TX, &above);
    assert_int_equal(send_signing_data(&above, 250), NO_SW);
    assert_int_equal(review_screens, 2);
    approve();
    assert_int_equal(signatures, 2);
    assert_int_equal(policy_refusal_screens, 0);
}

/* As handle_packet_content() on the classical path: a session transaction
 * that cannot be clear-signed gets its screen and 0x6815, whatever the
 * blind-signing setting says. */
static void test_session_never_blind_signed(void** state) {
    (void)state;
    static const char* const vectors[] = {
        /* A Permission value that is neither delegable nor granular. */
        "30-signing-session-set/06-unknown-permission.raw",
        /* A Batch that would go blind holding a session. */
        "34-session-agent-id/03-batch-session-refused.raw",
    };
    static const uint8_t settings[] = {BlindSignEnabled, BlindSignDisabled};
    for (size_t v = 0; v < sizeof(vectors) / sizeof(vectors[0]); v++) {
        for (size_t s = 0; s < sizeof(settings); s++) {
            setup(NULL);
            test_storage.allow_blind_sign = settings[s];
            message_t message;
            load_signing_data(vectors[v], &message);

            assert_int_equal(send_signing_data(&message, 250),
                             SW_SESSION_BLIND_REFUSED);
            assert_int_equal(session_blind_screens, 1);
            assert_int_equal(blind_error_screens, 0);
            assert_int_equal(review_screens + blind_review_screens, 0);
            assert_int_equal(signatures, 0);

            message_t a;
            load_signing_data(PAYMENT_A, &a);
            assert_int_equal(send_signing_data(&a, 250), NO_SW);
            assert_int_equal(review_screens, 1);
        }
    }
}

int main(void) {
    const struct CMUnitTest tests[] = {
        cmocka_unit_test_setup(test_public_key_chunks, setup),
        cmocka_unit_test_setup(test_sign_reassembles_chunks, setup),
        cmocka_unit_test_setup(test_sign_requires_prefix, setup),
        cmocka_unit_test_setup(test_sign_rejects_unparsable_data, setup),
        cmocka_unit_test_setup(test_sign_length_limit, setup),
        cmocka_unit_test_setup(test_sign_bad_p1_p2, setup),
        cmocka_unit_test_setup(test_reject_answers_deny, setup),
        cmocka_unit_test_setup(test_new_signing_data_drops_old_signature,
                               setup),
        cmocka_unit_test_setup(test_review_refuses_new_signing_data, setup),
        cmocka_unit_test_setup(test_review_refuses_partial_chunks, setup),
        cmocka_unit_test_setup(test_other_instruction_cancels_review, setup),
        cmocka_unit_test_setup(test_approval_checks_reviewed_bytes, setup),
        cmocka_unit_test_setup(test_review_lock_ends_with_the_review, setup),
        cmocka_unit_test_setup(test_blind_signing_disabled_refuses, setup),
        cmocka_unit_test_setup(test_blind_signing_enabled_reviews, setup),
        cmocka_unit_test_setup(test_clear_signing_ignores_the_setting, setup),
        cmocka_unit_test_setup(test_session_policy_refuses, setup),
        cmocka_unit_test_setup(test_session_policy_allows, setup),
        cmocka_unit_test_setup(test_session_never_blind_signed, setup),
    };
    return cmocka_run_group_tests(tests, NULL, NULL);
}
