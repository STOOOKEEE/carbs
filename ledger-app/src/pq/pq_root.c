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
 *   Spike scope: the review shows the size and a SHA-256 prefix of the signing
 *   data, not the decoded transaction (clear signing is task L1/L2).
 ********************************************************************************/

#ifdef HAVE_PQ_ROOT

#include "pq_root.h"

#include <string.h>

#include <os.h>
#include <cx.h>
#include <io.h>
#include <os_seed.h>
#include <lcx_mldsa.h>
#include <nbgl_use_case.h>

#include "../apdu/global.h"
#include "../ui/main/idle_menu.h"
#include "../ui/ui.h"

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
#define PQ_DIGEST_SHOWN  8U
#define SW_OK            0x9000
#define SW_DENY          0x6985
#define SW_WRONG_LENGTH  0x6700
#define SW_WRONG_P1P2    0x6B00
#define SW_NO_SIGNATURE  0x6982
#define SW_INTERNAL      0x6F00

/* SLIP-21 path: a leading 0x00 then the label (must match PATH_SLIP21_APP_LOAD_PARAMS). */
static const char PQ_SLIP21_LABEL[] = "\0carbs ML-DSA-44";

/* The signature stays outside tmp_ctx (which is zeroed when the instruction changes). */
static uint8_t pq_signature[MLDSA44_SIGBYTES];
static size_t pq_signature_length;
static char pq_review_text[64];

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

static void on_review_choice(bool confirm) {
    if (!confirm) {
        PQ->message_length = 0;
        nbgl_useCaseReviewStatus(STATUS_TYPE_TRANSACTION_REJECTED, display_idle_menu);
        io_send_sw(SW_DENY);
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
        nbgl_useCaseReviewStatus(STATUS_TYPE_TRANSACTION_REJECTED, display_idle_menu);
        io_send_sw(SW_INTERNAL);
        return;
    }
    pq_signature_length = signature_length;
    nbgl_useCaseReviewStatus(STATUS_TYPE_TRANSACTION_SIGNED, display_idle_menu);
    uint8_t length_be[2] = {(uint8_t) (signature_length >> 8), (uint8_t) signature_length};
    io_send_response_pointer(length_be, sizeof(length_be), SW_OK);
}

static void format_review(void) {
    static const char hex_digits[] = "0123456789ABCDEF";
    uint8_t digest[CX_SHA256_SIZE] = {0};
    char digest_hex[2 * PQ_DIGEST_SHOWN + 1] = {0};
    cx_hash_sha256(PQ->message, PQ->message_length, digest, sizeof(digest));
    for (size_t i = 0; i < PQ_DIGEST_SHOWN; i++) {
        digest_hex[2 * i] = hex_digits[digest[i] >> 4];
        digest_hex[2 * i + 1] = hex_digits[digest[i] & 0x0F];
    }
    snprintf(pq_review_text,
             sizeof(pq_review_text),
             "%u bytes\nSHA-256 %s...",
             (unsigned) PQ->message_length,
             digest_hex);
}

int handle_pq_sign(uint8_t p1, uint8_t p2, const uint8_t *data, size_t length) {
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
    format_review();
    nbgl_useCaseChoice(&ICON_APP_WARNING,
                       "Sign with the post-quantum key (ML-DSA-44)?",
                       pq_review_text,
                       "Sign",
                       "Reject",
                       on_review_choice);
    return 0;
}

int handle_pq_get_signature(uint8_t chunk_index) {
    if (pq_signature_length == 0) {
        return io_send_sw(SW_NO_SIGNATURE);
    }
    return send_chunk(pq_signature, pq_signature_length, chunk_index);
}

#endif  // HAVE_PQ_ROOT
