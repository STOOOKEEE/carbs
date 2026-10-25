/*******************************************************************************
 *   carbs: settings of the session policy (session_policy.h).
 *
 *   The only place the policy is written: the host can read it
 *   (INS_GET_SESSION_POLICY), never change it.
 ********************************************************************************/
#ifdef HAVE_NBGL
#include "session_policy_menu.h"

#include <os.h>

#include "globals.h"
#include "idle_menu.h"
#include "nbgl_use_case.h"
#include "xrp_helpers.h"

#define DROPS_PER_XRP      1000000ULL
#define SECONDS_PER_MINUTE 60U
#define BAR_TEXT_SIZE      40

// Presets a tap on a limit cycles through, "no limit" first
static const uint64_t MAX_CAP_PRESETS[] = {
    SESSION_POLICY_NO_LIMIT, 10 * DROPS_PER_XRP, 50 * DROPS_PER_XRP,
    100 * DROPS_PER_XRP,     500 * DROPS_PER_XRP,
};
static const uint64_t MAX_PER_TX_PRESETS[] = {
    SESSION_POLICY_NO_LIMIT, 1 * DROPS_PER_XRP, 5 * DROPS_PER_XRP,
    10 * DROPS_PER_XRP,      50 * DROPS_PER_XRP,
};
static const uint64_t MAX_DURATION_PRESETS[] = {
    SESSION_POLICY_NO_LIMIT, 60, 180, 300, 600,
};
#define PRESETS_NB(presets) (sizeof(presets) / sizeof(presets[0]))

enum {
    POLICY_ENABLED_IDX = 0,
    POLICY_ALLOW_ALL_IDX,
    POLICY_ALLOW_PERMISSIONS_IDX,
    POLICY_REQUIRE_WITNESS_IDX,
    POLICY_SWITCHES_NB,
};

enum {
    POLICY_MAX_CAP_IDX = 0,
    POLICY_MAX_PER_TX_IDX,
    POLICY_MAX_DURATION_IDX,
    POLICY_BARS_NB,
};

// Blind signing uses FIRST_USER_TOKEN (idle_menu_nbgl.c)
enum {
    POLICY_ENABLED_TOKEN = FIRST_USER_TOKEN + 1,
    POLICY_ALLOW_ALL_TOKEN,
    POLICY_ALLOW_PERMISSIONS_TOKEN,
    POLICY_REQUIRE_WITNESS_TOKEN,
    POLICY_MAX_CAP_TOKEN,
    POLICY_MAX_PER_TX_TOKEN,
    POLICY_MAX_DURATION_TOKEN,
};

static nbgl_contentSwitch_t G_policy_switches[POLICY_SWITCHES_NB];
static char G_bar_buffers[POLICY_BARS_NB][BAR_TEXT_SIZE];
static const char *G_bar_texts[POLICY_BARS_NB];
static uint8_t G_bar_tokens[POLICY_BARS_NB] = {
    POLICY_MAX_CAP_TOKEN,
    POLICY_MAX_PER_TX_TOKEN,
    POLICY_MAX_DURATION_TOKEN,
};

static uint64_t next_preset(const uint64_t *presets, size_t presets_nb, uint64_t current) {
    for (size_t i = 0; i < presets_nb; i++) {
        if (presets[i] == current) {
            return presets[(i + 1) % presets_nb];
        }
    }
    // Not a preset: start again from "no limit"
    return presets[0];
}

static void toggle_switch(uint8_t idx, volatile uint8_t *stored) {
    // Write in NVM the opposite of what the current toggle is
    uint8_t new_setting = (G_policy_switches[idx].initState != ON_STATE);
    G_policy_switches[idx].initState = (nbgl_state_t) new_setting;
    nvm_write((void *) stored, &new_setting, sizeof(new_setting));
}

static void switches_callback(int token, uint8_t index, int page) {
    (void) index;
    (void) page;
    switch (token) {
        case POLICY_ENABLED_TOKEN:
            toggle_switch(POLICY_ENABLED_IDX, &N_storage.session_policy.enabled);
            break;
        case POLICY_ALLOW_ALL_TOKEN:
            toggle_switch(POLICY_ALLOW_ALL_IDX, &N_storage.session_policy.allow_all_transactions);
            break;
        case POLICY_ALLOW_PERMISSIONS_TOKEN:
            toggle_switch(POLICY_ALLOW_PERMISSIONS_IDX,
                          &N_storage.session_policy.allow_permissions);
            break;
        case POLICY_REQUIRE_WITNESS_TOKEN:
            toggle_switch(POLICY_REQUIRE_WITNESS_IDX, &N_storage.session_policy.require_witness);
            break;
        default:
            PRINTF("Unreachable\n");
            break;
    }
}

static void bars_callback(int token, uint8_t index, int page) {
    (void) index;
    uint64_t next;
    uint32_t next_duration;
    switch (token) {
        case POLICY_MAX_CAP_TOKEN:
            next = next_preset(MAX_CAP_PRESETS,
                               PRESETS_NB(MAX_CAP_PRESETS),
                               N_storage.session_policy.max_cap);
            nvm_write((void *) &N_storage.session_policy.max_cap, &next, sizeof(next));
            break;
        case POLICY_MAX_PER_TX_TOKEN:
            next = next_preset(MAX_PER_TX_PRESETS,
                               PRESETS_NB(MAX_PER_TX_PRESETS),
                               N_storage.session_policy.max_per_tx);
            nvm_write((void *) &N_storage.session_policy.max_per_tx, &next, sizeof(next));
            break;
        case POLICY_MAX_DURATION_TOKEN:
            next_duration = (uint32_t) next_preset(MAX_DURATION_PRESETS,
                                                   PRESETS_NB(MAX_DURATION_PRESETS),
                                                   N_storage.session_policy.max_duration);
            nvm_write((void *) &N_storage.session_policy.max_duration,
                      &next_duration,
                      sizeof(next_duration));
            break;
        default:
            PRINTF("Unreachable\n");
            return;
    }
    // Show the new value on the same page
    display_settings_page((uint8_t) page);
}

static void set_switch(uint8_t idx,
                       const char *text,
                       const char *sub_text,
                       uint8_t token,
                       uint8_t stored) {
    G_policy_switches[idx].text = text;
    G_policy_switches[idx].subText = sub_text;
    G_policy_switches[idx].token = token;
#ifdef HAVE_PIEZO_SOUND
    G_policy_switches[idx].tuneId = TUNE_TAP_CASUAL;
#endif
    G_policy_switches[idx].initState = stored ? ON_STATE : OFF_STATE;
}

static void format_xrp_limit(const char *name, uint64_t drops, char *out) {
    char amount[BAR_TEXT_SIZE];
    if (drops == SESSION_POLICY_NO_LIMIT) {
        snprintf(out, BAR_TEXT_SIZE, "%s: no limit", name);
    } else if (xrp_print_amount(drops, amount, sizeof(amount)) != 0) {
        // Only presets are ever stored: say so rather than show a wrong value
        snprintf(out, BAR_TEXT_SIZE, "%s: invalid", name);
    } else {
        snprintf(out, BAR_TEXT_SIZE, "%s: %s", name, amount);
    }
}

static void format_duration_limit(uint32_t seconds, char *out) {
    if (seconds == SESSION_POLICY_NO_LIMIT) {
        snprintf(out, BAR_TEXT_SIZE, "Max duration: no limit");
    } else {
        snprintf(out, BAR_TEXT_SIZE, "Max duration: %u min", seconds / SECONDS_PER_MINUTE);
    }
}

void session_policy_menu_prepare(nbgl_content_t *contents) {
    session_policy_t policy = N_storage.session_policy;

    set_switch(POLICY_ENABLED_IDX,
               "Session policy",
               "Check sessions before review",
               POLICY_ENABLED_TOKEN,
               policy.enabled);
    set_switch(POLICY_ALLOW_ALL_IDX,
               "All transactions",
               "Allow sessions for any type",
               POLICY_ALLOW_ALL_TOKEN,
               policy.allow_all_transactions);
    set_switch(POLICY_ALLOW_PERMISSIONS_IDX,
               "Permissions",
               "Allow sessions with permissions",
               POLICY_ALLOW_PERMISSIONS_TOKEN,
               policy.allow_permissions);
    set_switch(POLICY_REQUIRE_WITNESS_IDX,
               "Witness",
               "Require a session witness",
               POLICY_REQUIRE_WITNESS_TOKEN,
               policy.require_witness);

    format_xrp_limit("Max spend", policy.max_cap, G_bar_buffers[POLICY_MAX_CAP_IDX]);
    format_xrp_limit("Max per payment", policy.max_per_tx, G_bar_buffers[POLICY_MAX_PER_TX_IDX]);
    format_duration_limit(policy.max_duration, G_bar_buffers[POLICY_MAX_DURATION_IDX]);
    for (uint8_t i = 0; i < POLICY_BARS_NB; i++) {
        G_bar_texts[i] = G_bar_buffers[i];
    }

    contents[0].type = SWITCHES_LIST;
    contents[0].content.switchesList.switches = G_policy_switches;
    contents[0].content.switchesList.nbSwitches = POLICY_SWITCHES_NB;
    contents[0].contentActionCallback = switches_callback;

    contents[1].type = BARS_LIST;
    contents[1].content.barsList.barTexts = G_bar_texts;
    contents[1].content.barsList.tokens = G_bar_tokens;
    contents[1].content.barsList.nbBars = POLICY_BARS_NB;
#ifdef HAVE_PIEZO_SOUND
    contents[1].content.barsList.tuneId = TUNE_TAP_CASUAL;
#endif
    contents[1].contentActionCallback = bars_callback;
}
#endif
