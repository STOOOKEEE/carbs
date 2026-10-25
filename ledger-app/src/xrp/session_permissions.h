/*******************************************************************************
 *   carbs: XLS-75 permission names shown in a signing session review.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_SESSION_PERMISSIONS_H
#define LEDGER_APP_XRP_SESSION_PERMISSIONS_H

#include <stdbool.h>
#include <stdint.h>

#include "fields.h"
#include "signing_session.h"

// Name of a permission value (transaction type + 1, or a granular permission),
// or NULL when the app does not know it: the session is then refused.
const char *resolve_permission_name(uint32_t value);

static inline bool is_permission_value(const field_t *field) {
    return field->data_type == STI_UINT32 && field->id == XRP_UINT32_PERMISSION_VALUE;
}

#endif  // LEDGER_APP_XRP_SESSION_PERMISSIONS_H
