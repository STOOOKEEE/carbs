/*******************************************************************************
 *   XRP Wallet
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

#include "field_sort.h"

#include <string.h>

#include "transaction_types.h"

// Whether the field sits at the level of its own transaction: the top level,
// or directly inside an inner transaction of a Batch.
static bool is_transaction_level(field_t* field) {
    return field->array_info.type == ARRAY_NONE || is_batch_inner_field(field);
}

uint8_t get_priority_score(field_t* field) {
    if (!is_transaction_level(field)) {
        return 2;
    }

    if (is_transaction_type_field(field)) {
        return 0;
    }

    // The session key is what a session review is about: keep it, and the
    // Agent ID row appended for it, next to the account (Account is
    // serialized before the key, the row is appended last, and the sort is
    // stable). The Profile row, appended right after the Agent ID, follows.
    if ((field->data_type == STI_ACCOUNT &&
         (field->id == XRP_ACCOUNT_ACCOUNT ||
          field->id == XRP_ACCOUNT_SESSION_KEY ||
          field->id == XRP_ACCOUNT_AGENT_ID)) ||
        (field->data_type == STI_VL && field->id == XRP_VL_SESSION_PROFILE)) {
        return 1;
    }

    return 2;
}

// The fields of each inner transaction of a Batch stay together, after the
// outer ones and in order; each group then starts with its type and account.
bool is_preceding(field_t* field, field_t* other_field) {
    uint8_t group = batch_group(field);
    uint8_t other_group = batch_group(other_field);
    if (group != other_group) {
        return group < other_group;
    }
    return get_priority_score(field) < get_priority_score(other_field);
}

void swap_fields(parseResult_t* result, uint8_t idx1, uint8_t idx2) {
    field_t buffer_field;
    memcpy(&buffer_field, &result->fields[idx1], sizeof(field_t));
    memcpy(&result->fields[idx1], &result->fields[idx2], sizeof(field_t));
    memcpy(&result->fields[idx2], &buffer_field, sizeof(field_t));
}

void sort_fields(parseResult_t* result) {
    uint8_t i = 0;
    while (i < result->num_fields - 1) {
        field_t* cur_field = &result->fields[i];
        field_t* next_field = &result->fields[i + 1];

        if (is_preceding(next_field, cur_field) &&
            !is_preceding(cur_field, next_field)) {
            swap_fields(result, i, i + 1);
            i = (i > 0) ? (i - 1) : 0;
        } else {
            ++i;
        }
    }
}
