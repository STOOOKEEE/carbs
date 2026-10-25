/*
 * carbs: unit tests for the ML-DSA-44 path of src/ctap2/get_assertion/get_assertion_utils.c.
 *
 * The ML-DSA signature, the credential wrapping and the CBOR send are mocked; the CBOR
 * encoder and decoder are the real ones. The tests decode the response the authenticator
 * would send and check: the 2420-byte signature computed at the end of the response buffer
 * arrives intact behind the credential and authData (resident or not), the message signed is
 * authenticatorData || clientDataHash, the nonce is read before the credential is rewrapped,
 * an ML-DSA assertion is refused where its response cannot be sent (CTAP2 over an APDU
 * transport) and an ML-DSA credential of the allowList is skipped there, so that a later
 * classical one is used; a response that does not fit is an error, not a truncated reply;
 * and a classical assertion keeps its APDU-sized bound.
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mocklcx_ecfp.h"
#include "Mocklcx_hmac.h"
#include "Mocklcx_sha256.h"
#include "Mockconfig.h"
#include "Mockcose_keys.h"
#include "Mockcredential.h"
#include "Mockcrypto.h"
#include "Mockctap2.h"
#include "Mockctap2_utils.h"
#include "Mockmldsa_credential.h"

#include "get_assertion_utils.c"

config_t const N_u2f_real;
u2f_service_t G_io_u2f;

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

int format_hex(const uint8_t *in, size_t in_len, char *out, size_t out_len) {
    (void) in;
    (void) in_len;
    if (out_len > 0) {
        out[0] = '\0';
    }
    return 0;
}

#define CRED_ID_SIZE   100
#define NONCE_OFFSET   17
#define RK_CRED_SIZE   60
#define AUTHDATA_SIZE  37
#define ALG_BYTE_MLDSA 0x48
#define ALG_BYTE_ES256 0x07

static uint8_t cred_id[CRED_ID_SIZE];
static uint8_t client_data_hash[CX_SHA256_SIZE];
static uint8_t user_id[64];
static char rp_id[] = "example.com";

// What the mocks saw.
static uint8_t nonce_at_signing[CREDENTIAL_NONCE_SIZE];
static uint8_t message_signed[512];
static uint32_t message_signed_len;
static unsigned int sign_calls;
static int sign_result;
static int decoded_alg;
static uint32_t response_length;

static int fake_mldsa_sign(const uint8_t *nonce,
                           const uint8_t *message,
                           uint32_t messageLength,
                           uint8_t *signature,
                           uint32_t signatureLength,
                           int cmock_num_calls) {
    (void) cmock_num_calls;
    sign_calls++;
    memcpy(nonce_at_signing, nonce, CREDENTIAL_NONCE_SIZE);
    message_signed_len = messageLength;
    if (messageLength <= sizeof(message_signed)) {
        memcpy(message_signed, message, messageLength);
    }
    TEST_ASSERT_EQUAL_UINT32(MLDSA_CREDENTIAL_SIGNATURE_SIZE, signatureLength);
    memset(signature, 0x51, signatureLength);
    return sign_result;
}

// Rewrapping encrypts the credential ID in place: the nonce in it is gone afterwards.
static int fake_rewrap(const uint8_t *rpIdHash, uint8_t *credId, uint32_t credIdLen, int n) {
    (void) rpIdHash;
    (void) n;
    memset(credId, 0xCC, credIdLen);
    return (int) credIdLen;
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
    (void) nonce;
    (void) credData;
    (void) isCtap2;
    (void) alreadyResident;
    (void) n;
    TEST_ASSERT_GREATER_OR_EQUAL_UINT32(RK_CRED_SIZE, bufferLen);
    memset(buffer, 0x7A, RK_CRED_SIZE);
    return RK_CRED_SIZE;
}

static int fake_decode(credential_data_t *credData,
                       uint8_t *encodedCredential,
                       uint32_t encodedCredentialLen,
                       bool fullCredentials,
                       int n) {
    (void) encodedCredentialLen;
    (void) fullCredentials;
    (void) n;
    memset(credData, 0, sizeof(*credData));
    credData->coseAlgorithm = decoded_alg;
    // Credentials of the allowList tests carry their algorithm in their first byte.
    if (encodedCredential != NULL && encodedCredential[0] == ALG_BYTE_MLDSA) {
        credData->coseAlgorithm = COSE_ALG_ML_DSA_44;
    } else if (encodedCredential != NULL && encodedCredential[0] == ALG_BYTE_ES256) {
        credData->coseAlgorithm = COSE_ALG_ES256;
    }
    credData->userId = user_id;
    credData->userIdLen = sizeof(user_id);
    return 0;
}

static void capture_response(u2f_service_t *service, uint32_t length, const char *status, int n) {
    (void) service;
    (void) status;
    (void) n;
    response_length = length;
}

void setUp(void) {
    ctap2_assert_data_t *assert_data = globals_get_ctap2_assert_data();

    memset(assert_data, 0, sizeof(*assert_data));
    memset(responseBuffer, 0, sizeof(responseBuffer));
    for (int i = 0; i < CRED_ID_SIZE; i++) {
        cred_id[i] = (uint8_t) i;
    }
    memset(client_data_hash, 0xCD, sizeof(client_data_hash));
    memset(user_id, 0x75, sizeof(user_id));
    memset(assert_data->rpIdHash, 0xAA, CX_SHA256_SIZE);
    memcpy(assert_data->clientDataHash, client_data_hash, CX_SHA256_SIZE);
    assert_data->rpId = rp_id;
    assert_data->rpIdLen = sizeof(rp_id) - 1;
    assert_data->credId = cred_id;
    assert_data->credIdLen = CRED_ID_SIZE;
    assert_data->nonce = cred_id + NONCE_OFFSET;
    assert_data->userPresenceRequired = 1;
    assert_data->availableCredentials = 1;

    memset(nonce_at_signing, 0, sizeof(nonce_at_signing));
    memset(message_signed, 0, sizeof(message_signed));
    message_signed_len = 0;
    sign_calls = 0;
    sign_result = MLDSA_CREDENTIAL_SIGNATURE_SIZE;
    decoded_alg = COSE_ALG_ML_DSA_44;
    response_length = 0;

    mldsa_credential_sign_Stub(fake_mldsa_sign);
    credential_rewrap_in_place_Stub(fake_rewrap);
    credential_wrap_Stub(fake_wrap);
    credential_decode_Stub(fake_decode);
    config_increase_and_get_authentification_counter_IgnoreAndReturn(4);
    ctap2_send_keepalive_processing_Ignore();
}

void tearDown(void) {
    Mocklcx_ecfp_Verify();
    Mocklcx_hmac_Verify();
    Mocklcx_sha256_Verify();
    Mockconfig_Verify();
    Mockcose_keys_Verify();
    Mockcredential_Verify();
    Mockcrypto_Verify();
    Mockctap2_Verify();
    Mockctap2_utils_Verify();
    Mockmldsa_credential_Verify();
    Mocklcx_ecfp_Destroy();
    Mocklcx_hmac_Destroy();
    Mocklcx_sha256_Destroy();
    Mockconfig_Destroy();
    Mockcose_keys_Destroy();
    Mockcredential_Destroy();
    Mockcrypto_Destroy();
    Mockctap2_Destroy();
    Mockctap2_utils_Destroy();
    Mockmldsa_credential_Destroy();
}

// Decodes responseBuffer[1..1+length] and checks the fields common to every assertion.
static void check_response(uint32_t length,
                           const uint8_t *credential,
                           uint32_t credentialLength,
                           int mapSize) {
    cbipDecoder_t decoder;
    cbipItem_t map, item;
    uint8_t *bytes;
    uint32_t bytesLen;

    cbip_decoder_init(&decoder, responseBuffer + 1, length);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL(cbipMap, map.type);
    TEST_ASSERT_EQUAL_INT(mapSize, map.value);

    // 1: credential descriptor
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_item(&decoder, &map, 1, NULL, &item, cbipMap));
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_key_str_bytes(&decoder, &item, CREDENTIAL_DESCRIPTOR_ID, &bytes, &bytesLen));
    TEST_ASSERT_EQUAL_UINT32(credentialLength, bytesLen);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(credential, bytes, credentialLength);

    // 2: authenticator data, then 3: the signature over authData || clientDataHash
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_key_bytes(&decoder, &map, 2, &bytes, &bytesLen));
    TEST_ASSERT_EQUAL_UINT32(AUTHDATA_SIZE, bytesLen);
    TEST_ASSERT_EACH_EQUAL_HEX8(0xAA, bytes, CX_SHA256_SIZE);
    TEST_ASSERT_EQUAL_UINT32(AUTHDATA_SIZE + CX_SHA256_SIZE, message_signed_len);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(bytes, message_signed, AUTHDATA_SIZE);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(client_data_hash, message_signed + AUTHDATA_SIZE, CX_SHA256_SIZE);

    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_key_bytes(&decoder, &map, 3, &bytes, &bytesLen));
    TEST_ASSERT_EQUAL_UINT32(MLDSA_CREDENTIAL_SIGNATURE_SIZE, bytesLen);
    TEST_ASSERT_EACH_EQUAL_HEX8(0x51, bytes, MLDSA_CREDENTIAL_SIGNATURE_SIZE);
}

void test_mldsa_assertion_with_allow_list(void) {
    credential_data_t credData = {.coseAlgorithm = COSE_ALG_ML_DSA_44};
    uint8_t original[CRED_ID_SIZE];
    uint32_t len = 0;

    memcpy(original, cred_id, sizeof(original));
    TEST_ASSERT_EQUAL_INT(ERROR_NONE,
                          build_and_encode_getAssertion_response(responseBuffer + 1,
                                                                 sizeof(responseBuffer) - 1,
                                                                 &credData,
                                                                 &len));
    TEST_ASSERT_EQUAL_UINT(1, sign_calls);
    // Signed with the credential's nonce, read before the rewrap overwrote it.
    TEST_ASSERT_EQUAL_UINT8_ARRAY(original + NONCE_OFFSET, nonce_at_signing, CREDENTIAL_NONCE_SIZE);
    TEST_ASSERT_GREATER_THAN_UINT32(CUSTOM_IO_APDU_BUFFER_SIZE, len);
    check_response(len, cred_id, CRED_ID_SIZE, 3);
}

// A resident credential is rewrapped inside the response buffer: it must not reach the
// signature waiting at the end of the buffer, and the user entity goes after the signature.
void test_mldsa_assertion_resident_with_user(void) {
    ctap2_assert_data_t *assert_data = globals_get_ctap2_assert_data();
    credential_data_t credData = {.coseAlgorithm = COSE_ALG_ML_DSA_44,
                                  .residentKey = 1,
                                  .userId = user_id,
                                  .userIdLen = sizeof(user_id)};
    uint8_t rk_credential[RK_CRED_SIZE];
    uint32_t len = 0;

    assert_data->credId = NULL;
    assert_data->availableCredentials = 2;
    memset(rk_credential, 0x7A, sizeof(rk_credential));

    TEST_ASSERT_EQUAL_INT(ERROR_NONE,
                          build_and_encode_getAssertion_response(responseBuffer + 1,
                                                                 sizeof(responseBuffer) - 1,
                                                                 &credData,
                                                                 &len));
    TEST_ASSERT_LESS_OR_EQUAL_UINT32(sizeof(responseBuffer) - 1, len);
    check_response(len, rk_credential, RK_CRED_SIZE, 5);

    cbipDecoder_t decoder;
    cbipItem_t map, user;
    uint8_t *bytes;
    uint32_t bytesLen;
    int count;
    cbip_decoder_init(&decoder, responseBuffer + 1, len);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_item(&decoder, &map, 4, NULL, &user, cbipMap));
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_key_str_bytes(&decoder, &user, KEY_USER_ID, &bytes, &bytesLen));
    TEST_ASSERT_EQUAL_UINT8_ARRAY(user_id, bytes, sizeof(user_id));
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND, cbiph_get_map_key_int(&decoder, &map, 5, &count));
    TEST_ASSERT_EQUAL_INT(2, count);
}

// A credential ID too large to leave the signature room is refused, not encoded over it.
void test_mldsa_assertion_refuses_a_credential_reaching_the_signature(void) {
    credential_data_t credData = {.coseAlgorithm = COSE_ALG_ML_DSA_44};
    static uint8_t big_cred[1100];
    ctap2_assert_data_t *assert_data = globals_get_ctap2_assert_data();
    uint32_t len = 0;

    assert_data->credId = big_cred;
    assert_data->credIdLen = sizeof(big_cred);
    assert_data->nonce = big_cred + NONCE_OFFSET;
    TEST_ASSERT_LESS_THAN_INT(0,
                              build_and_encode_getAssertion_response(responseBuffer + 1,
                                                                     sizeof(responseBuffer) - 1,
                                                                     &credData,
                                                                     &len));
}

void test_mldsa_assertion_signature_failure(void) {
    credential_data_t credData = {.coseAlgorithm = COSE_ALG_ML_DSA_44};
    uint32_t len = 0;

    sign_result = -1;
    TEST_ASSERT_LESS_THAN_INT(0,
                              build_and_encode_getAssertion_response(responseBuffer + 1,
                                                                     sizeof(responseBuffer) - 1,
                                                                     &credData,
                                                                     &len));
}

void test_mldsa_assertion_sent_over_ctaphid(void) {
    ctap2_large_response_supported_IgnoreAndReturn(true);
    send_cbor_response_Stub(capture_response);

    get_assertion_send();
    TEST_ASSERT_EQUAL_UINT(1, sign_calls);
    TEST_ASSERT_EQUAL_HEX8(ERROR_NONE, responseBuffer[0]);
    TEST_ASSERT_GREATER_THAN_UINT32(CUSTOM_IO_APDU_BUFFER_SIZE, response_length);
    check_response(response_length - 1, cred_id, CRED_ID_SIZE, 3);
}

// CTAP2 over U2F_MSG or NFC copies the response into the APDU buffer: refused, nothing signed.
void test_mldsa_assertion_refused_over_an_apdu_transport(void) {
    ctap2_large_response_supported_IgnoreAndReturn(false);
    send_cbor_error_Expect(&G_io_u2f, ERROR_UNSUPPORTED_ALGORITHM);

    get_assertion_send();
    TEST_ASSERT_EQUAL_UINT(0, sign_calls);
}

// The classical path keeps the APDU-sized bound and its own signature.
void test_es256_assertion_unchanged(void) {
    decoded_alg = COSE_ALG_ES256;
    cose_alg_to_cx_IgnoreAndReturn(CX_CURVE_SECP256R1);
    crypto_generate_private_key_IgnoreAndReturn(0);
    cx_hash_sha256_IgnoreAndReturn(CX_SHA256_SIZE);
    crypto_sign_application_IgnoreAndReturn(70);
    send_cbor_response_Stub(capture_response);

    get_assertion_send();
    TEST_ASSERT_EQUAL_UINT(0, sign_calls);
    TEST_ASSERT_EQUAL_HEX8(ERROR_NONE, responseBuffer[0]);
    TEST_ASSERT_LESS_OR_EQUAL_UINT32(CUSTOM_IO_APDU_BUFFER_SIZE, response_length);

    cbipDecoder_t decoder;
    cbipItem_t map;
    uint8_t *bytes;
    uint32_t bytesLen;
    cbip_decoder_init(&decoder, responseBuffer + 1, response_length - 1);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL_INT(CBIPH_STATUS_FOUND,
                          cbiph_get_map_key_bytes(&decoder, &map, 3, &bytes, &bytesLen));
    TEST_ASSERT_EQUAL_UINT32(70, bytesLen);
}

// credential_unwrap / credential_extract: the encoded credential is the ID after its first byte.
static int fake_parse(const uint8_t *rpIdHash,
                      uint8_t *credId,
                      uint32_t credIdLen,
                      uint8_t **nonce,
                      uint8_t **encodedCredential,
                      uint32_t *encodedCredentialLen,
                      int n) {
    (void) rpIdHash;
    (void) n;
    *nonce = credId + 1;
    *encodedCredential = credId + 1;
    *encodedCredentialLen = credIdLen - 1;
    return 0;
}

static int fake_unwrap(const uint8_t *rpIdHash,
                       uint8_t *credId,
                       uint32_t credIdLen,
                       uint8_t **nonce,
                       uint8_t **encodedCredential,
                       uint32_t *encodedCredentialLen,
                       int n) {
    return fake_parse(rpIdHash,
                      credId,
                      credIdLen,
                      nonce,
                      encodedCredential,
                      encodedCredentialLen,
                      n);
}

static int fake_extract(const uint8_t *rpIdHash,
                        const uint8_t *credId,
                        uint32_t credIdLen,
                        uint8_t **nonce,
                        uint8_t **encodedCredential,
                        uint32_t *encodedCredentialLen,
                        int n) {
    return fake_parse(rpIdHash,
                      (uint8_t *) credId,
                      credIdLen,
                      nonce,
                      encodedCredential,
                      encodedCredentialLen,
                      n);
}

static int keep_rewrap(const uint8_t *rpIdHash, uint8_t *credId, uint32_t credIdLen, int n) {
    (void) rpIdHash;
    (void) credId;
    (void) n;
    return (int) credIdLen;
}

static uint8_t allow_request[256];
static uint8_t cred_mldsa[40];
static uint8_t cred_es256[40];

// {3 (allowList): [{"id": ML-DSA credential, "type": "public-key"}, {"id": ES256 ...}]}
static void build_allow_list_request(void) {
    cbipEncoder_t encoder;
    memset(cred_mldsa, 0x11, sizeof(cred_mldsa));
    memset(cred_es256, 0x22, sizeof(cred_es256));
    cred_mldsa[1] = ALG_BYTE_MLDSA;
    cred_es256[1] = ALG_BYTE_ES256;
    cbip_encoder_init(&encoder, allow_request, sizeof(allow_request));
    cbip_add_map_header(&encoder, 1);
    cbip_add_int(&encoder, TAG_ALLOWLIST);
    cbip_add_array_header(&encoder, 2);
    const uint8_t *creds[2] = {cred_mldsa, cred_es256};
    for (int i = 0; i < 2; i++) {
        cbip_add_map_header(&encoder, 2);
        cbip_add_string(&encoder, "id", 2);
        cbip_add_byte_string(&encoder, creds[i], sizeof(cred_mldsa));
        cbip_add_string(&encoder, "type", 4);
        cbip_add_string(&encoder, "public-key", 10);
    }
    TEST_ASSERT_FALSE(encoder.fault);
    globals_get_ctap2_assert_data()->buffer = allow_request;
}

static int allow_list_item(int index) {
    cbipDecoder_t decoder;
    cbipItem_t map, item;
    cbip_decoder_init(&decoder, allow_request, sizeof(allow_request));
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_item(&decoder, &map, TAG_ALLOWLIST, NULL, &item, cbipArray));
    cbip_next(&decoder, &item);
    for (int i = 0; i < index; i++) {
        cbiph_next_deep(&decoder, &item);
    }
    return handle_allowList_item(&decoder, &item, true);
}

// Over CTAP2 in an APDU (U2F_MSG, NFC) an ML-DSA credential of the allowList is skipped as
// unusable; an ES256 one stays valid.
void test_allow_list_skips_mldsa_over_an_apdu_transport(void) {
    build_allow_list_request();
    credential_unwrap_Stub(fake_unwrap);
    ctap2_large_response_supported_IgnoreAndReturn(false);

    TEST_ASSERT_EQUAL_INT(ERROR_INVALID_CREDENTIAL, allow_list_item(0));
    TEST_ASSERT_EQUAL_INT(ERROR_NONE, allow_list_item(1));
}

void test_allow_list_keeps_mldsa_over_ctaphid(void) {
    build_allow_list_request();
    credential_unwrap_Stub(fake_unwrap);
    ctap2_large_response_supported_IgnoreAndReturn(true);

    TEST_ASSERT_EQUAL_INT(ERROR_NONE, allow_list_item(0));
    TEST_ASSERT_EQUAL_HEX8(ALG_BYTE_MLDSA, globals_get_ctap2_assert_data()->credential[0]);
}

// The credential the login uses (the first available one) is then the ES256 one, listed
// after the ML-DSA one: the assertion is signed, with ES256, instead of failing.
void test_mixed_allow_list_uses_the_es256_credential_over_an_apdu_transport(void) {
    ctap2_assert_data_t *assert_data = globals_get_ctap2_assert_data();

    build_allow_list_request();
    assert_data->allowListPresent = 1;
    assert_data->availableCredentials = 1;
    credential_extract_Stub(fake_extract);
    ctap2_large_response_supported_IgnoreAndReturn(false);
    decoded_alg = 0;
    cose_alg_to_cx_IgnoreAndReturn(CX_CURVE_SECP256R1);
    crypto_generate_private_key_IgnoreAndReturn(0);
    cx_hash_sha256_IgnoreAndReturn(CX_SHA256_SIZE);
    crypto_sign_application_IgnoreAndReturn(70);
    send_cbor_response_Stub(capture_response);
    credential_rewrap_in_place_Stub(keep_rewrap);

    get_assertion_confirm(1);
    // The credential ID points into the request: the second entry, the ES256 credential.
    TEST_ASSERT_EQUAL_HEX8(ALG_BYTE_ES256, assert_data->credId[1]);
    TEST_ASSERT_EQUAL_UINT32(sizeof(cred_es256), assert_data->credIdLen);
    TEST_ASSERT_EQUAL_UINT(0, sign_calls);
    TEST_ASSERT_EQUAL_HEX8(ERROR_NONE, responseBuffer[0]);
    TEST_ASSERT_GREATER_THAN_UINT32(1, response_length);
}

// A resident credential whose user entity does not fit after the signature: an error, not a
// response cut after the signature.
void test_mldsa_assertion_refuses_a_user_entity_that_does_not_fit(void) {
    ctap2_assert_data_t *assert_data = globals_get_ctap2_assert_data();
    static char user_name[64];
    credential_data_t credData = {.coseAlgorithm = COSE_ALG_ML_DSA_44,
                                  .residentKey = 1,
                                  .userId = user_id,
                                  .userIdLen = sizeof(user_id),
                                  .userStr = user_name,
                                  .userStrLen = sizeof(user_name)};
    uint32_t len = 0;

    memset(user_name, 'u', sizeof(user_name));
    g.display_status = false;
    assert_data->credId = NULL;
    // Room for the credential, authData and signature, not for the user's two 64-byte names.
    TEST_ASSERT_EQUAL_INT(
        ERROR_OTHER,
        build_and_encode_getAssertion_response(responseBuffer + 1,
                                               MLDSA_CREDENTIAL_SIGNATURE_SIZE + 270,
                                               &credData,
                                               &len));
    TEST_ASSERT_EQUAL_UINT(1, sign_calls);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_mldsa_assertion_with_allow_list);
    RUN_TEST(test_mldsa_assertion_resident_with_user);
    RUN_TEST(test_mldsa_assertion_refuses_a_credential_reaching_the_signature);
    RUN_TEST(test_mldsa_assertion_signature_failure);
    RUN_TEST(test_mldsa_assertion_sent_over_ctaphid);
    RUN_TEST(test_mldsa_assertion_refused_over_an_apdu_transport);
    RUN_TEST(test_es256_assertion_unchanged);
    RUN_TEST(test_allow_list_skips_mldsa_over_an_apdu_transport);
    RUN_TEST(test_allow_list_keeps_mldsa_over_ctaphid);
    RUN_TEST(test_mixed_allow_list_uses_the_es256_credential_over_an_apdu_transport);
    RUN_TEST(test_mldsa_assertion_refuses_a_user_entity_that_does_not_fit);
    return UNITY_END();
}
