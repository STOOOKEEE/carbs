#include <malloc.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stddef.h>
#include <string.h>

#include "cx.h"
#include "fmt.h"
#include "xrp_helpers.h"
#include "xrp_parse.h"

field_name_t field_name;
field_value_t field_value;
parseContext_t parse_context;

static void update_value(field_t* field, field_value_t* value) {
    format_field(field, value);
}

static void reset_transaction_context(void) {
    explicit_bzero(&parse_context, sizeof(parse_context));
}

int LLVMFuzzerTestOneInput(const uint8_t* Data, size_t Size) {
    // Reset old transaction data that might still remain
    reset_transaction_context();
    parse_context.data = (uint8_t*)Data;
    parse_context.length = Size;

    if (parse_tx(&parse_context) != 0) {
        return 0;
    }

    parseResult_t* transaction = &parse_context.result;
    for (int i = 0; i < transaction->num_fields; ++i) {
        field_t* field = &transaction->fields[i];
        format_field_title(field, &field_name);
        update_value(field, &field_value);
    }

    return 0;
}
