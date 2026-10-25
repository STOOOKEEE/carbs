/*******************************************************************************
 *   carbs: clear signing of a Batch (XLS-56, FIANSO-SPEC 7.4).
 *
 *   Protocol numbers come from rippled's transactions.macro, sfields.macro and
 *   TxFlags.h: check them again whenever the Batch amendment changes.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_BATCH_H
#define LEDGER_APP_XRP_BATCH_H

#include <stdbool.h>
#include <stdint.h>

#include "fields.h"

// Transaction type and fields
#define TRANSACTION_BATCH            71
#define XRP_STARRAY_RAW_TRANSACTIONS 30
#define XRP_STOBJECT_RAW_TRANSACTION 34

// Outer Batch mode: exactly one of these is set
#define TF_ALL_OR_NOTHING 0x00010000u
#define TF_ONLY_ONE       0x00020000u
#define TF_UNTIL_FAILURE  0x00040000u
#define TF_INDEPENDENT    0x00080000u
#define BATCH_MODE_FLAGS \
    (TF_ALL_OR_NOTHING | TF_ONLY_ONE | TF_UNTIL_FAILURE | TF_INDEPENDENT)

// Every inner transaction carries this flag (fixed by the protocol)
#define TF_INNER_BATCH_TXN 0x40000000u

// Number of inner transactions accepted by the node
#define BATCH_MIN_INNER_TXS 2
#define BATCH_MAX_INNER_TXS 8

// Group of a field outside any inner transaction
#define BATCH_OUTER_GROUP 0

typedef struct {
    uint16_t transaction_type;  // TRANSACTION_INVALID until read
    bool has_inner_flag;        // its Flags carried tfInnerBatchTxn
} batchInnerTx_t;

typedef struct {
    bool has_raw_transactions;
    uint8_t inner_count;
    batchInnerTx_t inner[BATCH_MAX_INNER_TXS];
} batchState_t;

// Whether this field belongs to one of the inner transactions of the Batch
// being parsed (directly inside a RawTransaction object).
bool is_batch_inner_field(const field_t *field);

// 1-based inner transaction a field belongs to, or BATCH_OUTER_GROUP.
uint8_t batch_group(const field_t *field);

// Transaction type that gives this field its meaning: the inner
// transaction's for an inner field, the transaction's otherwise.
uint16_t field_transaction_type(const field_t *field);

// Inner fields fixed by the protocol (Fee 0, empty SigningPubKey) or hidden
// at top level too (Sequence, LastLedgerSequence): never shown.
bool is_batch_fixed_field(const field_t *field);

// Mode of the outer Batch in words, or NULL when not exactly one mode is set.
const char *resolve_batch_mode(uint32_t flags);

#endif  // LEDGER_APP_XRP_BATCH_H
