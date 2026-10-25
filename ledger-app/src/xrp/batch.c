/*******************************************************************************
 *   carbs: clear signing of a Batch (XLS-56, FIANSO-SPEC 7.4).
 *
 *   The parser (xrp_parse.c) records each inner transaction in
 *   parse_context.batch and refuses to clear-sign anything it cannot show;
 *   these helpers tell the display which inner transaction a field is part of.
 ********************************************************************************/

#include "batch.h"

#include <stddef.h>

#include "sign_transaction.h"
#include "transaction_types.h"

bool is_batch_inner_field(const field_t* field) {
    return parse_context.transaction_type == TRANSACTION_BATCH &&
           field->array_info.type == XRP_STARRAY_RAW_TRANSACTIONS &&
           field->object_depth == 1 && field->array_info.index1 >= 1 &&
           field->array_info.index1 <= parse_context.batch.inner_count;
}

uint8_t batch_group(const field_t* field) {
    return is_batch_inner_field(field) ? field->array_info.index1
                                       : BATCH_OUTER_GROUP;
}

uint16_t field_transaction_type(const field_t* field) {
    if (is_batch_inner_field(field)) {
        return parse_context.batch.inner[field->array_info.index1 - 1]
            .transaction_type;
    }
    return parse_context.transaction_type;
}

// The parser has already forced blind signing when an inner Fee is not zero
// or an inner SigningPubKey is not empty, so hiding them hides nothing.
bool is_batch_fixed_field(const field_t* field) {
    if (!is_batch_inner_field(field)) {
        return false;
    }

    switch (field->data_type) {
        case STI_AMOUNT:
            return field->id == XRP_UINT64_FEE;
        case STI_VL:
            return field->id == XRP_VL_SIGNING_PUB_KEY;
        case STI_UINT32:
            return field->id == XRP_UINT32_SEQUENCE ||
                   field->id == XRP_UINT32_LAST_LEDGER_SEQUENCE;
        default:
            return false;
    }
}

const char* resolve_batch_mode(uint32_t flags) {
    switch (flags & BATCH_MODE_FLAGS) {
        case TF_ALL_OR_NOTHING:
            return "All or nothing";
        case TF_ONLY_ONE:
            return "Only one";
        case TF_UNTIL_FAILURE:
            return "Until failure";
        case TF_INDEPENDENT:
            return "Independent";
        default:
            return NULL;
    }
}
