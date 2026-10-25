/*******************************************************************************
 *   XRP Wallet
 *   (c) 2022 Ledger
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
#include <os_io_seproxyhal.h>
#include <ux.h>

#include "globals.h"
#include "glyphs.h"
#include "idle_menu.h"
#include "nbgl_use_case.h"
#include "os.h"
#include "session_policy_menu.h"
#include "ui.h"

//  -----------------------------------------------------------
//  --------------------- SETTINGS MENU -----------------------
//  -----------------------------------------------------------
#define SETTING_INFO_NB 2
static const char* const INFO_TYPES[SETTING_INFO_NB] = {"Version", "Developer"};
static const char* const INFO_CONTENTS[SETTING_INFO_NB] = {APPVERSION,
                                                           "Ledger"};

static const nbgl_contentInfoList_t infoList = {
    .nbInfos = SETTING_INFO_NB,
    .infoTypes = INFO_TYPES,
    .infoContents = INFO_CONTENTS,
};

// One switches list: blind signing, then the session policy switches
enum {
    BLIND_SIGNING_IDX = 0,
    SESSION_POLICY_SWITCHES_IDX,
    NB_SETTINGS_SWITCHES = SESSION_POLICY_SWITCHES_IDX + SESSION_POLICY_SWITCHES_NB,
};
static nbgl_contentSwitch_t G_switches[NB_SETTINGS_SWITCHES];

enum {
    BLIND_SIGNING_TOKEN = FIRST_USER_TOKEN,
};

// settings menu definition: the switches, then the session policy limits.
// Filled at runtime (set_switches_states): the app may not have an
// initialized .data section.
enum {
    SWITCHES_CONTENT_IDX = 0,
    SESSION_POLICY_LIMITS_CONTENT_IDX,
    SETTING_CONTENTS_NB,
};
static nbgl_content_t contents[SETTING_CONTENTS_NB];

static const nbgl_genericContents_t settingContents = {
    .callbackCallNeeded = false,
    .contentsList = contents,
    .nbContents = SETTING_CONTENTS_NB};

static void settings_controls_callback(int token, uint8_t index, int page) {
    (void)index;
    (void)page;
    if (token == BLIND_SIGNING_TOKEN) {
        // Write in NVM the opposite of what the current toggle is
        uint8_t new_setting = (G_switches[BLIND_SIGNING_IDX].initState != ON_STATE);
        G_switches[BLIND_SIGNING_IDX].initState = (nbgl_state_t)new_setting;
        nvm_write((void*)&N_storage.allow_blind_sign, &new_setting,
                  sizeof(new_setting));
    } else if (!session_policy_switch_tapped(token)) {
        PRINTF("Unreachable\n");
    }
}

void set_switches_states(void) {
    G_switches[BLIND_SIGNING_IDX].text = "Blind signing";
    G_switches[BLIND_SIGNING_IDX].subText = "Enable blind signing";
    G_switches[BLIND_SIGNING_IDX].token = BLIND_SIGNING_TOKEN;
#ifdef HAVE_PIEZO_SOUND
    G_switches[BLIND_SIGNING_IDX].tuneId = TUNE_TAP_CASUAL;
#endif
    if (N_storage.allow_blind_sign == BlindSignDisabled) {
        G_switches[BLIND_SIGNING_IDX].initState = OFF_STATE;
    } else {
        G_switches[BLIND_SIGNING_IDX].initState = ON_STATE;
    }
    contents[SWITCHES_CONTENT_IDX].type = SWITCHES_LIST;
    contents[SWITCHES_CONTENT_IDX].content.switchesList.switches = G_switches;
    contents[SWITCHES_CONTENT_IDX].content.switchesList.nbSwitches = NB_SETTINGS_SWITCHES;
    contents[SWITCHES_CONTENT_IDX].contentActionCallback = settings_controls_callback;
    session_policy_menu_prepare(&G_switches[SESSION_POLICY_SWITCHES_IDX],
                                &contents[SESSION_POLICY_LIMITS_CONTENT_IDX]);
}

static void on_quit_clbk(void) { os_sched_exit(-1); }

// home page definition
void display_idle_menu(void) {
    set_switches_states();
    nbgl_useCaseHomeAndSettings(APPNAME, &ICON_APP_HOME, NULL, INIT_HOME_PAGE,
                                &settingContents, &infoList, NULL,
                                on_quit_clbk);
}

void display_settings_menu(void) { display_settings_page(0); }

void display_settings_page(uint8_t page) {
    set_switches_states();
    nbgl_useCaseHomeAndSettings(APPNAME, &ICON_APP_HOME, NULL, page,
                                &settingContents, &infoList, NULL,
                                on_quit_clbk);
}
