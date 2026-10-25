/*
 * carbs: unit tests for the COSE encoding of an ML-DSA-44 public key (src/cose_keys.c,
 * encode_cose_key_akp) and the byte string reservation it uses (cbor-src/cbip_encode.c,
 * cbip_reserve_byte_string).
 *
 * Expected bytes, draft-ietf-cose-dilithium (AKP key type 7, ML-DSA-44 algorithm -48, public
 * key in parameter -1), CTAP2 canonical key order 1, 3, -1:
 *   A3            map(3)
 *   01 07         kty: AKP
 *   03 38 2F      alg: -48
 *   20 59 05 20   pub: bstr(1312)
 */

#include <stdint.h>
#include <string.h>

#include "unity.h"

#include "Mocklcx_ecfp.h"

#include "cose_keys.c"

#define PK_SIZE 1312U

static const uint8_t AKP_HEADER[] = {0xA3, 0x01, 0x07, 0x03, 0x38, 0x2F, 0x20, 0x59, 0x05, 0x20};

void setUp(void) {
}

void tearDown(void) {
}

void test_akp_header_size_constant_matches_the_encoding(void) {
    TEST_ASSERT_EQUAL_UINT(sizeof(AKP_HEADER), COSE_AKP_HEADER_SIZE);
    TEST_ASSERT_EQUAL_INT(-48, COSE_ALG_ML_DSA_44);
    TEST_ASSERT_EQUAL_INT(7, COSE_KEYTYPE_AKP);
}

void test_akp_key_encoding_and_reserved_public_key(void) {
    uint8_t buffer[COSE_AKP_HEADER_SIZE + PK_SIZE + 4];
    uint8_t *publicKey = NULL;
    cbipEncoder_t encoder;

    memset(buffer, 0xEE, sizeof(buffer));
    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL_INT(0,
                          encode_cose_key_akp(&encoder, COSE_ALG_ML_DSA_44, PK_SIZE, &publicKey));
    TEST_ASSERT_FALSE(encoder.fault);
    TEST_ASSERT_EQUAL_UINT8_ARRAY(AKP_HEADER, buffer, sizeof(AKP_HEADER));
    TEST_ASSERT_EQUAL_PTR(buffer + COSE_AKP_HEADER_SIZE, publicKey);
    TEST_ASSERT_EQUAL_UINT32(COSE_AKP_HEADER_SIZE + PK_SIZE, encoder.offset);
    // The reserved bytes are left for the caller; nothing is written past them.
    TEST_ASSERT_EQUAL_HEX8(0xEE, buffer[COSE_AKP_HEADER_SIZE]);
    TEST_ASSERT_EQUAL_HEX8(0xEE, buffer[COSE_AKP_HEADER_SIZE + PK_SIZE]);

    // Filled in place, the key decodes back as a CBOR map with the three parameters.
    for (uint32_t i = 0; i < PK_SIZE; i++) {
        publicKey[i] = (uint8_t) i;
    }
    cbipDecoder_t decoder;
    cbipItem_t map, item;
    cbip_decoder_init(&decoder, buffer, encoder.offset);
    cbip_first(&decoder, &map);
    TEST_ASSERT_EQUAL(cbipMap, map.type);
    TEST_ASSERT_EQUAL_INT(3, map.value);
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_item(&decoder, &map, TAG_COSE_KTY, NULL, &item, CBIPH_TYPE_INT));
    TEST_ASSERT_EQUAL_INT(COSE_KEYTYPE_AKP, cbip_get_int(&item));
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_item(&decoder, &map, TAG_COSE_ALG, NULL, &item, CBIPH_TYPE_INT));
    TEST_ASSERT_EQUAL_INT(COSE_ALG_ML_DSA_44, cbip_get_int(&item));
    TEST_ASSERT_EQUAL_INT(
        CBIPH_STATUS_FOUND,
        cbiph_get_map_item(&decoder, &map, TAG_COSE_AKP_PUB, NULL, &item, cbipByteString));
    TEST_ASSERT_EQUAL_INT(PK_SIZE, item.value);
    TEST_ASSERT_EQUAL_PTR(publicKey, decoder.buffer + item.offset + item.headerLength);
}

// One byte short of the public key: refused, fault latched, nothing reserved.
void test_akp_key_refused_without_room_for_the_whole_key(void) {
    uint8_t buffer[COSE_AKP_HEADER_SIZE + PK_SIZE];
    uint8_t *publicKey = NULL;
    cbipEncoder_t encoder;

    cbip_encoder_init(&encoder, buffer, sizeof(buffer) - 1);
    TEST_ASSERT_EQUAL_INT(-1,
                          encode_cose_key_akp(&encoder, COSE_ALG_ML_DSA_44, PK_SIZE, &publicKey));
    TEST_ASSERT_TRUE(encoder.fault);
    TEST_ASSERT_NULL(publicKey);
    TEST_ASSERT_LESS_OR_EQUAL_UINT32(sizeof(buffer) - 1, encoder.offset);
}

// A fault left by an earlier field is not cleared by the key.
void test_akp_key_refused_after_an_earlier_fault(void) {
    uint8_t buffer[2 * (COSE_AKP_HEADER_SIZE + PK_SIZE)];
    uint8_t *publicKey = NULL;
    cbipEncoder_t encoder;

    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    encoder.fault = true;
    TEST_ASSERT_EQUAL_INT(-1,
                          encode_cose_key_akp(&encoder, COSE_ALG_ML_DSA_44, PK_SIZE, &publicKey));
    TEST_ASSERT_NULL(publicKey);
    TEST_ASSERT_EQUAL_UINT32(0, encoder.offset);
}

void test_reserve_byte_string_header_sizes(void) {
    uint8_t buffer[400];
    uint8_t *value = NULL;
    cbipEncoder_t encoder;

    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL_INT(0, cbip_reserve_byte_string(&encoder, 23, &value));
    TEST_ASSERT_EQUAL_HEX8(0x57, buffer[0]);
    TEST_ASSERT_EQUAL_PTR(buffer + 1, value);
    TEST_ASSERT_EQUAL_UINT32(24, encoder.offset);

    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL_INT(0, cbip_reserve_byte_string(&encoder, 255, &value));
    TEST_ASSERT_EQUAL_HEX8(0x58, buffer[0]);
    TEST_ASSERT_EQUAL_HEX8(0xFF, buffer[1]);
    TEST_ASSERT_EQUAL_PTR(buffer + 2, value);

    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    TEST_ASSERT_EQUAL_INT(0, cbip_reserve_byte_string(&encoder, 300, &value));
    TEST_ASSERT_EQUAL_HEX8(0x59, buffer[0]);
    TEST_ASSERT_EQUAL_HEX8(0x01, buffer[1]);
    TEST_ASSERT_EQUAL_HEX8(0x2C, buffer[2]);
    TEST_ASSERT_EQUAL_PTR(buffer + 3, value);
    TEST_ASSERT_EQUAL_UINT32(303, encoder.offset);
}

void test_reserve_byte_string_rejects_wrapped_length(void) {
    uint8_t buffer[16];
    uint8_t *value = NULL;
    cbipEncoder_t encoder;

    cbip_encoder_init(&encoder, buffer, sizeof(buffer));
    encoder.offset = 8;
    TEST_ASSERT_LESS_THAN(0, cbip_reserve_byte_string(&encoder, UINT32_MAX - 8, &value));
    TEST_ASSERT_TRUE(encoder.fault);
    TEST_ASSERT_NULL(value);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_akp_header_size_constant_matches_the_encoding);
    RUN_TEST(test_akp_key_encoding_and_reserved_public_key);
    RUN_TEST(test_akp_key_refused_without_room_for_the_whole_key);
    RUN_TEST(test_akp_key_refused_after_an_earlier_fault);
    RUN_TEST(test_reserve_byte_string_header_sizes);
    RUN_TEST(test_reserve_byte_string_rejects_wrapped_length);
    return UNITY_END();
}
