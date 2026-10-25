/*******************************************************************************
 *   carbs: ML-DSA-44 root key for XRPL (alphanet KeyType::Dilithium).
 *
 *   Key derivation (deterministic, recoverable from the 24 words, FIANSO-SPEC 7.7):
 *     node = SLIP-21(seed, label "carbs ML-DSA-44")     (64 bytes: chain || key)
 *     xi   = node[32..64], the SLIP-21 key
 *     (pk, sk) = ML-DSA-44.KeyGen_internal(xi)       (FIPS 204, Algorithm 6)
 *   In HDW_SLIP21 mode the OS returns only the 32-byte key, at the start of the
 *   output buffer (Speculos src/bolos/os_bip32.c, hdw_slip21): xi is those 32
 *   bytes. An all-zero output is refused rather than used as a seed.
 *   No BIP32 secp256k1 private key is ever reused as an ML-DSA seed.
 *   The node verifies pure ML-DSA with an empty context over the full signing
 *   data (STX\0 prefix included), so the host sends exactly those bytes. The
 *   signing data embeds the 1312-byte SigningPubKey, hence the 2 KiB buffer.
 *
 *   Review: the transaction part of the signing data goes through the app's own
 *   parser, so the screen shows the decoded fields, as for a classical signature.
 *   The session policy and the never-blind rule of session transactions apply
 *   as on the classical path (review_transaction, handle_packet_content).
 ********************************************************************************/

#ifdef HAVE_PQ_ROOT

#include "pq_root.h"

#include <string.h>

#include <os.h>
#include <cx.h>
#include <io.h>
#include <os_seed.h>
#include <lcx_mldsa.h>
#include <status_words.h>

#include "global.h"
#include "sign_transaction.h"
#include "globals.h"
#include "session_policy.h"
#include "blind_signing.h"
#include "session_policy_refusal.h"
#include "review_menu.h"
#include "signing_session.h"
#include "xrp_parse.h"

/* Internal SDK header (lib_cxng/src, on the include path, see the Makefile):
 * MLDSA_internal_keygen, the deterministic key generation. */
#include <cx_mldsa_internal.h>

#define PQ_CHUNK     250U
#define PQ           (&tmp_ctx.pq_context)
#define PQ_HASH_SIZE 32U
/* os_derive_bip32_with_seed_no_throw() takes a 64-byte output buffer
 * (raw_privkey[static 64]); in HDW_SLIP21 mode it fills only the first 32. */
#define PQ_OS_KEY_BUFFER 64U
/* No signature to read (INS 0x12 before a signature, or after a new request). */
#define SW_NO_SIGNATURE SWO_SECURITY_CONDITION_NOT_SATISFIED
/* Same answer as the classical path (sign_transaction.c, handle_packet_content). */
#define SW_SESSION_BLIND_REFUSED (0x6800 | SESSION_BLIND_SIGN_REFUSED)

/* SLIP-21 path: a leading 0x00 then the label (must match PATH_SLIP21_APP_LOAD_PARAMS).
 * Aligned because the OS takes it as a const unsigned int pointer. */
static const char PQ_SLIP21_LABEL[] __attribute__((aligned(4))) = "\0carbs ML-DSA-44";

/* The signature stays outside tmp_ctx (which is zeroed when the instruction changes). */
static uint8_t pq_signature[MLDSA44_SIGBYTES];
static size_t pq_signature_length;
/* Set while the review of PQ->message is on screen. It lives outside tmp_ctx on
 * purpose: after an instruction change tmp_ctx is the new instruction's memory
 * (the classical INS_SIGN buffers raw bytes over all of it), so nothing read
 * there may decide to sign. reset_transaction_context() clears it
 * (pq_cancel_review), which is how an instruction change cancels the review. */
static bool pq_review_pending;
/* XRPL single-signature prefix (HashPrefix::txSign): "STX\0". */
static const uint8_t PQ_SIGNING_PREFIX[] = {0x53, 0x54, 0x58, 0x00};

static bool is_all_zero(const uint8_t *data, size_t length) {
    uint8_t bits = 0;
    for (size_t i = 0; i < length; i++) {
        bits |= data[i];
    }
    return bits == 0;
}

static bool derive_keypair(void) {
    uint8_t output[PQ_OS_KEY_BUFFER] = {0};
    bool ok = false;
    if (os_derive_bip32_with_seed_no_throw(HDW_SLIP21,
                                           CX_CURVE_SECP256K1,
                                           (const unsigned int *) PQ_SLIP21_LABEL,
                                           sizeof(PQ_SLIP21_LABEL) - 1,
                                           output,
                                           NULL,
                                           NULL,
                                           0) == CX_OK &&
        !is_all_zero(output, MLDSA_SEEDBYTES)) {
        /* xi = the 32-byte SLIP-21 key, at the start of the output. */
        ok = MLDSA_internal_keygen(PQ->public_key,
                                   sizeof(PQ->public_key),
                                   PQ->secret_key,
                                   sizeof(PQ->secret_key),
                                   output,
                                   MLDSA_44) == CX_OK;
    }
    explicit_bzero(output, sizeof(output));
    if (!ok) {
        explicit_bzero(PQ->public_key, sizeof(PQ->public_key));
        explicit_bzero(PQ->secret_key, sizeof(PQ->secret_key));
    }
    return ok;
}


static int send_chunk(const uint8_t *data, size_t total, uint8_t index) {
    size_t offset = (size_t) index * PQ_CHUNK;
    if (offset >= total) {
        return io_send_sw(SWO_WRONG_P1_P2);
    }
    size_t length = (total - offset < PQ_CHUNK) ? total - offset : PQ_CHUNK;
    return io_send_response_pointer(data + offset, length, SWO_SUCCESS);
}

/* INS 0x12 then answers 0x6982 until a new signature is made. */
static void drop_signature(void) {
    explicit_bzero(pq_signature, sizeof(pq_signature));
    pq_signature_length = 0;
}

void pq_cancel_review(void) {
    pq_review_pending = false;
}

int handle_pq_get_public_key(uint8_t chunk_index) {
    if (chunk_index == 0) {
        PQ->public_key_ready = derive_keypair();
        explicit_bzero(PQ->secret_key, sizeof(PQ->secret_key));
    }
    if (!PQ->public_key_ready) {
        return io_send_sw(SWO_UNKNOWN);
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

/* Called by the review screen (which then shows the signed / rejected status). */
static void on_review_result(unsigned int option) {
    if (!pq_review_pending) {
        /* The host switched instruction during the review: the request is
         * gone and tmp_ctx now belongs to the new instruction. Read nothing,
         * write nothing, answer nothing; the status page says the request was
         * cancelled instead of "signed". */
        review_menu_request_cancelled();
        return;
    }
    pq_review_pending = false;
    uint8_t hash[PQ_HASH_SIZE];
    bool unchanged = hash_message(hash) && memcmp(hash, PQ->review_hash, PQ_HASH_SIZE) == 0;
    explicit_bzero(PQ->review_hash, sizeof(PQ->review_hash));
    if (option != OPTION_SIGN) {
        PQ->message_length = 0;
        drop_signature();
        io_send_sw(SWO_CONDITIONS_NOT_SATISFIED);
        return;
    }
    if (!unchanged) {
        /* Not the bytes the user reviewed: refuse rather than sign them. */
        PQ->message_length = 0;
        drop_signature();
        io_send_sw(SWO_INCORRECT_DATA);
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
    if (error != CX_OK || signature_length == 0 || signature_length > sizeof(pq_signature)) {
        drop_signature();
        io_send_sw(SWO_UNKNOWN);
        return;
    }
    pq_signature_length = signature_length;
    uint8_t length_be[2] = {(uint8_t) (signature_length >> 8), (uint8_t) signature_length};
    io_send_response_pointer(length_be, sizeof(length_be), SWO_SUCCESS);
}

/* The host sends the full signing data: "STX\0" then the serialized transaction.
 * The transaction part goes through the app's own parser, so the screen shows the
 * decoded fields (type, amount, destination...) exactly as for a classical signature. */
static int review_signing_data(void) {
    if (PQ->message_length <= sizeof(PQ_SIGNING_PREFIX) ||
        memcmp(PQ->message, PQ_SIGNING_PREFIX, sizeof(PQ_SIGNING_PREFIX)) != 0) {
        PQ->message_length = 0;
        return io_send_sw(SWO_INCORRECT_DATA);
    }
    explicit_bzero(&parse_context, sizeof(parse_context));
    parse_context.data = PQ->message + sizeof(PQ_SIGNING_PREFIX);
    parse_context.length = PQ->message_length - sizeof(PQ_SIGNING_PREFIX);
    int result = parse_tx(&parse_context);
    if (result != 0 && result != BLIND_SIGN_REQUIRED && result != SESSION_BLIND_SIGN_REFUSED) {
        PQ->message_length = 0;
        return io_send_sw(SWO_INCORRECT_DATA);
    }
    /* As review_transaction() (transaction.c): the policy is checked before
     * any review or refusal; the refusal screen answers 0x6986 and resets
     * the context. */
    session_policy_t policy = N_storage.session_policy;
    session_policy_verdict_t verdict;
    if (!session_policy_check_transaction(&policy, &verdict)) {
        PQ->message_length = 0;
        ui_session_policy_refusal(&verdict);
        return 0;
    }
    if (result == SESSION_BLIND_SIGN_REFUSED) {
        /* Never offered for blind signing, whatever the setting says. */
        PQ->message_length = 0;
        ui_error_session_blind_signing();
        return io_send_sw(SW_SESSION_BLIND_REFUSED);
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
        return io_send_sw(SWO_UNKNOWN);
    }
    pq_review_pending = true;
    if (result == 0) {
        display_review_menu(&parse_context.result, on_review_result);
    } else {
        display_blind_signed_review(&parse_context.result, on_review_result);
    }
    return 0;
}

int handle_pq_sign(uint8_t p1, uint8_t p2, const uint8_t *data, size_t length) {
    if (pq_review_pending) {
        /* A review is on screen: same answer as the classical path in
         * PENDING_REVIEW (sign_transaction.c, handle_sign). */
        return io_send_sw(SWO_INCORRECT_DATA);
    }
    /* Any new request, accepted or not, makes the previous signature unreadable. */
    drop_signature();
    if (p1 > 1 || p2 > 1) {
        return io_send_sw(SWO_WRONG_P1_P2);
    }
    if (p1 == 0) {
        PQ->message_length = 0;
    } else if (PQ->message_length == 0) {
        /* A next chunk without a first one, as the classical path refuses
         * a subsequent packet (sign_transaction.c, handle_subsequent_packet). */
        return io_send_sw(SWO_INCORRECT_DATA);
    }
    if (PQ->message_length + length > sizeof(PQ->message)) {
        PQ->message_length = 0;
        return io_send_sw(SWO_WRONG_LENGTH);
    }
    memcpy(PQ->message + PQ->message_length, data, length);
    PQ->message_length += length;
    if (p2 == 0) {
        return io_send_sw(SWO_SUCCESS);
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
