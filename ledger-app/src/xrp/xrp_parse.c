/*******************************************************************************
 *   XRP Wallet
 *   (c) 2017 Ledger
 *   (c) 2020 Towo Labs
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ********************************************************************************/

#include "xrp_parse.h"

#include <string.h>

#include "amount.h"
#include "array.h"
#include "field_sort.h"
#include "fields.h"
#include "flags.h"
#include "globals.h"
#include "readers.h"
#include "session_permissions.h"
#include "transaction_types.h"
#include "xrp_helpers.h"

#define SUCCESS 0
#define CHECK(x)                  \
    do {                          \
        err = x;                  \
        if (err.err != SUCCESS) { \
            return err;           \
        }                         \
    } while (0)

static bool has_data(parseContext_t* context, uint32_t num_bytes) {
    return context->offset + num_bytes - 1 < context->length;
}

static bool has_field(parseContext_t* context, field_type_t data_type,
                      uint8_t id, bool top_level_only) {
    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        // Same type and id as what we're looking for.
        bool type_and_id_match =
            field->data_type == data_type && field->id == id;
        // If top-level-only is requested, the field must sit outside any
        // array/object; otherwise any nesting level is fine.
        bool level_matches =
            top_level_only ? field->array_info.type == ARRAY_NONE : true;

        if (type_and_id_match && level_matches) {
            return true;
        }
    }

    return false;
}

// Finds the top-level Flags field, if any, and outputs its value. Run only
// after the whole transaction is parsed, since the byte stream can present
// Flags before TransactionType, and the known-bits check below needs the
// transaction type to already be resolved.
//
// Checks both array_info.type and object_depth to rule out any nesting.
// Also flags a second top-level Flags field via *duplicate, instead of
// silently keeping whichever one was seen first.
static bool find_top_level_flags_value(parseContext_t* context, uint32_t* value,
                                       bool* duplicate) {
    bool found = false;
    *duplicate = false;

    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        if (field->data_type == STI_UINT32 && field->id == XRP_UINT32_FLAGS &&
            field->array_info.type == ARRAY_NONE && field->object_depth == 0) {
            if (found) {
                *duplicate = true;
                return true;
            }
            *value = field->data.u32;
            found = true;
        }
    }

    return found;
}

static bool is_supported_transaction_type(uint16_t t) {
    switch (t) {
        case TRANSACTION_PAYMENT:
        case TRANSACTION_ESCROW_CREATE:
        case TRANSACTION_ESCROW_FINISH:
        case TRANSACTION_ACCOUNT_SET:
        case TRANSACTION_ESCROW_CANCEL:
        case TRANSACTION_SET_REGULAR_KEY:
        case TRANSACTION_OFFER_CREATE:
        case TRANSACTION_OFFER_CANCEL:
        case TRANSACTION_TICKET_CREATE:
        case TRANSACTION_TICKET_CANCEL:
        case TRANSACTION_SIGNER_LIST_SET:
        case TRANSACTION_PAYMENT_CHANNEL_CREATE:
        case TRANSACTION_PAYMENT_CHANNEL_FUND:
        case TRANSACTION_PAYMENT_CHANNEL_CLAIM:
        case TRANSACTION_CHECK_CREATE:
        case TRANSACTION_CHECK_CASH:
        case TRANSACTION_CHECK_CANCEL:
        case TRANSACTION_DEPOSIT_PREAUTH:
        case TRANSACTION_TRUST_SET:
        case TRANSACTION_ACCOUNT_DELETE:
        case TRANSACTION_NFTOKEN_MINT:
        case TRANSACTION_NFTOKEN_BURN:
        case TRANSACTION_NFTOKEN_CREATE_OFFER:
        case TRANSACTION_NFTOKEN_CANCEL_OFFER:
        case TRANSACTION_CLAWBACK:
        case TRANSACTION_AMM_CREATE:
        case TRANSACTION_AMM_DEPOSIT:
        case TRANSACTION_AMM_WITHDRAW:
        case TRANSACTION_AMM_VOTE:
        case TRANSACTION_AMM_BID:
        case TRANSACTION_AMM_DELETE:
        case TRANSACTION_SIGNING_SESSION_SET:
        case TRANSACTION_SIGNING_SESSION_DELETE:
        case TRANSACTION_BATCH:
            return true;
        default:
            return false;
    }
}

// Inner transactions a Batch review can show (FIANSO-SPEC 7.4): the ones
// carbs batches. Any other inner type sends the whole Batch to blind signing.
static bool is_supported_batch_inner_type(uint16_t t) {
    switch (t) {
        case TRANSACTION_PAYMENT:
        case TRANSACTION_ACCOUNT_SET:
        case TRANSACTION_SET_REGULAR_KEY:
        case TRANSACTION_SIGNING_SESSION_SET:
        case TRANSACTION_SIGNING_SESSION_DELETE:
            return true;
        default:
            return false;
    }
}

uint8_t* current_position(parseContext_t* context) {
    return context->data + context->offset;
}

typedef struct err_s {
    int err;
} err_t;

// A Batch too long to show in full is still a valid transaction: offer it
// for blind signing instead of refusing it.
static err_t out_of_space(parseContext_t* context) {
    err_t err;
    err.err = context->transaction_type == TRANSACTION_BATCH
                  ? BLIND_SIGN_REQUIRED
                  : NOT_ENOUGH_SPACE;
    return err;
}

// The inner transaction of the Batch being parsed that this field sits in
// (directly inside its RawTransaction object), or NULL.
static batchInnerTx_t* batch_inner_tx(parseContext_t* context,
                                      const field_t* field) {
    uint8_t index = field->array_info.index1;

    if (context->transaction_type != TRANSACTION_BATCH ||
        field->array_info.type != XRP_STARRAY_RAW_TRANSACTIONS ||
        field->object_depth != 1 || index < 1 ||
        index > context->batch.inner_count) {
        return NULL;
    }

    return &context->batch.inner[index - 1];
}

err_t advance_position(parseContext_t* context, uint32_t num_bytes) {
    err_t err;

    if (has_data(context, num_bytes)) {
        context->offset += num_bytes;
        err.err = SUCCESS;
    } else {
        err.err = EXCEPTION_OVERFLOW;
    }

    return err;
}

err_t read_next_byte(parseContext_t* context, uint8_t* result) {
    err_t err;

    if (has_data(context, 1)) {
        *result = *current_position(context);
        err = advance_position(context, 1);
    } else {
        err.err = EXCEPTION_OVERFLOW;
    }

    return err;
}

err_t peak_next_byte(parseContext_t* context, uint8_t* result) {
    err_t err;

    if (has_data(context, 1)) {
        *result = *current_position(context);
        err.err = SUCCESS;
    } else {
        err.err = EXCEPTION_OVERFLOW;
    }

    return err;
}

void append_array_info(parseContext_t* context, field_t* field) {
    if (context->current_array != 0) {
        field->array_info.type = context->current_array;
        field->array_info.index1 = context->array_index1;
        field->array_info.index2 = context->array_index2;
    }
}

err_t append_new_field(parseContext_t* context, field_t** field) {
    err_t err;

    if (context->result.num_fields >= MAX_FIELD_COUNT) {
        return out_of_space(context);
    }

    *field = &context->result.fields[context->result.num_fields++];
    append_array_info(context, *field);
    (*field)->object_depth = context->object_depth;

    err.err = SUCCESS;
    return err;
}

err_t remove_last_field(parseContext_t* context, field_t* last_field) {
    err_t err;

    if (context->result.num_fields == 0) {
        err.err = INVALID_STATE;
        return err;
    }

    // Verify that the last field in the array corresponds to the field that we
    // are supposed to remove.
    if (&context->result.fields[context->result.num_fields - 1] != last_field) {
        err.err = INVALID_STATE;
        return err;
    }

    // Make sure that all data is cleared so that we don't end up with
    // an unexpected state later on.
    memset(last_field, 0, sizeof(field_t));
    context->result.num_fields--;

    err.err = SUCCESS;
    return err;
}

err_t read_fixed_size_field(parseContext_t* context, field_t* field,
                            uint16_t length) {
    field->data.ptr = current_position(context);
    field->length = length;

    return advance_position(context, length);
}

static err_t read_vl_length(parseContext_t* context, uint16_t* data_length) {
    uint8_t value;
    err_t err;

    *data_length = 0;

    CHECK(read_next_byte(context, &value));

    *data_length = value;
    if (*data_length > 192) {
        if (*data_length > 240) {
            // It is impossible to send a transaction large enough to
            // hold a field with a length of 12481 or greater, so we
            // should never reach this point with a valid transaction
            err.err = INVALID_STATE;
            return err;
        }

        uint8_t length_byte2;
        CHECK(read_next_byte(context, &length_byte2));
        *data_length = 193 + ((*data_length - 193) * 256) + length_byte2;
    }

    err.err = SUCCESS;
    return err;
}

err_t read_variable_length_field(parseContext_t* context, field_t* field) {
    uint16_t data_length;
    err_t err;

    CHECK(read_vl_length(context, &data_length));

    return read_fixed_size_field(context, field, data_length);
}

err_t read_amount(parseContext_t* context, field_t* field) {
    uint8_t first_byte;
    err_t err;

    CHECK(peak_next_byte(context, &first_byte));
    if ((first_byte >> 7u) == 0) {
        CHECK(read_fixed_size_field(context, field, XRP_AMOUNT_LEN));
    } else {
        CHECK(read_fixed_size_field(context, field, ISSUED_CURRENCY_LEN));

        // All-zero currency means "this is XRP", but XRP is the ledger's
        // native token and never has an issuer. This 48-byte form always
        // carries one, so an all-zero currency here is a fake XRP amount.
        if (is_all_zeros(field->data.ptr + 8, XRP_CURRENCY_SIZE) ||
            !is_valid_currency(field->data.ptr + 8)) {
            err.err = INVALID_STATE;
            return err;
        }

        if (has_non_standard_currency(field)) {
            field_t* currency;
            CHECK(append_new_field(context, &currency));
            currency->data_type = STI_CURRENCY;
            currency->id = XRP_CURRENCY_CURRENCY;
            currency->data.currency = (xrp_currency_t*)(field->data.ptr + 8);
            currency->length = XRP_CURRENCY_SIZE;
        }

        field_t* issuer;
        CHECK(append_new_field(context, &issuer));
        issuer->data_type = STI_ACCOUNT;
        issuer->id = XRP_ACCOUNT_ISSUER;
        issuer->data.account = (xrp_account_t*)(field->data.ptr + 28);
        issuer->length = XRP_ACCOUNT_SIZE;
    }

    return err;
}

err_t read_vector256_field(parseContext_t* context, field_t* field) {
    field->data_type = STI_VECTOR256;

    err_t err;
    uint16_t data_length;

    CHECK(read_vl_length(context, &data_length));

    if ((data_length % XRP_VECTOR256_SIZE) != 0) {
        err.err = INVALID_STATE;
        return err;
    }

    uint16_t count = data_length / XRP_VECTOR256_SIZE;
    if (count > (MAX_FIELD_COUNT - context->result.num_fields)) {
        return out_of_space(context);
    }

    CHECK(read_fixed_size_field(context, field, data_length));
    for (size_t i = 0; i < count; i++) {
        field_t* hash256;
        CHECK(append_new_field(context, &hash256));
        hash256->data_type = STI_HASH256;
        // A Vector256 entry carries no buy/sell semantics of its own; label
        // it generically and let the array index tell entries apart.
        //
        // The XRPL protocol also has Vector256 fields other than
        // NFTokenOffers (Indexes, Hashes, Amendments, CredentialIDs), but
        // this app only recognizes NFTokenOffers (field id 4) in
        // resolve_field_name()'s STI_VECTOR256 case (fields.c): any other
        // Vector256 field's own id resolves to "Unknown" and forces blind
        // signing before these synthesized entries are ever displayed. That
        // is why it's safe to hardcode this label here rather than branch
        // on field->id.
        hash256->id = XRP_HASH256_NFTOKEN_OFFER;
        hash256->data.hash256 =
            (hash256_t*)(field->data.ptr + (i * XRP_VECTOR256_SIZE));
        hash256->length = XRP_VECTOR256_SIZE;
        hash256->array_info.type = field->id;
        hash256->array_info.index1 = (uint8_t)(i + 1);
    }

    return err;
}

err_t read_issue(parseContext_t* context, field_t* field) {
    err_t err;

    if (!has_data(context, 20)) {
        err.err = EXCEPTION_OVERFLOW;
        return err;
    }

    if (!is_all_zeros(context->data + context->offset, 20)) {
        CHECK(read_fixed_size_field(context, field, XRP_ISSUE_SIZE));
        field_t* issuer;
        CHECK(append_new_field(context, &issuer));
        issuer->data_type = STI_ACCOUNT;
        issuer->id = XRP_ACCOUNT_ISSUER;
        issuer->data.account = (xrp_account_t*)(field->data.ptr + 20);
        issuer->length = XRP_ACCOUNT_SIZE;
    } else {
        CHECK(read_fixed_size_field(context, field, XRP_CURRENCY_SIZE));
    }

    return err;
}

// An array (or a path set) inside another array would make the parser lose
// track of the outer one, and the fields after it would show at the wrong
// level. No supported transaction nests them: blind signing.
static err_t check_not_nested(parseContext_t* context) {
    err_t err;
    err.err = context->current_array == ARRAY_NONE ? SUCCESS
                                                   : BLIND_SIGN_REQUIRED;
    return err;
}

// A Batch shows its RawTransactions and its Memos. Any other array (the
// BatchSigners are not even part of the signed data), a second
// RawTransactions, or one inside an object cannot be shown: blind signing.
static err_t begin_batch_array(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = SUCCESS;

    if (field->id == XRP_STARRAY_MEMOS) {
        return err;
    }
    if (field->id == XRP_STARRAY_RAW_TRANSACTIONS &&
        context->object_depth == 0 && !context->batch.has_raw_transactions) {
        context->batch.has_raw_transactions = true;
        return err;
    }

    err.err = BLIND_SIGN_REQUIRED;
    return err;
}

err_t handle_array_field(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = SUCCESS;

    if (field->id != ARR_END) {
        // Begin array
        CHECK(check_not_nested(context));
        if (context->transaction_type == TRANSACTION_BATCH) {
            CHECK(begin_batch_array(context, field));
        }
        context->current_array = field->id;
        context->array_index1 = 0;
        context->array_index2 = 0;
    } else {
        // End array
        context->current_array = ARRAY_NONE;
    }

    return err;
}

// In a Batch, the only objects are the RawTransaction objects straight in
// RawTransactions (one per inner transaction, recorded here) and the
// top-level Memo objects. Anything deeper cannot be shown: blind signing.
static err_t begin_batch_object(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = BLIND_SIGN_REQUIRED;

    if (context->object_depth != 0 || context->current_array == ARRAY_NONE) {
        return err;
    }

    if (context->current_array == XRP_STARRAY_RAW_TRANSACTIONS) {
        if (field->id != XRP_STOBJECT_RAW_TRANSACTION ||
            context->batch.inner_count >= BATCH_MAX_INNER_TXS) {
            return err;
        }
        batchInnerTx_t* inner =
            &context->batch.inner[context->batch.inner_count++];
        inner->transaction_type = TRANSACTION_INVALID;
        inner->has_inner_flag = false;
    }

    err.err = SUCCESS;
    return err;
}

err_t handle_object_field(parseContext_t* context, field_t* field) {
    err_t err;

    if (field->id != OBJ_END) {
        if (context->transaction_type == TRANSACTION_BATCH) {
            CHECK(begin_batch_object(context, field));
        }

        // Normal object, only increment first array index
        context->array_index1++;
        context->object_depth++;

        // Explicitly limit the maximum number of array items
        if (context->array_index1 > MAX_ARRAY_LEN) {
            err.err = NOT_SUPPORTED;
            return err;
        }
    } else if (context->object_depth > 0) {
        context->object_depth--;
    }

    err.err = SUCCESS;
    return err;
}

err_t handle_path_step(parseContext_t* context, field_t* field,
                       uint8_t step_type) {
    field_t* new_field;
    err_t err;

    CHECK(read_fixed_size_field(context, field, 20));

    switch (step_type) {
        case 0x01:
            field->data_type = STI_ACCOUNT;
            field->id = XRP_ACCOUNT_ACCOUNT;
            break;
        case 0x20:
            field->data_type = STI_ACCOUNT;
            field->id = XRP_ACCOUNT_ISSUER;
            break;
        case 0x30:
            // Read the issuer separately
            CHECK(append_new_field(context, &new_field));
            CHECK(handle_path_step(context, new_field, 0x20));

            // Intentional fall through to read the currency,
            // which will be positioned before the issuer
            __attribute__((fallthrough));
        case 0x10:
            field->data_type = STI_CURRENCY;
            field->id = XRP_CURRENCY_CURRENCY;
            break;
        default:
            err.err = INVALID_STATE;
            break;
    }

    return err;
}

err_t handle_path_field(parseContext_t* context, field_t* field) {
    // Set default type to STI_PATHSET, which is hidden
    field->data_type = STI_PATHSET;

    uint8_t current_step;
    err_t err;
    CHECK(read_next_byte(context, &current_step));
    switch (current_step) {
        case PATHSET_NEXT:
            // Indicator for next item. Increase index and continue parsing
            context->array_index1++;
            context->array_index2 = 1;

            // Limit the number of paths to the specified maximum
            if (context->array_index1 > MAX_PATH_COUNT) {
                err.err = INVALID_STATE;
                return err;
            }

            break;
        case PATHSET_END:
            // End of path set, stop parsing
            context->current_array = ARRAY_NONE;
            break;
        default:
            // Verify that the step count is within specified bounds before
            // processing the step data
            if (context->array_index2 > MAX_STEP_COUNT) {
                err.err = INVALID_STATE;
                return err;
            }

            // Actual path step found, perform specific parsing
            CHECK(handle_path_step(context, field, current_step));

            // The array index is incremented here because handle_path_step
            // may append more than one field with the same index
            context->array_index2++;
            break;
    }

    return err;
}

err_t handle_path_set_field(parseContext_t* context) {
    err_t err;

    CHECK(check_not_nested(context));
    context->current_array = ARRAY_PATHSET;

    // The code for handling path set fields becomes easier if we
    // begin the arrays at one, which is what we want to present
    // to the user
    context->array_index1 = 1;
    context->array_index2 = 1;

    return err;
}

err_t read_field_value(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = SUCCESS;

    switch (field->data_type) {
        case STI_UINT8:
            CHECK(read_fixed_size_field(context, field, 1));
            field->data.u8 = field->data.ptr[0];
            break;
        case STI_UINT16:
            CHECK(read_fixed_size_field(context, field, 2));
            field->data.u16 = field->data.ptr[1] | (field->data.ptr[0] << 8);
            break;
        case STI_UINT32:
            CHECK(read_fixed_size_field(context, field, 4));
            field->data.u32 = (uint32_t)field->data.ptr[3] |
                              ((uint32_t)field->data.ptr[2] << 8) |
                              ((uint32_t)field->data.ptr[1] << 16) |
                              ((uint32_t)field->data.ptr[0] << 24);
            break;
        case STI_HASH128:
            err = read_fixed_size_field(context, field, sizeof(hash128_t));
            break;
        case STI_HASH256:
            err = read_fixed_size_field(context, field, sizeof(hash256_t));
            break;
        case STI_AMOUNT:
            err = read_amount(context, field);
            break;
        case STI_VL:
            // Intentional fall-through
        case STI_ACCOUNT:
            err = read_variable_length_field(context, field);
            break;
        case STI_VECTOR256:
            err = read_vector256_field(context, field);
            break;
        case STI_ARRAY:
            err = handle_array_field(context, field);
            break;
        case STI_OBJECT:
            err = handle_object_field(context, field);
            break;
        case STI_PATHSET:
            err = handle_path_set_field(context);
            break;
        case STI_ISSUE:
            err = read_issue(context, field);
            break;
        default:
            err.err = NOT_SUPPORTED;
            break;
    }

    return err;
}

err_t read_field_header(parseContext_t* context, field_t* field) {
    uint8_t first_byte;
    err_t err;

    CHECK(read_next_byte(context, &first_byte));

    if (first_byte >> 4u == 0) {
        // Type code >= 16
        uint8_t data_type;
        CHECK(read_next_byte(context, &data_type));
        field->data_type = data_type;
        if (first_byte == 0) {
            // Field code >= 16
            CHECK(read_next_byte(context, &field->id));
        } else {
            // Field code < 16
            field->id = first_byte & 0x0fu;
        }
    } else {
        // Type code < 16
        field->data_type = first_byte >> 4u;
        if ((first_byte & 0x0fu) == 0) {
            // Field code >= 16
            CHECK(read_next_byte(context, &field->id));
        } else {
            // Field code < 16
            field->id = first_byte & 0x0fu;
        }
    }

    return err;
}

// The positive bit and nothing else: the only encoding of XRP 0.
static const uint8_t ZERO_XRP_AMOUNT[XRP_AMOUNT_LEN] = {0x40, 0, 0, 0,
                                                        0,    0, 0, 0};

static bool is_zero_xrp_amount(const field_t* field) {
    return field->length == XRP_AMOUNT_LEN &&
           memcmp(field->data.ptr, ZERO_XRP_AMOUNT, XRP_AMOUNT_LEN) == 0;
}

// Records an inner transaction's type and flags. What the protocol fixes in
// an inner transaction is hidden from the review (is_batch_fixed_field), so
// it must hold: Fee 0, empty SigningPubKey, no signature, and Flags carrying
// tfInnerBatchTxn (dropped from the display, never from the signed bytes).
// Anything else sends the Batch to blind signing.
static err_t check_batch_inner_field(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = SUCCESS;

    batchInnerTx_t* inner = batch_inner_tx(context, field);
    if (inner == NULL) {
        return err;
    }

    bool valid = true;
    switch (field->data_type) {
        case STI_UINT16:
            if (is_transaction_type_field(field)) {
                valid = inner->transaction_type == TRANSACTION_INVALID;
                inner->transaction_type = field->data.u16;
            }
            break;
        case STI_UINT32:
            if (field->id == XRP_UINT32_FLAGS) {
                valid = !inner->has_inner_flag &&
                        (field->data.u32 & TF_INNER_BATCH_TXN) != 0;
                inner->has_inner_flag = true;
                field->data.u32 &= ~TF_INNER_BATCH_TXN;
            }
            break;
        case STI_AMOUNT:
            valid = field->id != XRP_UINT64_FEE || is_zero_xrp_amount(field);
            break;
        case STI_VL:
            valid = (field->id != XRP_VL_SIGNING_PUB_KEY ||
                     field->length == 0) &&
                    field->id != XRP_VL_TXN_SIGNATURE;
            break;
        default:
            break;
    }

    if (!valid) {
        err.err = BLIND_SIGN_REQUIRED;
    }
    return err;
}

err_t post_process_field(parseContext_t* context, field_t* field) {
    err_t err;
    err.err = SUCCESS;

    CHECK(check_batch_inner_field(context, field));

    switch (field->data_type) {
        case STI_UINT16:
            // Trust only the first top-level TransactionType field. A
            // later occurrence, at any nesting level, could disagree with
            // it. Force blind signing in that case. An inner transaction's
            // own type was recorded just above.
            if (is_transaction_type_field(field) &&
                batch_inner_tx(context, field) == NULL) {
                // Not inside any array/object.
                bool is_top_level = field->array_info.type == ARRAY_NONE &&
                                    context->object_depth == 0;
                // No top-level TransactionType field has been recorded yet.
                bool is_first_occurrence =
                    context->transaction_type == TRANSACTION_INVALID;

                if (is_top_level && is_first_occurrence) {
                    context->transaction_type = field->data.u16;
                } else {
                    err.err = BLIND_SIGN_REQUIRED;
                    return err;
                }
            }
            break;
        case STI_UINT32:
            break;
        case STI_VL:
            // Detect when SigningPubKey is empty (needed for multi-sign).
            // Defence in depth: only a top-level occurrence counts, so one
            // nested inside an array/object cannot spoof this.
            if (field->id == XRP_VL_SIGNING_PUB_KEY && field->length == 0 &&
                field->array_info.type == ARRAY_NONE &&
                context->object_depth == 0) {
                context->has_empty_pub_key = true;
            }
            // The session "Note" row is the app's own text; a signed field
            // claiming its id would let the sender write that row.
            if (field->id == XRP_VL_SESSION_NOTE ||
                field->id == XRP_VL_SESSION_SCOPE) {
                err.err = INVALID_STATE;
                return err;
            }
            break;
        case STI_ACCOUNT:
            // Safety check to capture the illegal case where an account
            // field is not 20 bytes long.
            if (field->length != XRP_ACCOUNT_SIZE) {
                err.err = INVALID_STATE;
                return err;
            }
            // The "Agent ID" row is the app's own, like the "Note" row.
            if (field->id == XRP_ACCOUNT_AGENT_ID) {
                err.err = INVALID_STATE;
                return err;
            }
            break;

        default:
            break;
    }

    return err;
}

// Puts a row the app appends itself where the review of the given
// transaction shows it: the top level, or one inner transaction of a Batch.
static err_t append_review_row(parseContext_t* context, uint8_t group,
                               field_t** field) {
    err_t err;

    CHECK(append_new_field(context, field));
    if (group != BATCH_OUTER_GROUP) {
        (*field)->array_info.type = XRP_STARRAY_RAW_TRANSACTIONS;
        (*field)->array_info.index1 = group;
        (*field)->array_info.index2 = 0;
        (*field)->object_depth = 1;
    }

    return err;
}

// The SessionKey of one transaction of the review: the top level, or one
// inner transaction of a Batch. NULL when it has none.
static field_t* find_session_key(parseContext_t* context, uint8_t group) {
    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        if (field->data_type != STI_ACCOUNT ||
            field->id != XRP_ACCOUNT_SESSION_KEY) {
            continue;
        }
        bool in_group =
            group == BATCH_OUTER_GROUP
                ? field->array_info.type == ARRAY_NONE &&
                      field->object_depth == 0
                : batch_inner_tx(context, field) ==
                      &context->batch.inner[group - 1];
        if (in_group) {
            return field;
        }
    }

    return NULL;
}

// Rows the app adds to the review of one transaction.
static err_t append_review_rows(parseContext_t* context,
                                uint16_t transaction_type,
                                bool has_regular_key, uint8_t group) {
    err_t err;
    err.err = SUCCESS;
    field_t* field;

    // Append "empty" regular key field when clearing it
    if (transaction_type == TRANSACTION_SET_REGULAR_KEY && !has_regular_key) {
        CHECK(append_review_row(context, group, &field));
        field->data_type = STI_ACCOUNT;
        field->id = XRP_ACCOUNT_REGULAR_KEY;
        field->data.ptr = NULL;  // Special value to indicate empty regular key
    }

    // A capped session (mode C) says what it may sign: a direct XRP payment,
    // fees included in the cap. Its own row, before the Note.
    if (context->transaction_type == TRANSACTION_SIGNING_SESSION_SET &&
        has_field(context, STI_AMOUNT, XRP_UINT64_SESSION_CAP, true)) {
        field_t* field;
        CHECK(append_new_field(context, &field));
        field->data_type = STI_VL;
        field->id = XRP_VL_SESSION_SCOPE;
        field->data.ptr = (uint8_t*)SESSION_SCOPE_CAP_TEXT;
        field->length = sizeof(SESSION_SCOPE_CAP_TEXT) - 1;
    }

    // The session key's short identifier, which the agent shows too
    // (signing_session.h); sort_fields() puts it right after the key.
    if (is_session_transaction(transaction_type)) {
        field_t* session_key = find_session_key(context, group);
        if (session_key != NULL) {
            xrp_account_t* key = session_key->data.account;
            CHECK(append_review_row(context, group, &field));
            field->data_type = STI_ACCOUNT;
            field->id = XRP_ACCOUNT_AGENT_ID;
            field->data.account = key;
            field->length = XRP_ACCOUNT_SIZE;
        }
    }

    // A session review ends with what the session key can never do
    // (FIANSO-SPEC 7.3 f): the node enforces it, the screen states it.
    if (transaction_type == TRANSACTION_SIGNING_SESSION_SET) {
        CHECK(append_review_row(context, group, &field));
        field->data_type = STI_VL;
        field->id = XRP_VL_SESSION_NOTE;
        field->data.ptr = (uint8_t*)SESSION_NOTE_TEXT;
        field->length = sizeof(SESSION_NOTE_TEXT) - 1;
    }

    return err;
}

static bool batch_inner_has_regular_key(parseContext_t* context,
                                        uint8_t group) {
    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        if (field->data_type == STI_ACCOUNT &&
            field->id == XRP_ACCOUNT_REGULAR_KEY &&
            batch_inner_tx(context, field) == &context->batch.inner[group - 1]) {
            return true;
        }
    }

    return false;
}

err_t post_process_transaction(parseContext_t* context) {
    err_t err;

    CHECK(append_review_rows(
        context, context->transaction_type,
        has_field(context, STI_ACCOUNT, XRP_ACCOUNT_REGULAR_KEY, false),
        BATCH_OUTER_GROUP));

    // Each inner transaction of a Batch gets the rows of its own review;
    // sort_fields() moves them to the end of that inner transaction.
    if (context->transaction_type == TRANSACTION_BATCH) {
        for (uint8_t group = 1; group <= context->batch.inner_count; ++group) {
            batchInnerTx_t* inner = &context->batch.inner[group - 1];
            CHECK(append_review_rows(context, inner->transaction_type,
                                     batch_inner_has_regular_key(context, group),
                                     group));
        }
    }

    return err;
}

// A Batch is clear-signed only when every inner transaction can be shown in
// full (FIANSO-SPEC 7.4): a node-valid count of inner transactions, each of
// a supported type and marked tfInnerBatchTxn, exactly one outer mode, and
// no inner flag bit the review cannot name.
static err_t check_batch(parseContext_t* context) {
    err_t err;
    err.err = BLIND_SIGN_REQUIRED;
    batchState_t* batch = &context->batch;

    if (!batch->has_raw_transactions ||
        batch->inner_count < BATCH_MIN_INNER_TXS ||
        batch->inner_count > BATCH_MAX_INNER_TXS) {
        return err;
    }

    for (uint8_t i = 0; i < batch->inner_count; ++i) {
        if (!batch->inner[i].has_inner_flag ||
            !is_supported_batch_inner_type(batch->inner[i].transaction_type)) {
            return err;
        }
    }

    uint32_t mode_flags;
    bool mode_duplicate;
    if (!find_top_level_flags_value(context, &mode_flags, &mode_duplicate) ||
        mode_duplicate || resolve_batch_mode(mode_flags) == NULL) {
        return err;
    }

    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        batchInnerTx_t* inner = batch_inner_tx(context, field);
        if (inner != NULL && field->data_type == STI_UINT32 &&
            field->id == XRP_UINT32_FLAGS &&
            has_unknown_flags(inner->transaction_type, field->data.u32)) {
            return err;
        }
    }

    err.err = SUCCESS;
    return err;
}

err_t read_field(parseContext_t* context, field_t* field) {
    err_t err;

    if (context->current_array == ARRAY_PATHSET) {
        CHECK(handle_path_field(context, field));
    } else {
        CHECK(read_field_header(context, field));
        CHECK(read_field_value(context, field));
    }

    return post_process_field(context, field);
}

err_t parse_tx_internal(parseContext_t* context) {
    err_t err;

    context->transaction_type = TRANSACTION_INVALID;
    context->has_empty_pub_key = false;
    context->object_depth = 0;
    memset(&context->batch, 0, sizeof(context->batch));

    while (context->offset != context->length) {
        if (context->offset > context->length) {
            err.err = EXCEPTION_OVERFLOW;
            return err;
        }

        field_t* field;
        CHECK(append_new_field(context, &field));
        CHECK(read_field(context, field));

        if (is_field_hidden(field)) {
            // This must be done after all data has been read since we
            // always need to keep track of the input stream position.
            CHECK(remove_last_field(context, field));
        }
    }

    CHECK(post_process_transaction(context));

    if (!has_field(context, STI_UINT16, XRP_UINT16_TRANSACTION_TYPE, true) ||
        !has_field(context, STI_ACCOUNT, XRP_ACCOUNT_ACCOUNT, true)) {
        err.err = NOT_SUPPORTED;
        return err;
    }

    sort_fields(&context->result);

    if (context->transaction_type == TRANSACTION_INVALID ||
        !is_supported_transaction_type(context->transaction_type)) {
        err.err = BLIND_SIGN_REQUIRED;
        return err;
    }

    if (context->transaction_type == TRANSACTION_BATCH) {
        CHECK(check_batch(context));
    }

    // An unrecognized flag bit must not clear-sign, since it can't be
    // shown to the user. A second top-level Flags field forces blind
    // signing too, same as a duplicate TransactionType above.
    uint32_t flags_value;
    bool flags_duplicate;
    bool has_flags =
        find_top_level_flags_value(context, &flags_value, &flags_duplicate);
    if (flags_duplicate ||
        (has_flags &&
         has_unknown_flags(context->transaction_type, flags_value))) {
        err.err = BLIND_SIGN_REQUIRED;
        return err;
    }

    // Every field that survived is_field_hidden() would be shown to the
    // user during review. A field the app cannot name is a field it
    // cannot explain, even though it is still part of the signed data.
    // Force blind signing rather than show an unlabeled "Unknown" row
    // next to a normal, otherwise-trustworthy-looking review.
    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        if (!is_field_recognized(&context->result.fields[i])) {
            err.err = BLIND_SIGN_REQUIRED;
            return err;
        }
    }

    // A permission the app cannot name cannot be clear-signed (7.3 h): its
    // row would say "Unknown permission" next to an otherwise normal review.
    for (uint8_t i = 0; i < context->result.num_fields; ++i) {
        field_t* field = &context->result.fields[i];
        if (is_permission_value(field) &&
            resolve_permission_name(field->data.u32) == NULL) {
            err.err = BLIND_SIGN_REQUIRED;
            return err;
        }
    }

    err.err = SUCCESS;
    return err;
}

// A blind Batch review must not list some inner transactions and not the
// others (parsing stops at the first one it cannot show): keep the outer
// fields only, without the array/object markers left by an early stop.
static void keep_outer_batch_fields(parseContext_t* context) {
    parseResult_t* result = &context->result;
    uint8_t kept = 0;

    for (uint8_t i = 0; i < result->num_fields; ++i) {
        field_t* field = &result->fields[i];
        if (field->array_info.type == XRP_STARRAY_RAW_TRANSACTIONS ||
            field->data_type == STI_ARRAY || field->data_type == STI_OBJECT) {
            continue;
        }
        if (kept != i) {
            result->fields[kept] = *field;
        }
        kept++;
    }

    memset(&result->fields[kept], 0,
           (result->num_fields - kept) * sizeof(field_t));
    result->num_fields = kept;
}

// A session transaction is clear-signed or refused, never blind-signed,
// whatever the setting says: the session key it creates or closes is the
// whole point of the review. That holds for one inside a Batch too (as far
// as parsing went: an inner transaction after the point where it stopped is
// not known).
static bool involves_session(parseContext_t* context) {
    if (is_session_transaction(context->transaction_type)) {
        return true;
    }
    if (context->transaction_type != TRANSACTION_BATCH) {
        return false;
    }
    for (uint8_t i = 0; i < context->batch.inner_count; ++i) {
        if (is_session_transaction(context->batch.inner[i].transaction_type)) {
            return true;
        }
    }
    return false;
}

// Results meaning "parsed, but the review cannot show all of it".
static bool cannot_be_shown(int err) {
    return err == BLIND_SIGN_REQUIRED || err == NOT_ENOUGH_SPACE;
}

int parse_tx(parseContext_t* context) {
    err_t err = parse_tx_internal(context);
    if (cannot_be_shown(err.err) && involves_session(context)) {
        return SESSION_BLIND_SIGN_REFUSED;
    }
    if (err.err == BLIND_SIGN_REQUIRED &&
        context->transaction_type == TRANSACTION_BATCH) {
        keep_outer_batch_fields(context);
    }
    return err.err;
}
