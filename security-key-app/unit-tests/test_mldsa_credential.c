/*
 * carbs: unit tests for src/mldsa_credential.c, the ML-DSA-44 credential keys.
 *
 * The SDK ML-DSA functions and the seed derivation are faked: they record what the code
 * under test passes them (the seed of the nonce, where the keys go, the message, the
 * context), and the test checks the derivation chain, the COSE key layout, the signature
 * call (pure ML-DSA-44, empty context) and that the seed and the secret key are wiped.
 * The real ML-DSA runs on the device only; carbs/mldsa_passkey_test.py checks its output.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "wipe_check.h"

#include "mldsa_credential.c"

static const uint8_t nonce[CREDENTIAL_NONCE_SIZE] = {0x4E, 0x01, 0x02};
static const uint8_t AKP_HEADER[] = {0xA3, 0x01, 0x07, 0x03, 0x38, 0x2F, 0x20, 0x59, 0x05, 0x20};

// What the fakes saw.
static const uint8_t *seed_nonce;
static uint8_t *seed_out;
static uint8_t keygen_seed[MLDSA_SEEDBYTES];
static uint8_t *keygen_pk;
static size_t keygen_pk_len;
static uint8_t *keygen_sk;
static size_t keygen_sk_len;
static MLDSA_param_t keygen_param;
static unsigned int keygen_calls;
static cx_err_t keygen_result;

static const uint8_t *sign_msg;
static size_t sign_msg_len;
static const uint8_t *sign_ctx;
static size_t sign_ctx_len;
static const uint8_t *sign_sk;
static size_t sign_sk_len;
static uint8_t sign_sk_first;
static MLDSA_param_t sign_param;
static unsigned int sign_calls;
static cx_err_t sign_result;
static size_t sign_length;

void crypto_generate_mldsa_seed(const uint8_t *in_nonce, uint8_t *seed) {
    seed_nonce = in_nonce;
    seed_out = seed;
    // A seed that depends on the nonce, so the test can follow it to the key generation.
    for (size_t i = 0; i < MLDSA_SEEDBYTES; i++) {
        seed[i] = (uint8_t) (in_nonce[i % CREDENTIAL_NONCE_SIZE] ^ 0xA5);
    }
}

cx_err_t MLDSA_internal_keygen(uint8_t *pk,
                               size_t pk_len,
                               uint8_t *sk,
                               size_t sk_len,
                               const uint8_t seed[MLDSA_SEEDBYTES],
                               MLDSA_param_t param) {
    keygen_calls++;
    memcpy(keygen_seed, seed, MLDSA_SEEDBYTES);
    keygen_pk = pk;
    keygen_pk_len = pk_len;
    keygen_sk = sk;
    keygen_sk_len = sk_len;
    keygen_param = param;
    memset(pk, 0x9B, pk_len);
    memset(sk, 0x5C, sk_len);
    return keygen_result;
}

cx_err_t MLDSA_sign(uint8_t *sig,
                    size_t sig_len,
                    size_t *sig_actual_len,
                    const uint8_t *msg,
                    size_t msg_len,
                    const uint8_t *ctx,
                    size_t ctx_len,
                    const uint8_t *sk,
                    size_t sk_len,
                    MLDSA_param_t param) {
    sign_calls++;
    sign_msg = msg;
    sign_msg_len = msg_len;
    sign_ctx = ctx;
    sign_ctx_len = ctx_len;
    sign_sk = sk;
    sign_sk_len = sk_len;
    sign_sk_first = sk[0];
    sign_param = param;
    memset(sig, 0x51, sig_len);
    *sig_actual_len = sign_length;
    return sign_result;
}

void setUp(void) {
    wipe_check_reset();
    seed_nonce = NULL;
    seed_out = NULL;
    memset(keygen_seed, 0, sizeof(keygen_seed));
    keygen_pk = keygen_sk = NULL;
    keygen_pk_len = keygen_sk_len = 0;
    keygen_param = MLDSA_65;
    keygen_calls = 0;
    keygen_result = CX_OK;
    sign_msg = sign_ctx = sign_sk = NULL;
    sign_msg_len = sign_ctx_len = sign_sk_len = 0;
    sign_sk_first = 0;
    sign_param = MLDSA_65;
    sign_calls = 0;
    sign_result = CX_OK;
    sign_length = MLDSA44_SIGBYTES;
}

void tearDown(void) {
}

static void assert_seed_reached_keygen(void) {
    uint8_t expected[MLDSA_SEEDBYTES];
    for (size_t i = 0; i < MLDSA_SEEDBYTES; i++) {
        expected[i] = (uint8_t) (nonce[i % CREDENTIAL_NONCE_SIZE] ^ 0xA5);
    }
    TEST_ASSERT_EQUAL_PTR(nonce, seed_nonce);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, keygen_seed, MLDSA_SEEDBYTES);
    TEST_ASSERT_EQUAL(MLDSA_44, keygen_param);
    TEST_ASSERT_EQUAL_size_t(MLDSA44_PUBLICKEYBYTES, keygen_pk_len);
    TEST_ASSERT_EQUAL_size_t(MLDSA44_SECRETKEYBYTES, keygen_sk_len);
}

static void assert_secrets_wiped(void) {
    TEST_ASSERT_TRUE_MESSAGE(wipe_check_covered(seed_out, MLDSA_SEEDBYTES), "seed not wiped");
    TEST_ASSERT_TRUE_MESSAGE(wipe_check_covered(keygen_sk, MLDSA44_SECRETKEYBYTES),
                             "secret key not wiped");
}

void test_sizes(void) {
    TEST_ASSERT_EQUAL_UINT(1312, MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE);
    TEST_ASSERT_EQUAL_UINT(2420, MLDSA_CREDENTIAL_SIGNATURE_SIZE);
    TEST_ASSERT_EQUAL_UINT(1322, MLDSA_CREDENTIAL_COSE_KEY_SIZE);
}

void test_cose_key_is_generated_in_place(void) {
    uint8_t buffer[MLDSA_CREDENTIAL_COSE_KEY_SIZE + 8];

    memset(buffer, 0xEE, sizeof(buffer));
    TEST_ASSERT_EQUAL_INT(MLDSA_CREDENTIAL_COSE_KEY_SIZE,
                          mldsa_credential_encode_cose_key(nonce, buffer, sizeof(buffer)));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(AKP_HEADER, buffer, sizeof(AKP_HEADER));
    TEST_ASSERT_EQUAL_PTR(buffer + COSE_AKP_HEADER_SIZE, keygen_pk);
    TEST_ASSERT_EACH_EQUAL_HEX8(0x9B, buffer + COSE_AKP_HEADER_SIZE, MLDSA44_PUBLICKEYBYTES);
    TEST_ASSERT_EQUAL_HEX8(0xEE, buffer[MLDSA_CREDENTIAL_COSE_KEY_SIZE]);
    assert_seed_reached_keygen();
    assert_secrets_wiped();
}

void test_cose_key_refused_without_room(void) {
    uint8_t buffer[MLDSA_CREDENTIAL_COSE_KEY_SIZE];

    TEST_ASSERT_EQUAL_INT(-1, mldsa_credential_encode_cose_key(nonce, buffer, sizeof(buffer) - 1));
    TEST_ASSERT_EQUAL_UINT(0, keygen_calls);
}

void test_cose_key_keygen_failure_wipes_the_secrets(void) {
    uint8_t buffer[MLDSA_CREDENTIAL_COSE_KEY_SIZE];

    keygen_result = CX_INTERNAL_ERROR;
    TEST_ASSERT_EQUAL_INT(-1, mldsa_credential_encode_cose_key(nonce, buffer, sizeof(buffer)));
    assert_secrets_wiped();
}

void test_sign_is_pure_mldsa44_with_empty_context(void) {
    uint8_t message[37 + 32];
    uint8_t signature[MLDSA_CREDENTIAL_SIGNATURE_SIZE];

    memset(message, 0x33, sizeof(message));
    TEST_ASSERT_EQUAL_INT(
        MLDSA_CREDENTIAL_SIGNATURE_SIZE,
        mldsa_credential_sign(nonce, message, sizeof(message), signature, sizeof(signature)));
    assert_seed_reached_keygen();
    TEST_ASSERT_EQUAL_UINT(1, sign_calls);
    TEST_ASSERT_EQUAL_PTR(message, sign_msg);
    TEST_ASSERT_EQUAL_size_t(sizeof(message), sign_msg_len);
    TEST_ASSERT_NULL(sign_ctx);
    TEST_ASSERT_EQUAL_size_t(0, sign_ctx_len);
    TEST_ASSERT_EQUAL(MLDSA_44, sign_param);
    // The secret key of the key generation is the one signing.
    TEST_ASSERT_EQUAL_PTR(keygen_sk, sign_sk);
    TEST_ASSERT_EQUAL_size_t(MLDSA44_SECRETKEYBYTES, sign_sk_len);
    TEST_ASSERT_EQUAL_HEX8(0x5C, sign_sk_first);
    // The public key went to the signature buffer, then the signature over it.
    TEST_ASSERT_EQUAL_PTR(signature, keygen_pk);
    TEST_ASSERT_EACH_EQUAL_HEX8(0x51, signature, sizeof(signature));
    assert_secrets_wiped();
}

void test_sign_refuses_a_short_signature_buffer(void) {
    uint8_t message[69] = {0};
    uint8_t signature[MLDSA_CREDENTIAL_SIGNATURE_SIZE];

    TEST_ASSERT_EQUAL_INT(
        -1,
        mldsa_credential_sign(nonce, message, sizeof(message), signature, sizeof(signature) - 1));
    TEST_ASSERT_EQUAL_UINT(0, keygen_calls);
    TEST_ASSERT_EQUAL_UINT(0, sign_calls);
}

void test_sign_failures_wipe_the_secret_key(void) {
    uint8_t message[69] = {0};
    uint8_t signature[MLDSA_CREDENTIAL_SIGNATURE_SIZE];

    sign_result = CX_INTERNAL_ERROR;
    TEST_ASSERT_EQUAL_INT(
        -1,
        mldsa_credential_sign(nonce, message, sizeof(message), signature, sizeof(signature)));
    assert_secrets_wiped();

    // The SDK leaves rejected candidates in the signature buffer: wiped too.
    TEST_ASSERT_TRUE_MESSAGE(wipe_check_covered(signature, sizeof(signature)),
                             "signature buffer not wiped on failure");

    setUp();
    sign_length = MLDSA44_SIGBYTES - 1;
    TEST_ASSERT_EQUAL_INT(
        -1,
        mldsa_credential_sign(nonce, message, sizeof(message), signature, sizeof(signature)));
    assert_secrets_wiped();

    setUp();
    keygen_result = CX_INTERNAL_ERROR;
    TEST_ASSERT_EQUAL_INT(
        -1,
        mldsa_credential_sign(nonce, message, sizeof(message), signature, sizeof(signature)));
    TEST_ASSERT_EQUAL_UINT(0, sign_calls);
    assert_secrets_wiped();
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_sizes);
    RUN_TEST(test_cose_key_is_generated_in_place);
    RUN_TEST(test_cose_key_refused_without_room);
    RUN_TEST(test_cose_key_keygen_failure_wipes_the_secrets);
    RUN_TEST(test_sign_is_pure_mldsa44_with_empty_context);
    RUN_TEST(test_sign_refuses_a_short_signature_buffer);
    RUN_TEST(test_sign_failures_wipe_the_secret_key);
    return UNITY_END();
}
