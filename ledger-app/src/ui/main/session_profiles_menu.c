/*******************************************************************************
 *   carbs: settings of the session profiles (session_profiles.h).
 *
 *   With the policy settings (session_policy_menu.c), the only place the
 *   profiles are written: the host can read them (INS_GET_SESSION_POLICY),
 *   never change them.
 ********************************************************************************/
#ifdef HAVE_NBGL
#include "session_profiles_menu.h"

#include <os.h>

#include "globals.h"
#include "idle_menu.h"
#include "nbgl_use_case.h"
#include "session_policy_menu.h"
#include "session_profiles.h"

// "Streaming profile: off"
#define LIST_TEXT_SIZE  24
#define TITLE_TEXT_SIZE 20
// The on/off bar, then one bar per limit
#define PAGE_BARS_MAX (1 + SESSION_PROFILE_LIMITS_NB)

// Each content has its own callback: these tokens only need to differ
// within one content
enum {
    PROFILE_LIST_TOKEN = FIRST_USER_TOKEN,  // + session_profile_id_t
};
enum {
    PROFILE_ENABLED_TOKEN = FIRST_USER_TOKEN,
    PROFILE_LIMIT_TOKEN,  // + session_profile_limit_t
};

// The texts of the "Profiles" content of the settings, or of the page of
// one profile: never shown together (the settings are prepared again when
// the profile page is left), so they share their RAM.
static union {
    char list[SESSION_PROFILES_NB][LIST_TEXT_SIZE];
    char page[PAGE_BARS_MAX][SETTINGS_BAR_TEXT_SIZE];
} G_buffers;
static const char *G_texts[PAGE_BARS_MAX];
_Static_assert(SESSION_PROFILES_NB <= PAGE_BARS_MAX, "profiles list texts");

static uint8_t G_list_tokens[SESSION_PROFILES_NB];
// The settings page the list is on, to come back to
static uint8_t G_list_page;

// The page of the profile open
static session_profile_id_t G_profile;
static char G_page_title[TITLE_TEXT_SIZE];
static uint8_t G_page_tokens[PAGE_BARS_MAX];
static nbgl_content_t G_page_content;
static nbgl_genericContents_t G_page_contents;

static void display_profile_page(uint8_t page);

static void back_to_settings(void) {
    display_settings_page(G_list_page);
}

static void format_limit(session_profile_limit_t limit,
                         const session_profile_t *profile,
                         char *out) {
    switch (limit) {
        case SESSION_PROFILE_LIMIT_CAP:
            settings_format_xrp_limit("Max spend", profile->max_cap, out);
            break;
        case SESSION_PROFILE_LIMIT_PER_TX:
            settings_format_xrp_limit("Max per payment", profile->max_per_tx, out);
            break;
        case SESSION_PROFILE_LIMIT_DURATION:
            settings_format_duration_limit(profile->max_duration, out);
            break;
        default:
            snprintf(out,
                     SETTINGS_BAR_TEXT_SIZE,
                     "Max transactions: %u",
                     (unsigned int) profile->max_tx_count);
            break;
    }
}

static void profile_page_callback(int token, uint8_t index, int page) {
    (void) index;
    volatile session_profile_settings_t *stored = &N_storage.session_policy.profiles[G_profile];

    if (token == PROFILE_ENABLED_TOKEN) {
        uint8_t disabled = stored->disabled == 0;
        nvm_write((void *) &stored->disabled, &disabled, sizeof(disabled));
    } else if (token >= PROFILE_LIMIT_TOKEN &&
               token < PROFILE_LIMIT_TOKEN + SESSION_PROFILE_LIMITS_NB) {
        session_profile_limit_t limit = (session_profile_limit_t) (token - PROFILE_LIMIT_TOKEN);
        uint8_t next = session_profile_next_limit(G_profile, limit, stored->limits[limit]);
        nvm_write((void *) &stored->limits[limit], &next, sizeof(next));
    } else {
        PRINTF("Unreachable\n");
        return;
    }
    // Show the new value on the same page
    display_profile_page((uint8_t) page);
}

static void display_profile_page(uint8_t page) {
    session_profile_settings_t settings = N_storage.session_policy.profiles[G_profile];
    session_profile_t profile;
    session_profile_resolve(G_profile, &settings, &profile);

    uint8_t bars = 0;
    snprintf(G_buffers.page[bars],
             SETTINGS_BAR_TEXT_SIZE,
             "Profile: %s",
             profile.enabled ? "on" : "off");
    G_page_tokens[bars++] = PROFILE_ENABLED_TOKEN;
    for (uint8_t limit = 0; limit < SESSION_PROFILE_LIMITS_NB; limit++) {
        if (session_profile_has_limit(G_profile, (session_profile_limit_t) limit)) {
            format_limit((session_profile_limit_t) limit, &profile, G_buffers.page[bars]);
            G_page_tokens[bars++] = PROFILE_LIMIT_TOKEN + limit;
        }
    }
    for (uint8_t i = 0; i < bars; i++) {
        G_texts[i] = G_buffers.page[i];
    }

    G_page_content.type = BARS_LIST;
    G_page_content.content.barsList.barTexts = G_texts;
    G_page_content.content.barsList.tokens = G_page_tokens;
    G_page_content.content.barsList.nbBars = bars;
#ifdef HAVE_PIEZO_SOUND
    G_page_content.content.barsList.tuneId = TUNE_TAP_CASUAL;
#endif
    G_page_content.contentActionCallback = profile_page_callback;
    G_page_contents.callbackCallNeeded = false;
    G_page_contents.contentsList = &G_page_content;
    G_page_contents.nbContents = 1;

    snprintf(G_page_title,
             sizeof(G_page_title),
             "%s profile",
             session_profile_title(G_profile));
    nbgl_useCaseGenericConfiguration(G_page_title, page, &G_page_contents, back_to_settings);
}

static void profiles_list_callback(int token, uint8_t index, int page) {
    (void) index;
    if (token < PROFILE_LIST_TOKEN || token >= PROFILE_LIST_TOKEN + SESSION_PROFILES_NB) {
        PRINTF("Unreachable\n");
        return;
    }
    G_profile = (session_profile_id_t) (token - PROFILE_LIST_TOKEN);
    G_list_page = (uint8_t) page;
    display_profile_page(0);
}

void session_profiles_menu_prepare(nbgl_content_t *profiles) {
    for (uint8_t id = 0; id < SESSION_PROFILES_NB; id++) {
        snprintf(G_buffers.list[id],
                 LIST_TEXT_SIZE,
                 "%s profile: %s",
                 session_profile_title((session_profile_id_t) id),
                 N_storage.session_policy.profiles[id].disabled ? "off" : "on");
        G_texts[id] = G_buffers.list[id];
        G_list_tokens[id] = PROFILE_LIST_TOKEN + id;
    }

    profiles->type = BARS_LIST;
    profiles->content.barsList.barTexts = G_texts;
    profiles->content.barsList.tokens = G_list_tokens;
    profiles->content.barsList.nbBars = SESSION_PROFILES_NB;
#ifdef HAVE_PIEZO_SOUND
    profiles->content.barsList.tuneId = TUNE_TAP_CASUAL;
#endif
    profiles->contentActionCallback = profiles_list_callback;
}
#endif
