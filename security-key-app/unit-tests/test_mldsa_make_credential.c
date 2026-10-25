/*
 * carbs: unit tests for the ML-DSA-44 path of src/ctap2/make_credential/make_credential_utils.c.
 *
 * The ML-DSA key, the credential wrapping, the attestation signature and the CBOR send are
 * mocked; the CBOR encoder and decoder are the real ones. The tests decode the
 * makeCredential response and check that the authenticator data carries the COSE AKP key
 * of the credential's nonce (fresh or pre-generated for NFC), that the response may exceed
 * the APDU-sized bound, and that the nonce is wiped as for the other algorithms.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mocklcx_ecfp.h"
#include "Mocklcx_rng.h"
#include "Mocklcx_sha256.h"
#include "Mockconfig.h"
#include "Mockcose_keys.h"
#include "Mockcredential.h"
#include "Mockcrypto.h"
#include "Mockctap2_utils.h"
#include "Mockmldsa_credential.h"
#include "Mockrk_storage.h"

#include "wipe_check.h"

#include "make_credential_utils.c"

u2f_service_t G_io_u2f;
const uint8_t AAGUID[16] = {0xA9};

void performBuiltInUv(void) {
}

bool nbgl_getTextMaxLenInNbLines(nbgl_font_id_e fontId,
                                 const char *text,
                                 uint16_t maxWidth,
                                 uint16_t nbLines,
                                 uint16_t *len,
                                 bool wrapping) {
    (void) fontId;
    (void) maxWidth;
    (void) nbLines;
    (void) wrapping;
    *len = strlen(text);
    return true;
}

#define CRED_ID_SIZE 40
// rpIdHash (32) || flags (1) || signCount (4) || AAGUID (16) || credIdLen (2)
#define CRED_ID_OFFSET 55

static const uint8_t AKP_HEADER[] = {0xA3, 0x01, 0x07, 0x03, 0x38, 0x2F, 0x20, 0x59, 0x05, 0x20};
static uint8_t client_data_hash[CX_SHA256_SIZE];
static const uint8_t *wrapped_nonce;
static const uint8_t *key_nonce;
static uint8_t key_nonce_value[CREDENTIAL_NONCE_SIZE];
static int key_result;
static uint32_t response_length;
static unsigned int ec_keys;

static void fake_rng(uint8_t *buffer, size_t len, int n) {
    (void) n;
    memset(buffer, 0x4E, len);
}

static int fake_wrap(const uint8_t *rpIdHash,
                     const uint8_t *nonce,
                     credential_data_t *credData,
                     uint8_t *buffer,
                     uint32_t bufferLen,
                     bool isCtap2,
                     bool alreadyResident,
                     int n) {
    (void) rpIdHash;
    (void) isCtap2;
    (void) alreadyResident;
    (void) n;
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ML_DSA_44, credData->coseAlgorithm);
    TEST_ASSERT_GREATER_OR_EQUAL_UINT32(CRED_ID_SIZE, bufferLen);
    wrapped_nonce = nonce;
    memset(buffer, 0xC1, CRED_ID_SIZE);
    return CRED_ID_SIZE;
}

static int fake_cose_key(const uint8_t *nonce, uint8_t *buffer, uint32_t bufferLength, int n) {
    (void) n;
    key_nonce = nonce;
    memcpy(key_nonce_value, nonce, CREDENTIAL_NONCE_SIZE);
    if (key_result < 0) {
        return key_result;
    }
    TEST_ASSERT_GREATER_OR_EQUAL_UINT32(MLDSA_CREDENTIAL_COSE_KEY_SIZE, bufferLength);
    memcpy(buffer, AKP_HEADER, sizeof(AKP_HEADER));
    memset(buffer + sizeof(AKP_HEADER), 0x9B, MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE);
    return MLDSA_CREDENTIAL_COSE_KEY_SIZE;
}

static int count_ec_key(const uint8_t *nonce, cx_ecfp_private_key_t *key, cx_curve_t c, int n) {
    (void) nonce;
    (void) key;
    (void) c;
    (void) n;
    ec_keys++;
    return 0;
}

static void capture_response(u2f_service_t *service, uint32_t length, const char *status, int n) {
    (void) service;
    (void) status;
    (void) n;
    response_length = length;
}

void setUp(void) {
    memset(&shared_ctx, 0, sizeof(shared_ctx));
    memset(responseBuffer, 0, sizeof(responseBuffer));
    memset(client_data_hash, 0xCD, sizeof(client_data_hash));
    globals_get_ctap2_register_data()->coseAlgorithm = COSE_ALG_ML_DSA_44;
    globals_get_ctap2_register_data()->clientDataHash = client_data_hash;
    memset(globals_get_ctap2_register_data()->rpIdHash, 0xAA, CX_SHA256_SIZE);
    nfc_nonce_and_pubkey_ready = false;
    memset(nfc_nonce, 0, sizeof(nfc_nonce));
    wrapped_nonce = key_nonce = NULL;
    memset(key_nonce_value, 0, sizeof(key_nonce_value));
    key_result = 0;
    response_length = 0;
    ec_keys = 0;
    wipe_check_reset();

    cx_rng_no_throw_Stub(fake_rng);
    ctap2_send_keepalive_processing_Ignore();
    config_increase_and_get_authentification_counter_IgnoreAndReturn(4);
    credential_wrap_Stub(fake_wrap);
    mldsa_credential_encode_cose_key_Stub(fake_cose_key);
    cose_alg_to_cx_IgnoreAndReturn(CX_CURVE_SECP256R1);
    crypto_generate_private_key_Stub(count_ec_key);
    cx_ecfp_generate_pair_no_throw_IgnoreAndReturn(CX_OK);
    encode_cose_key_IgnoreAndReturn(0);
    cx_hash_sha256_IgnoreAndReturn(CX_SHA256_SIZE);
    crypto_sign_attestation_IgnoreAndReturn(70);
}

void tearDown(void) {
    Mocklcx_ecfp_Verify();
    Mocklcx_rng_Verify();
    Mocklcx_sha256_Verify();
    Mockconfig_Verify();
    Mockcose_keys_Verify();
    Mockcredential_Verify();
    Mockcrypto_Verify();
    Mockctap2_utils_Verify();
    Mockmldsa_credential_Verify();
    Mockrk_storage_Verify();
    Mocklcx_ecfp_Destroy();
    Mocklcx_rng_Destroy();
    Mocklcx_sha256_Destroy();
    Mockconfig_Destroy();
    Mockcose_keys_Destroy();
    Mockcredential_Destroy();
    Mockcrypto_Destroy();
    Mockctap2_utils_Destroy();
    Mockmldsa_credential_Destroy();
    Mockrk_storage_Destroy();
}

static void check_response(void) {
    cbipDecoder_t decoder;
    cbipItem_t map, att;
    uint8_t *authData;
    uint32_t authDataLen;
    int alg;

    TEST_ASSERT_EQUAL_HEX8(ERROR_NONE, responseBuffer[0]);
    TEST_ASSERT_GREATER_THAN_UINT32(CUSTOM_IO_APDU_BUFFER_SIZE, response_length);
    cbip_decoder_init(&decoder, responseBuffer + 1, response_length - 1);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL(cbipMap, map.type);
    TEST_ASSERT_EQUAL_INT(3, map.value);

    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_key_bytes(&decoder, &map, 2, &authData, &authDataLen));
    TEST_ASSERT_EQUAL_UINT32(CRED_ID_OFFSET + CRED_ID_SIZE + MLDSA_CREDENTIAL_COSE_KEY_SIZE,
                             authDataLen);
    TEST_ASSERT_EQUAL_HEX8(
        AUTHDATA_FLAG_USER_PRESENCE | AUTHDATA_FLAG_ATTESTED_CREDENTIAL_DATA_PRESENT,
        authData[32]);
    TEST_ASSERT_EQUAL_HEX8(0, authData[CRED_ID_OFFSET - 2]);
    TEST_ASSERT_EQUAL_HEX8(CRED_ID_SIZE, authData[CRED_ID_OFFSET - 1]);
    TEST_ASSERT_EACH_EQUAL_HEX8(0xC1, authData + CRED_ID_OFFSET, CRED_ID_SIZE);
    const uint8_t *coseKey = authData + CRED_ID_OFFSET + CRED_ID_SIZE;
    TEST_ASSERT_EQUAL_UINT8_ARRAY(AKP_HEADER, coseKey, sizeof(AKP_HEADER));
    TEST_ASSERT_EACH_EQUAL_HEX8(0x9B,
                                coseKey + sizeof(AKP_HEADER),
                                MLDSA_CREDENTIAL_PUBLIC_KEY_SIZE);

    // The packed attestation stays the device's ES256 attestation.
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_item(&decoder, &map, 3, NULL, &att, cbipMap));
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_key_str_int(&decoder, &att, TAG_ALGORITHM, &alg));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ES256, alg);

    // The key comes from the credential's own nonce, which is wiped afterwards.
    TEST_ASSERT_EQUAL_PTR(wrapped_nonce, key_nonce);
    TEST_ASSERT_TRUE(wipe_check_covered(key_nonce, CREDENTIAL_NONCE_SIZE));
    TEST_ASSERT_EQUAL_UINT(0, ec_keys);
}

void test_mldsa_credential(void) {
    send_cbor_response_Stub(capture_response);

    ctap2_make_credential_confirm();
    check_response();
    TEST_ASSERT_EACH_EQUAL_HEX8(0x4E, key_nonce_value, CREDENTIAL_NONCE_SIZE);
}

// The nonce pre-generated while NFC was idle may be taken by a USB makeCredential: the
// ML-DSA key is derived from it (its EC public keys are unused) and it is consumed.
void test_mldsa_credential_with_pregenerated_nonce(void) {
    static const uint8_t zero[CREDENTIAL_NONCE_SIZE] = {0};

    check_and_generate_new_pubkey();
    TEST_ASSERT_TRUE(nfc_nonce_and_pubkey_ready);
    ec_keys = 0;
    send_cbor_response_Stub(capture_response);

    ctap2_make_credential_confirm();
    check_response();
    TEST_ASSERT_EACH_EQUAL_HEX8(0x4E, key_nonce_value, CREDENTIAL_NONCE_SIZE);
    TEST_ASSERT_FALSE(nfc_nonce_and_pubkey_ready);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(zero, nfc_nonce, CREDENTIAL_NONCE_SIZE);
}

void test_mldsa_key_failure(void) {
    key_result = -1;
    send_cbor_error_Expect(&G_io_u2f, ERROR_OTHER);

    ctap2_make_credential_confirm();
    TEST_ASSERT_TRUE(wipe_check_covered(key_nonce, CREDENTIAL_NONCE_SIZE));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_mldsa_credential);
    RUN_TEST(test_mldsa_credential_with_pregenerated_nonce);
    RUN_TEST(test_mldsa_key_failure);
    return UNITY_END();
}
