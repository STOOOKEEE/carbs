/*
 * carbs: unit tests for the algorithms member (0x0A) of authenticatorGetInfo
 * (src/ctap2/get_info.c), built with HAVE_MLDSA_CREDENTIALS.
 *
 * The response is decoded with the real CBOR code: ML-DSA-44 (-48) is listed after the three
 * classical algorithms where makeCredential accepts it (USB CTAPHID), and not elsewhere.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mockconfig.h"
#include "Mockctap2_utils.h"

#include "get_info.c"
#include "cbip_helper.h"

config_t const N_u2f_real;
const uint8_t AAGUID[16] = {0xA9};

static uint32_t response_length;

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

static void capture_response(u2f_service_t *service, uint32_t length, const char *status, int n) {
    (void) service;
    (void) status;
    (void) n;
    response_length = length;
}

void setUp(void) {
    memset(responseBuffer, 0, sizeof(responseBuffer));
    response_length = 0;
    config_get_rk_enabled_IgnoreAndReturn(false);
    send_cbor_response_Stub(capture_response);
}

void tearDown(void) {
    Mockconfig_Verify();
    Mockctap2_utils_Verify();
    Mockconfig_Destroy();
    Mockctap2_utils_Destroy();
}

static void check_algorithms(const int *expected, int count) {
    cbipDecoder_t decoder;
    cbipItem_t map, item;
    int alg;

    TEST_ASSERT_EQUAL_HEX8(ERROR_NONE, responseBuffer[0]);
    cbip_decoder_init(&decoder, responseBuffer + 1, response_length - 1);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL(cbipMap, map.type);
    TEST_ASSERT_EQUAL_INT(7, map.value);
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_item(&decoder, &map, TAG_ALGORITHMS, NULL, &item, cbipArray));
    TEST_ASSERT_EQUAL_INT(count, item.value);
    for (int i = 0; i < count; i++) {
        if (i == 0) {
            cbip_next(&decoder, &item);
        } else {
            cbiph_next_deep(&decoder, &item);
        }
        TEST_ASSERT_EQUAL(cbipMap, item.type);
        TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                              cbiph_get_map_key_str_int(&decoder, &item, "alg", &alg));
        TEST_ASSERT_EQUAL_INT(expected[i], alg);
        TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND, cbiph_check_credential(&decoder, &item));
    }
}

void test_get_info_lists_mldsa_over_ctaphid(void) {
    const int expected[] = {COSE_ALG_ES256, COSE_ALG_EDDSA, COSE_ALG_ES256K, COSE_ALG_ML_DSA_44};
    ctap2_large_response_supported_IgnoreAndReturn(true);

    ctap2_get_info_handle(NULL, NULL, 0);
    check_algorithms(expected, 4);
}

void test_get_info_omits_mldsa_over_an_apdu_transport(void) {
    const int expected[] = {COSE_ALG_ES256, COSE_ALG_EDDSA, COSE_ALG_ES256K};
    ctap2_large_response_supported_IgnoreAndReturn(false);

    ctap2_get_info_handle(NULL, NULL, 0);
    check_algorithms(expected, 3);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_get_info_lists_mldsa_over_ctaphid);
    RUN_TEST(test_get_info_omits_mldsa_over_an_apdu_transport);
    return UNITY_END();
}
