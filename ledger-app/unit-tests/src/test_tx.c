// clang-format off
#include <setjmp.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <cmocka.h>
// clang-format on
#include <string.h>

#include "../src/globals.h"
#include "../src/xrp/fmt.h"
#include "../src/xrp/xrp_helpers.h"
#include "../src/xrp/signing_session.h"
#include "../src/xrp/xrp_parse.h"
#include "cx.h"

parseContext_t parse_context;

static const char* testcases[] = {
    "../../tests/standalone/testcases/01-payment/01-basic.raw",
    "../../tests/standalone/testcases/01-payment/02-destination-tag.raw",
    "../../tests/standalone/testcases/01-payment/03-source-tag.raw",
    "../../tests/standalone/testcases/01-payment/04-both-tags.raw",
    "../../tests/standalone/testcases/01-payment/05-invoice-id.raw",
    "../../tests/standalone/testcases/01-payment/06-invoice-txn-ids-tags.raw",
    "../../tests/standalone/testcases/01-payment/07-issued-currency.raw",
    "../../tests/standalone/testcases/01-payment/08-issued-currency-max.raw",
    "../../tests/standalone/testcases/01-payment/"
    "09-issued-currency-min-partial.raw",
    "../../tests/standalone/testcases/01-payment/"
    "10-issued-currency-quality-partial.raw",
    "../../tests/standalone/testcases/01-payment/11-issued-currency-paths.raw",
    "../../tests/standalone/testcases/01-payment/"
    "12-issued-currency-conversion.raw",
    "../../tests/standalone/testcases/01-payment/"
    "13-issued-currency-e-notation.raw",
    "../../tests/standalone/testcases/01-payment/"
    "14-issued-currency-non-standard.raw",
    "../../tests/standalone/testcases/01-payment/15-issue-abc-currency.raw",
    "../../tests/standalone/testcases/01-payment/16-memos.raw",
    "../../tests/standalone/testcases/01-payment/17-multi-sign-parallel.raw",
    "../../tests/standalone/testcases/01-payment/18-multi-sign-serial.raw",
    //"../../tests/standalone/testcases/01-payment/19-really-stupid-tx.raw",
    "../../tests/standalone/testcases/01-payment/20-spoofed-xrp-currency.raw",
    "../../tests/standalone/testcases/01-payment/23-xrp-nonstandard-spoof.raw",
    "../../tests/standalone/testcases/02-set-regular-key/01-basic.raw",
    "../../tests/standalone/testcases/02-set-regular-key/02-delete.raw",
    "../../tests/standalone/testcases/02-set-regular-key/"
    "03-all-common-fields.raw",
    "../../tests/standalone/testcases/03-escrow-create/01-finish-after.raw",
    "../../tests/standalone/testcases/03-escrow-create/02-cancel-after.raw",
    "../../tests/standalone/testcases/03-escrow-create/03-both.raw",
    "../../tests/standalone/testcases/03-escrow-create/04-both-condition.raw",
    "../../tests/standalone/testcases/03-escrow-create/"
    "05-both-condition-destination.raw",
    "../../tests/standalone/testcases/03-escrow-create/"
    "06-all-common-fields.raw",
    "../../tests/standalone/testcases/04-escrow-finish/01-time-based.raw",
    "../../tests/standalone/testcases/04-escrow-finish/02-condition-based.raw",
    "../../tests/standalone/testcases/05-escrow-cancel/01-basic.raw",
    "../../tests/standalone/testcases/06-account-set/01-basic.raw",
    "../../tests/standalone/testcases/06-account-set/02-default-ripple.raw",
    "../../tests/standalone/testcases/06-account-set/03-deposit-auth.raw",
    "../../tests/standalone/testcases/06-account-set/04-disable-master.raw",
    "../../tests/standalone/testcases/06-account-set/05-disallow-xrp.raw",
    "../../tests/standalone/testcases/06-account-set/06-global-freeze.raw",
    "../../tests/standalone/testcases/06-account-set/07-no-freeze.raw",
    "../../tests/standalone/testcases/06-account-set/08-require-auth.raw",
    "../../tests/standalone/testcases/06-account-set/09-require-tag.raw",
    "../../tests/standalone/testcases/06-account-set/"
    "10-clear-account-txn-id.raw",
    "../../tests/standalone/testcases/07-check-cancel/01-basic.raw",
    "../../tests/standalone/testcases/08-check-cash/01-basic.raw",
    "../../tests/standalone/testcases/08-check-cash/02-amount.raw",
    "../../tests/standalone/testcases/08-check-cash/03-issued.raw",
    "../../tests/standalone/testcases/08-check-cash/04-issued-delivery-min.raw",
    "../../tests/standalone/testcases/09-check-create/01-basic.raw",
    "../../tests/standalone/testcases/09-check-create/02-issued.raw",
    "../../tests/standalone/testcases/10-deposit-preauth/01-basic.raw",
    "../../tests/standalone/testcases/10-deposit-preauth/02-unauthorize.raw",
    "../../tests/standalone/testcases/11-offer-cancel/01-basic.raw",
    "../../tests/standalone/testcases/12-offer-create/01-basic.raw",
    "../../tests/standalone/testcases/12-offer-create/02-passive.raw",
    "../../tests/standalone/testcases/12-offer-create/"
    "03-immediate-or-cancel.raw",
    "../../tests/standalone/testcases/12-offer-create/04-fill-or-kill.raw",
    "../../tests/standalone/testcases/12-offer-create/05-sell.raw",
    "../../tests/standalone/testcases/12-offer-create/06-combo.raw",
    "../../tests/standalone/testcases/13-payment-channel-claim/01-basic.raw",
    "../../tests/standalone/testcases/13-payment-channel-claim/02-renew.raw",
    "../../tests/standalone/testcases/13-payment-channel-claim/03-close.raw",
    "../../tests/standalone/testcases/14-payment-channel-create/01-basic.raw",
    "../../tests/standalone/testcases/15-payment-channel-fund/01-basic.raw",
    "../../tests/standalone/testcases/16-signer-list-set/01-basic.raw",
    "../../tests/standalone/testcases/16-signer-list-set/02-delete.raw",
    "../../tests/standalone/testcases/17-trust-set/01-basic.raw",
    "../../tests/standalone/testcases/17-trust-set/02-quality.raw",
    "../../tests/standalone/testcases/17-trust-set/03-authorize.raw",
    "../../tests/standalone/testcases/17-trust-set/04-no-rippling.raw",
    "../../tests/standalone/testcases/17-trust-set/05-rippling.raw",
    "../../tests/standalone/testcases/17-trust-set/06-freeze.raw",
    "../../tests/standalone/testcases/17-trust-set/07-unfreeze.raw",
    "../../tests/standalone/testcases/17-trust-set/"
    "08-non-standard-currency.raw",
    "../../tests/standalone/testcases/17-trust-set/09-remove.raw",
    "../../tests/standalone/testcases/18-arrays/01-basic.raw",
    "../../tests/standalone/testcases/18-arrays/02-multiple.raw",
    "../../tests/standalone/testcases/18-arrays/03-not-last.raw",
    "../../tests/standalone/testcases/19-nftoken-mint/01-basic.raw",
    "../../tests/standalone/testcases/19-nftoken-mint/02-burnable.raw",
    "../../tests/standalone/testcases/19-nftoken-mint/03-only-xrp.raw",
    "../../tests/standalone/testcases/19-nftoken-mint/04-transferable.raw",
    "../../tests/standalone/testcases/19-nftoken-mint/"
    "05-transferable-mutable.raw",
    "../../tests/standalone/testcases/20-nftoken-burn/01-basic.raw",
    "../../tests/standalone/testcases/21-nftoken-create-offer/01-sell.raw",
    "../../tests/standalone/testcases/21-nftoken-create-offer/"
    "02-sell-destination.raw",
    "../../tests/standalone/testcases/21-nftoken-create-offer/03-buy.raw",
    "../../tests/standalone/testcases/21-nftoken-create-offer/"
    "04-buy-expiration.raw",
    "../../tests/standalone/testcases/22-nftoken-cancel-offer/01-basic.raw",
    "../../tests/standalone/testcases/22-nftoken-cancel-offer/"
    "02-large-vector.raw",
    "../../tests/standalone/testcases/24-clawback/01-basic.raw",
    "../../tests/standalone/testcases/25-amm-create/01-basic.raw",
    "../../tests/standalone/testcases/26-amm-deposit/01-one-sided.raw",
    "../../tests/standalone/testcases/26-amm-deposit/02-two-sided.raw",
    "../../tests/standalone/testcases/26-amm-deposit/03-amount-lp-out.raw",
    "../../tests/standalone/testcases/26-amm-deposit/04-lp-out.raw",
    "../../tests/standalone/testcases/27-amm-withdraw/01-one-sided.raw",
    "../../tests/standalone/testcases/27-amm-withdraw/02-two-sided.raw",
    "../../tests/standalone/testcases/27-amm-withdraw/03-amount-lp-out.raw",
    "../../tests/standalone/testcases/27-amm-withdraw/04-lp-out.raw",
    "../../tests/standalone/testcases/28-amm-bid/01-basic.raw",
    "../../tests/standalone/testcases/28-amm-bid/02-min-max.raw",
    "../../tests/standalone/testcases/29-amm-vote/01-basic.raw",
    // carbs: SigningSessionSet in modes A, P and C, and SigningSessionDelete.
    // Each .json shows the fields; the .raw was encoded from it with
    // ripple-binary-codec and the SigningSessions numbers (FIANSO-SPEC 6.1).
    "../../tests/standalone/testcases/30-signing-session-set/01-mode-all.raw",
    "../../tests/standalone/testcases/30-signing-session-set/"
    "02-mode-permissions.raw",
    "../../tests/standalone/testcases/30-signing-session-set/03-mode-cap.raw",
    "../../tests/standalone/testcases/30-signing-session-set/"
    "04-ten-permissions.raw",
    "../../tests/standalone/testcases/30-signing-session-set/"
    "05-short-duration.raw",
    // Encoded with the server_definitions of the carbs node (PR #29).
    "../../tests/standalone/testcases/30-signing-session-set/"
    "12-cap-per-tx-and-witness.raw",
    "../../tests/standalone/testcases/31-signing-session-delete/"
    "01-own-close.raw",
    "../../tests/standalone/testcases/31-signing-session-delete/"
    "02-expired-by-third-party.raw",
    // carbs: Batch clear signing (FIANSO-SPEC 7.4), encoded the same way.
    "../../tests/standalone/testcases/32-batch/01-session-and-payment.raw",
    "../../tests/standalone/testcases/32-batch/02-three-session-deletes.raw",
    // carbs: the Agent ID row, and the SessionMaxPerTx / SessionWitness rows.
    "../../tests/standalone/testcases/34-session-agent-id/01-agent-id.raw",
    // carbs: the SessionMaxTxCount row and a carbs-profile memo, policy off.
    "../../tests/standalone/testcases/33-session-policy/04-profile-game.raw",
    "../../tests/standalone/testcases/33-session-policy/07-profile-trading.raw",
    NULL,
};

// Transactions that must be rejected by the parser (parse_tx returns non-zero).
static const char* negative_testcases[] = {
    // Currency with first byte 0x00 and XRP ticker: invalid per spec —
    // 0x00 prefix is reserved for standard codes and "XRP" is disallowed.
    "../../tests/standalone/testcases/01-payment/22-xrp-reserved-ticker.raw",
    // Composite path step type 0x11 (account|currency bitmask) is explicitly
    // forbidden by the XRPL spec; only 0x01, 0x10, 0x20, 0x30 are valid.
    "../../tests/standalone/testcases/01-payment/24-invalid-path-step-type.raw",
    // STVector256 length not a multiple of 32 must be rejected, not
    // silently truncated.
    "../../tests/standalone/testcases/22-nftoken-cancel-offer/"
    "03-invalid-vector-length.raw",
    // A TransactionType nested inside another field, disagreeing with the
    // top-level one, must not override it and bypass blind signing.
    "../../tests/standalone/testcases/01-payment/"
    "25-nested-transaction-type.raw",
    // A duplicate top-level TransactionType (unsupported, then supported)
    // must not let the second occurrence override the first.
    "../../tests/standalone/testcases/01-payment/"
    "26-duplicate-transaction-type.raw",
    // NFTokenMint Flags combining a recognized bit with an unrecognized
    // one must not clear-sign showing only the recognized bit while the
    // other vanishes from the review.
    "../../tests/standalone/testcases/19-nftoken-mint/06-unknown-flag.raw",
    // tfTrustLine is invalid to set per XRPL's
    // fixRemoveNFTokenAutoTrustLine amendment; it must not clear-sign as a
    // normal, usable flag.
    "../../tests/standalone/testcases/19-nftoken-mint/07-trustline-flag.raw",
    // A second top-level Flags field must not be silently ignored.
    "../../tests/standalone/testcases/19-nftoken-mint/08-duplicate-flags.raw",
    // A field id this app does not recognize, on an otherwise well-formed
    // supported Payment, must not clear-sign with an unlabeled row while
    // still being signed.
    "../../tests/standalone/testcases/01-payment/27-unrecognized-field.raw",
    // An all-zero currency in a 48-byte issued Amount is the reserved
    // native-XRP encoding, but this form always carries an issuer, so it
    // must not clear-sign as plain XRP with an attacker-chosen issuer.
    "../../tests/standalone/testcases/01-payment/"
    "28-all-zero-currency-issued-amount.raw",
    // NFTokenAcceptOffer only references an offer by hash; the price lives
    // on the NFTokenOffer ledger object, outside the signed bytes. A clear
    // sign review would therefore show the same screen for a fair trade and
    // for one that drains the account, so it must blind sign instead.
    "../../tests/standalone/testcases/blind-sign/"
    "03-nftoken-accept-offer.raw",
    "../../tests/standalone/testcases/blind-sign/"
    "04-nftoken-accept-offer-broker.raw",
    NULL,
};

static uint8_t* load_transaction_data(const char* filename, size_t* size) {
    uint8_t* data = NULL;

    FILE* f = fopen(filename, "rb");
    assert_non_null(f);

    assert_int_equal(fseek(f, 0, SEEK_END), 0);
    long filesize_long = ftell(f);
    assert_true(filesize_long >= 0);
    assert_int_equal(fseek(f, 0, SEEK_SET), 0);

    size_t filesize = (size_t)filesize_long;
    if (filesize > 0) {
        data = malloc(filesize);
        assert_non_null(data);
        assert_true(fread(data, 1, filesize, f) == filesize);
    }
    *size = filesize;
    fclose(f);

    return data;
}

static void update_value(field_t* field, field_value_t* value) {
    format_field(field, value);
}

static void get_result_filename(const char* filename, char* path, size_t size) {
    strncpy(path, filename, size);

    char* ext = strstr(path, ".raw");
    assert_non_null(ext);
    memcpy(ext, ".txt", 4);
}

static void generate_expected_result(const char* filename,
                                     parseResult_t* transaction) {
    char path[1024];
    get_result_filename(filename, path, sizeof(path));

    FILE* fp = fopen(path, "w");
    assert_non_null(fp);

    for (int i = 0; i < transaction->num_fields; ++i) {
        field_t* field = &transaction->fields[i];
        field_name_t field_name;
        field_value_t field_value;
        format_field_title(field, &field_name);
        update_value(field, &field_value);
        fprintf(fp, "%s; %s\n", field_name.buf, field_value.buf);
    }

    fclose(fp);
}

static void check_transaction_results(const char* filename,
                                      parseResult_t* transaction) {
    printf("[*] %s\n", filename);
    char path[1024];
    get_result_filename(filename, path, sizeof(path));

    FILE* fp = fopen(path, "r");
    assert_non_null(fp);

    for (int i = 0; i < transaction->num_fields; ++i) {
        field_t* field = &transaction->fields[i];
        field_name_t field_name;
        field_value_t field_value;
        format_field_title(field, &field_name);
        update_value(field, &field_value);

        char line[4096];
        assert_non_null(fgets(line, sizeof(line), fp));

        char* expected_title = line;
        char* expected_value = strstr(line, "; ");
        assert_non_null(expected_value);

        *expected_value = '\x00';
        assert_string_equal(expected_title, field_name.buf);

        expected_value += 2;
        char* p = strchr(expected_value, '\n');
        if (p != NULL) {
            *p = '\x00';
        }
        assert_string_equal(field_value.buf, expected_value);
    }

    fclose(fp);
}

static void test_tx(const char* filename) {
    size_t size;
    uint8_t* data = load_transaction_data(filename, &size);

    memset(&parse_context, 0, sizeof(parse_context));
    parse_context.data = data;
    parse_context.length = size;
    assert_int_equal(parse_tx(&parse_context), 0);

    parseResult_t* transaction = &parse_context.result;
    if (false) {
        generate_expected_result(filename, transaction);
    }
    check_transaction_results(filename, transaction);

    free(data);
}

void test_transactions(void** state) {
    (void)state;

    for (const char** testcase = testcases; *testcase != NULL; testcase++) {
        test_tx(*testcase);
    }
}

void test_invalid_transactions(void** state) {
    (void)state;

    for (const char** testcase = negative_testcases; *testcase != NULL;
         testcase++) {
        size_t size;
        uint8_t* data = load_transaction_data(*testcase, &size);

        memset(&parse_context, 0, sizeof(parse_context));
        parse_context.data = data;
        parse_context.length = size;
        assert_int_not_equal(parse_tx(&parse_context), 0);

        free(data);
    }
}

// A session transaction the app cannot fully explain is refused, never
// offered for blind signing (FIANSO-SPEC 7.3 h, h2): parse_tx() returns
// SESSION_BLIND_SIGN_REFUSED, which sign_transaction.c turns into the
// refusal screen before review_transaction() reads the blind-signing setting,
// so the answer is the same with the setting on.
static const char* session_never_blind_testcases[] = {
    // Permission value 999999 is neither a delegable type + 1 nor granular.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "06-unknown-permission.raw",
    // Flags 0x00030000: mode A plus a bit SigningSessionSet does not define.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "07-unknown-flag.raw",
    // Two top-level Flags fields.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "08-duplicate-flags.raw",
    // A UINT32 field (id 48) the app cannot name.
    "../../tests/standalone/testcases/34-session-agent-id/"
    "02-unknown-field-refused.raw",
    // A Batch that would go blind (TicketCreate inner) holding a session.
    "../../tests/standalone/testcases/34-session-agent-id/"
    "03-batch-session-refused.raw",
    // Batches whose parsing stops early, so what is left may open a session:
    // an inner Fee other than 0 (it would be hidden as a protocol constant)...
    "../../tests/standalone/testcases/32-batch/04-inner-fee-not-zero.raw",
    // ...an array nested in RawTransactions...
    "../../tests/standalone/testcases/32-batch/05-memos-in-inner.raw",
    // ...or outer Memos filling the field budget before a SigningSessionSet.
    "../../tests/standalone/testcases/32-batch/"
    "06-session-after-field-limit.raw",
    NULL,
};

// A fully read Batch the app cannot show in full goes blind (FIANSO-SPEC
// 7.4), never a partial clear-sign review.
static const char* batch_blind_testcases[] = {
    // TicketCreate is not an inner type the review supports.
    "../../tests/standalone/testcases/32-batch/03-unsupported-inner-type.raw",
    NULL,
};

// Malformed session data is refused outright, not offered for blind signing.
static const char* session_refused_testcases[] = {
    // 01-mode-all with its last 5 bytes cut.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "09-truncated.raw",
    // A signed field claiming the id of the app's own "Note" row.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "10-spoofed-note.raw",
    // A signed field claiming the id of the app's own mode C "Allows" row.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "13-spoofed-scope.raw",
    // 11 permissions: one more than a session can hold.
    "../../tests/standalone/testcases/30-signing-session-set/"
    "11-eleven-permissions.raw",
    // A signed field claiming the id of the app's own "Agent ID" row.
    "../../tests/standalone/testcases/34-session-agent-id/"
    "04-spoofed-agent-id.raw",
    // SessionCap carried twice (20 XRP, then 500 XRP).
    "../../tests/standalone/testcases/30-signing-session-set/"
    "16-duplicate-cap.raw",
    // SessionKey carried twice: the Agent ID would follow only one.
    "../../tests/standalone/testcases/34-session-agent-id/"
    "05-duplicate-session-key.raw",
    // A signed field claiming the id of the app's own "Profile" row.
    "../../tests/standalone/testcases/33-session-policy/"
    "11-spoofed-profile.raw",
    // SessionMaxTxCount carried twice (300, then 10).
    "../../tests/standalone/testcases/33-session-policy/"
    "12-duplicate-tx-count.raw",
    NULL,
};

static int parse_file(const char* filename) {
    size_t size;
    uint8_t* data = load_transaction_data(filename, &size);

    memset(&parse_context, 0, sizeof(parse_context));
    parse_context.data = data;
    parse_context.length = size;
    int result = parse_tx(&parse_context);

    free(data);
    return result;
}

static void assert_all_parse_to(const char** cases, int expected) {
    for (const char** testcase = cases; *testcase != NULL; testcase++) {
        printf("[*] %s\n", *testcase);
        assert_int_equal(parse_file(*testcase), expected);
    }
}

void test_session_never_blind(void** state) {
    (void)state;
    assert_all_parse_to(session_never_blind_testcases,
                        SESSION_BLIND_SIGN_REFUSED);
}

void test_batch_blind_required(void** state) {
    (void)state;
    assert_all_parse_to(batch_blind_testcases, BLIND_SIGN_REQUIRED);
}

void test_session_refused(void** state) {
    (void)state;

    for (const char** testcase = session_refused_testcases; *testcase != NULL;
         testcase++) {
        printf("[*] %s\n", *testcase);
        int result = parse_file(*testcase);
        assert_int_not_equal(result, 0);
        assert_int_not_equal(result, BLIND_SIGN_REQUIRED);
    }
}

// The Agent ID row: the first 4 bytes of the SessionKey AccountID, uppercase
// hex, grouped "XXXX-XXXX" (docs/device-contract.md).
void test_agent_id_format(void** state) {
    (void)state;

    xrp_account_t key = {.buf = {0x0a, 0xbc, 0x12, 0xef, 0xff}};
    field_t field;
    memset(&field, 0, sizeof(field));
    field.data_type = STI_ACCOUNT;
    field.id = XRP_ACCOUNT_AGENT_ID;
    field.data.account = &key;
    field.length = XRP_ACCOUNT_SIZE;

    field_name_t title;
    field_value_t value;
    format_field_title(&field, &title);
    format_field(&field, &value);
    assert_string_equal(title.buf, "Agent ID");
    assert_string_equal(value.buf, "0ABC-12EF");
}

int main() {
    const struct CMUnitTest tests[] = {
        cmocka_unit_test(test_transactions),
        cmocka_unit_test(test_invalid_transactions),
        cmocka_unit_test(test_session_never_blind),
        cmocka_unit_test(test_batch_blind_required),
        cmocka_unit_test(test_session_refused),
        cmocka_unit_test(test_agent_id_format),
    };
    return cmocka_run_group_tests(tests, NULL, NULL);
}
