#ifdef HAVE_NBGL
#include "session_policy_refusal.h"

#include <stdbool.h>

#include "global.h"
#include "idle_menu.h"
#include "io.h"
#include "nbgl_use_case.h"
#include "ui.h"

#define REFUSAL_REASON_SIZE 96

// Kept while the refusal screen is shown
static char G_refusal_reason[REFUSAL_REASON_SIZE];

#ifdef SCREEN_SIZE_WALLET
static void ui_session_policy_refusal_choice(bool back_to_home) {
    if (back_to_home) {
        display_idle_menu();
    } else {
        display_settings_page(SESSION_POLICY_SETTINGS_PAGE);
    }
}
#else
static void ui_session_policy_refusal_ack(void) { display_idle_menu(); }
#endif

void ui_session_policy_refusal(const session_policy_verdict_t *verdict) {
    // Without a reason that fits, the title alone still says why
    const char *reason = NULL;
    if (session_policy_format_refusal(verdict, G_refusal_reason, sizeof(G_refusal_reason))) {
        reason = G_refusal_reason;
    }

#ifdef SCREEN_SIZE_WALLET
    nbgl_useCaseChoice(&ICON_APP_WARNING, "Blocked by your session policy", reason,
                       "Back to home", "Session policy settings",
                       ui_session_policy_refusal_choice);
#else
    nbgl_useCaseAction(&C_Alert_circle_14px, "Blocked by your\nsession policy", NULL,
                       ui_session_policy_refusal_ack);
#endif

    io_send_sw(SW_SESSION_POLICY_REFUSED);
    reset_transaction_context();
}
#endif
