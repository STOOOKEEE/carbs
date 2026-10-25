/*
 * carbs: unit tests for crypto_generate_mldsa_seed (src/crypto.c), the ML-DSA-44 seed of a
 * credential: SHA256((3 << 128 | nonce) || privateKeySeed).
 *
 * The hash is mocked: it records the blocks hashed, so the test checks the role byte (3, not
 * the ECDSA key's 0 or credRandom's 1 and 2), the nonce, the device's privateKeySeed, and
 * that the block holding the nonce is wiped.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mocklcx_ecfp.h"
#include "Mocklcx_hash.h"
#include "Mocklcx_sha256.h"
#include "Mockledger_assert_internals.h"

#include "wipe_check.h"

#include "crypto.c"

config_t const N_u2f_real;

// Signing is not under test here.
cx_err_t cx_ecdomain_parameters_length(cx_curve_t cv, size_t *length) {
    (void) cv;
    *length = 32;
    return CX_OK;
}

cx_err_t cx_ecdsa_sign_no_throw(const cx_ecfp_private_key_t *pvkey,
                                uint32_t mode,
                                cx_md_t hashID,
                                const uint8_t *hash,
                                size_t hash_len,
                                uint8_t *sig,
                                size_t *sig_len,
                                uint32_t *info) {
    (void) pvkey;
    (void) mode;
    (void) hashID;
    (void) hash;
    (void) hash_len;
    (void) sig;
    (void) sig_len;
    (void) info;
    return CX_OK;
}

cx_err_t cx_eddsa_sign_no_throw(const cx_ecfp_private_key_t *pvkey,
                                cx_md_t hashID,
                                const uint8_t *hash,
                                size_t hash_len,
                                uint8_t *sig,
                                size_t sig_len) {
    (void) pvkey;
    (void) hashID;
    (void) hash;
    (void) hash_len;
    (void) sig;
    (void) sig_len;
    return CX_OK;
}

static const uint8_t nonce[CREDENTIAL_NONCE_SIZE] = {0x4E,
                                                     0x01,
                                                     0x02,
                                                     0x03,
                                                     0x04,
                                                     0x05,
                                                     0x06,
                                                     0x07,
                                                     0x08,
                                                     0x09,
                                                     0x0A,
                                                     0x0B,
                                                     0x0C,
                                                     0x0D,
                                                     0x0E,
                                                     0x0F};

static uint8_t first_block[32];
static size_t first_len;
static const uint8_t *first_ptr;
static const uint8_t *second_ptr;
static size_t second_len;
static unsigned int hash_calls;

static cx_err_t capture_hash(cx_hash_t *hash,
                             uint32_t mode,
                             const uint8_t *in,
                             size_t len,
                             uint8_t *out,
                             size_t out_len,
                             int cmock_num_calls) {
    (void) hash;
    (void) mode;
    (void) cmock_num_calls;
    if (hash_calls == 0) {
        first_ptr = in;
        first_len = len;
        memcpy(first_block, in, len < sizeof(first_block) ? len : sizeof(first_block));
    } else if (hash_calls == 1) {
        second_ptr = in;
        second_len = len;
    }
    hash_calls++;
    if (out) {
        memset(out, 0xA5, out_len);
    }
    return CX_OK;
}

void setUp(void) {
    wipe_check_reset();
    memset(first_block, 0, sizeof(first_block));
    first_len = second_len = 0;
    first_ptr = second_ptr = NULL;
    hash_calls = 0;
    cx_sha256_init_no_throw_IgnoreAndReturn(CX_OK);
    cx_hash_no_throw_Stub(capture_hash);
}

void tearDown(void) {
}

void test_mldsa_seed_derivation(void) {
    uint8_t expected[32] = {0};
    uint8_t seed[32] = {0};

    expected[15] = 3;
    memcpy(expected + 16, nonce, CREDENTIAL_NONCE_SIZE);

    crypto_generate_mldsa_seed(nonce, seed);
    TEST_ASSERT_EQUAL_UINT(2, hash_calls);
    TEST_ASSERT_EQUAL_size_t(32, first_len);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(expected, first_block, 32);
    TEST_ASSERT_EQUAL_PTR((const uint8_t *) N_u2f.privateKeySeed, second_ptr);
    TEST_ASSERT_EQUAL_size_t(sizeof(N_u2f.privateKeySeed), second_len);
    TEST_ASSERT_EACH_EQUAL_HEX8(0xA5, seed, 32);
    TEST_ASSERT_TRUE(wipe_check_covered(first_ptr, 32));
}

// The ECDSA private key of the same nonce hashes role 0: the two never coincide.
void test_mldsa_seed_role_differs_from_the_ecdsa_key(void) {
    cx_ecfp_private_key_t private_key;
    uint8_t seed[32];
    uint8_t mldsa_block[32];

    crypto_generate_mldsa_seed(nonce, seed);
    memcpy(mldsa_block, first_block, sizeof(mldsa_block));

    setUp();
    cx_ecfp_init_private_key_no_throw_IgnoreAndReturn(CX_OK);
    TEST_ASSERT_EQUAL_INT(0, crypto_generate_private_key(nonce, &private_key, CX_CURVE_SECP256R1));
    TEST_ASSERT_EQUAL_HEX8(0, first_block[15]);
    TEST_ASSERT_EQUAL_HEX8(3, mldsa_block[15]);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(mldsa_block + 16, first_block + 16, CREDENTIAL_NONCE_SIZE);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_mldsa_seed_derivation);
    RUN_TEST(test_mldsa_seed_role_differs_from_the_ecdsa_key);
    return UNITY_END();
}
