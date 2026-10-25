/*******************************************************************************
 *   carbs: ML-DSA-44 root key for XRPL (alphanet KeyType::Dilithium).
 *
 *   Key derivation (deterministic, recoverable from the 24 words, FIANSO-SPEC 7.7):
 *     node = SLIP-21(seed, label "carbs ML-DSA-44")     (64 bytes: chain || key)
 *     xi   = node[32..64]
 *     (pk, sk) = ML-DSA-44.KeyGen_internal(xi)       (FIPS 204, Algorithm 6)
 *   No BIP32 secp256k1 private key is ever reused as an ML-DSA seed.
 *   The node verifies pure ML-DSA with an empty context over the full signing
 *   data (STX\0 prefix included), so the host sends exactly those bytes. The
 *   signing data embeds the 1312-byte SigningPubKey, hence the 2 KiB buffer.
 *
 *   Review: the transaction part of the signing data goes through the app's own
 *   parser, so the screen shows the decoded fields, as for a classical signature.
 ********************************************************************************/

#ifdef HAVE_PQ_ROOT

#include "pq_root.h"

#include <string.h>

#include <os.h>
#include <cx.h>
#include <io.h>
#include <os_seed.h>
#include <lcx_mldsa.h>

#include "../apdu/global.h"
#include "../apdu/messages/sign_transaction.h"
#include "../globals.h"
#include "../ui/other/blind_signing.h"
#include "../ui/transaction/review_menu.h"
#include "../xrp/xrp_parse.h"

/* Internal SDK function (lib_cxng/src/cx_mldsa_internal.h): deterministic key generation. */
cx_err_t MLDSA_internal_keygen(uint8_t *pk,
                               size_t pk_len,
                               uint8_t *sk,
                               size_t sk_len,
                               const uint8_t seed[MLDSA_SEEDBYTES],
                               MLDSA_param_t param);

#define PQ_CHUNK         250U
#define PQ (&tmp_ctx.pq_context)
#define PQ_SLIP21_NODE   64U
#define PQ_SLIP21_KEY    32U
#define SW_WRONG_DATA    0x6A80
#define SW_OK            0x9000
#define SW_DENY          0x6985
#define SW_WRONG_LENGTH  0x6700
#define SW_WRONG_P1P2    0x6B00
#define SW_NO_SIGNATURE  0x6982
#define SW_INTERNAL      0x6F00
#define PQ_HASH_SIZE     32U

/* SLIP-21 path: a leading 0x00 then the label (must match PATH_SLIP21_APP_LOAD_PARAMS). */
static const char PQ_SLIP21_LABEL[] = "\0carbs ML-DSA-44";

/* The signature stays outside tmp_ctx (which is zeroed when the instruction changes). */
static uint8_t pq_signature[MLDSA44_SIGBYTES];
static size_t pq_signature_length;
/* XRPL single-signature prefix (HashPrefix::txSign): "STX\0". */
static const uint8_t PQ_SIGNING_PREFIX[] = {0x53, 0x54, 0x58, 0x00};

static bool derive_keypair(void) {
    uint8_t node[PQ_SLIP21_NODE] = {0};
    bool ok = false;
    if (os_derive_bip32_with_seed_no_throw(HDW_SLIP21,
                                           CX_CURVE_SECP256K1,
                                           (const unsigned int *) PQ_SLIP21_LABEL,
                                           sizeof(PQ_SLIP21_LABEL) - 1,
                                           node,
                                           NULL,
                                           NULL,
                                           0) == CX_OK) {
        ok = MLDSA_internal_keygen(PQ->public_key,
                                   sizeof(PQ->public_key),
                                   PQ->secret_key,
                                   sizeof(PQ->secret_key),
                                   node + PQ_SLIP21_NODE - PQ_SLIP21_KEY,
                                   MLDSA_44) == CX_OK;
    }
    explicit_bzero(node, sizeof(node));
    return ok;
}

static int send_chunk(const uint8_t *data, size_t total, uint8_t index) {
    size_t offset = (size_t) index * PQ_CHUNK;
    if (offset >= total) {
        return io_send_sw(SW_WRONG_P1P2);
    }
    size_t length = (total - offset < PQ_CHUNK) ? total - offset : PQ_CHUNK;
    return io_send_response_pointer(data + offset, length, SW_OK);
}

int handle_pq_get_public_key(uint8_t chunk_index) {
    if (chunk_index == 0) {
        PQ->public_key_ready = derive_keypair();
        explicit_bzero(PQ->secret_key, sizeof(PQ->secret_key));
    }
    if (!PQ->public_key_ready) {
        return io_send_sw(SW_INTERNAL);
    }
    return send_chunk(PQ->public_key, sizeof(PQ->public_key), chunk_index);
}

static bool hash_message(uint8_t hash[PQ_HASH_SIZE]) {
    cx_sha256_t context;
    cx_sha256_init(&context);
    return cx_hash_no_throw(&context.header,
                            CX_LAST,
                            PQ->message,
                            PQ->message_length,
                            hash,
                            PQ_HASH_SIZE) == CX_OK;
}

/* Called by the review screen (which also shows the signed / rejected status). */
static void on_review_result(unsigned int option) {
    if (!PQ->reviewing) {
        /* The host switched instruction during the review: entry.c reset the
         * context and that request is gone. Sign nothing, answer nothing, as
         * sign_transaction() does outside PENDING_REVIEW. */
        PQ->message_length = 0;
        return;
    }
    PQ->reviewing = false;
    uint8_t hash[PQ_HASH_SIZE];
    bool unchanged = hash_message(hash) && memcmp(hash, PQ->review_hash, PQ_HASH_SIZE) == 0;
    explicit_bzero(PQ->review_hash, sizeof(PQ->review_hash));
    if (option != OPTION_SIGN) {
        PQ->message_length = 0;
        io_send_sw(SW_DENY);
        return;
    }
    if (!unchanged) {
        /* Not the bytes the user reviewed: refuse rather than sign them. */
        PQ->message_length = 0;
        io_send_sw(SW_WRONG_DATA);
        return;
    }
    size_t signature_length = 0;
    cx_err_t error = CX_INTERNAL_ERROR;
    if (derive_keypair()) {
        error = MLDSA_sign(pq_signature,
                           sizeof(pq_signature),
                           &signature_length,
                           PQ->message,
                           PQ->message_length,
                           NULL,
                           0,
                           PQ->secret_key,
                           sizeof(PQ->secret_key),
                           MLDSA_44);
    }
    explicit_bzero(PQ->secret_key, sizeof(PQ->secret_key));
    PQ->message_length = 0;
    if (error != CX_OK) {
        pq_signature_length = 0;
        io_send_sw(SW_INTERNAL);
        return;
    }
    pq_signature_length = signature_length;
    uint8_t length_be[2] = {(uint8_t) (signature_length >> 8), (uint8_t) signature_length};
    io_send_response_pointer(length_be, sizeof(length_be), SW_OK);
}

/* The host sends the full signing data: "STX\0" then the serialized transaction.
 * The transaction part goes through the app's own parser, so the screen shows the
 * decoded fields (type, amount, destination...) exactly as for a classical signature. */
static int review_signing_data(void) {
    if (PQ->message_length <= sizeof(PQ_SIGNING_PREFIX) ||
        memcmp(PQ->message, PQ_SIGNING_PREFIX, sizeof(PQ_SIGNING_PREFIX)) != 0) {
        PQ->message_length = 0;
        return io_send_sw(SW_WRONG_DATA);
    }
    explicit_bzero(&parse_context, sizeof(parse_context));
    parse_context.data = PQ->message + sizeof(PQ_SIGNING_PREFIX);
    parse_context.length = PQ->message_length - sizeof(PQ_SIGNING_PREFIX);
    int result = parse_tx(&parse_context);
    if (result != 0 && result != BLIND_SIGN_REQUIRED) {
        PQ->message_length = 0;
        return io_send_sw(SW_WRONG_DATA);
    }
    if (result == BLIND_SIGN_REQUIRED && N_storage.allow_blind_sign == BlindSignDisabled) {
        /* As review_transaction() (transaction.c): the error screen, whose
         * reject_transaction() answers 0x6985 and resets the context. It
         * answers only in PENDING_REVIEW, which this request now is. */
        PQ->message_length = 0;
        sign_state = PENDING_REVIEW;
        return ui_error_blind_signing();
    }
    /* From here until on_review_result, the buffer is frozen: handle_pq_sign
     * refuses every chunk, and the approval checks this hash. */
    if (!hash_message(PQ->review_hash)) {
        PQ->message_length = 0;
        return io_send_sw(SW_INTERNAL);
    }
    PQ->reviewing = true;
    if (result == 0) {
        display_review_menu(&parse_context.result, on_review_result);
    } else {
        display_blind_signed_review(&parse_context.result, on_review_result);
    }
    return 0;
}

int handle_pq_sign(uint8_t p1, uint8_t p2, const uint8_t *data, size_t length) {
    if (PQ->reviewing) {
        /* A review is on screen: same answer as the classical path in
         * PENDING_REVIEW (sign_transaction.c, handle_sign). */
        return io_send_sw(SW_WRONG_DATA);
    }
    if (p1 > 1 || p2 > 1) {
        return io_send_sw(SW_WRONG_P1P2);
    }
    if (p1 == 0) {
        PQ->message_length = 0;
        pq_signature_length = 0;
    }
    if (PQ->message_length + length > sizeof(PQ->message)) {
        PQ->message_length = 0;
        return io_send_sw(SW_WRONG_LENGTH);
    }
    memcpy(PQ->message + PQ->message_length, data, length);
    PQ->message_length += length;
    if (p2 == 0) {
        return io_send_sw(SW_OK);
    }
    return review_signing_data();
}

int handle_pq_get_signature(uint8_t chunk_index) {
    if (pq_signature_length == 0) {
        return io_send_sw(SW_NO_SIGNATURE);
    }
    return send_chunk(pq_signature, pq_signature_length, chunk_index);
}

#endif  // HAVE_PQ_ROOT
