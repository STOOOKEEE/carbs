/*
 * carbs: unit tests for the choice of ML-DSA-44 (-48) in the pubKeyCredParams of a
 * makeCredential (src/ctap2/make_credential/make_credential.c).
 *
 * The app keeps the first algorithm of the list it supports. ML-DSA-44 is supported only
 * where its response can be sent (ctap2_large_response_supported, mocked here): over USB
 * CTAPHID it is chosen in its place in the list; elsewhere it is skipped like any unknown
 * algorithm.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mockctap2_utils.h"

#include "make_credential.c"

config_t const N_u2f_real;
io_seph_app_t G_io_app;

// Not reached by the function under test.
void check_and_generate_new_pubkey(void) {
}
bool nbgl_getTextMaxLenInNbLines(nbgl_font_id_e fontId,
                                 const char *text,
                                 uint16_t maxWidth,
                                 uint16_t nbLines,
                                 uint16_t *len,
                                 bool wrapping) {
    (void) fontId;
    (void) text;
    (void) maxWidth;
    (void) nbLines;
    (void) wrapping;
    *len = 0;
    return true;
}
int ctap2_client_pin_verify_auth_token(int protocol,
                                       const uint8_t *msg,
                                       uint32_t msgLength,
                                       const uint8_t *signature,
                                       uint32_t signatureLength) {
    (void) protocol;
    (void) msg;
    (void) msgLength;
    (void) signature;
    (void) signatureLength;
    return -1;
}
void ctap2_make_credential_ux(void) {
}
void ctap2_make_credential_confirm(void) {
}
int format_hex(const uint8_t *in, size_t in_len, char *out, size_t out_len) {
    (void) in;
    (void) in_len;
    if (out_len > 0) {
        out[0] = '\0';
    }
    return 0;
}

static uint8_t request[256];

// {4: [{"alg": algs[0], "type": "public-key"}, ...]}
static void build_request(const int *algs, int count) {
    cbipEncoder_t encoder;
    cbip_encoder_init(&encoder, request, sizeof(request));
    cbip_add_map_header(&encoder, 1);
    cbip_add_int(&encoder, TAG_PUB_KEY_CRED_PARAMS);
    cbip_add_array_header(&encoder, count);
    for (int i = 0; i < count; i++) {
        cbip_add_map_header(&encoder, 2);
        cbip_add_string(&encoder, "alg", 3);
        cbip_add_int(&encoder, algs[i]);
        cbip_add_string(&encoder, "type", 4);
        cbip_add_string(&encoder, "public-key", 10);
    }
    TEST_ASSERT_FALSE(encoder.fault);
}

static int choose(const int *algs, int count) {
    cbipDecoder_t decoder;
    cbipItem_t map;

    build_request(algs, count);
    cbip_decoder_init(&decoder, request, sizeof(request));
    cbip_first(&decoder, &map);
    return process_makeCred_authnr_keyCredParams(&decoder, &map);
}

void setUp(void) {
    memset(&shared_ctx, 0, sizeof(shared_ctx));
}

void tearDown(void) {
    Mockctap2_utils_Verify();
    Mockctap2_utils_Destroy();
}

void test_mldsa_first_is_chosen_over_ctaphid(void) {
    const int algs[] = {COSE_ALG_ML_DSA_44, COSE_ALG_ES256};
    ctap2_large_response_supported_IgnoreAndReturn(true);

    TEST_ASSERT_EQUAL_INT(0, choose(algs, 2));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ML_DSA_44, globals_get_ctap2_register_data()->coseAlgorithm);
}

void test_list_order_is_kept(void) {
    const int algs[] = {COSE_ALG_ES256, COSE_ALG_ML_DSA_44};
    ctap2_large_response_supported_IgnoreAndReturn(true);

    TEST_ASSERT_EQUAL_INT(0, choose(algs, 2));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ES256, globals_get_ctap2_register_data()->coseAlgorithm);
}

void test_mldsa_skipped_over_an_apdu_transport(void) {
    const int algs[] = {COSE_ALG_ML_DSA_44, COSE_ALG_ES256};
    ctap2_large_response_supported_IgnoreAndReturn(false);

    TEST_ASSERT_EQUAL_INT(0, choose(algs, 2));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ES256, globals_get_ctap2_register_data()->coseAlgorithm);
}

void test_mldsa_only_is_unsupported_over_an_apdu_transport(void) {
    const int algs[] = {COSE_ALG_ML_DSA_44};
    ctap2_large_response_supported_IgnoreAndReturn(false);

    TEST_ASSERT_EQUAL_INT(ERROR_UNSUPPORTED_ALGORITHM, choose(algs, 1));
}

void test_mldsa_only_over_ctaphid(void) {
    const int algs[] = {COSE_ALG_ML_DSA_44};
    ctap2_large_response_supported_IgnoreAndReturn(true);

    TEST_ASSERT_EQUAL_INT(0, choose(algs, 1));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ML_DSA_44, globals_get_ctap2_register_data()->coseAlgorithm);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_mldsa_first_is_chosen_over_ctaphid);
    RUN_TEST(test_list_order_is_kept);
    RUN_TEST(test_mldsa_skipped_over_an_apdu_transport);
    RUN_TEST(test_mldsa_only_is_unsupported_over_an_apdu_transport);
    RUN_TEST(test_mldsa_only_over_ctaphid);
    return UNITY_END();
}
