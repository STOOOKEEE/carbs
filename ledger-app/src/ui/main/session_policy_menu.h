#pragma once

#ifdef HAVE_NBGL

#include <stdbool.h>

#include "nbgl_content.h"

// The policy switches follow blind signing in the settings' one switches
// list: NBGL opens a settings page directly (display_settings_page) only
// when the first content spans more than the first page.
#define SESSION_POLICY_SWITCHES_NB 4

// Fills SESSION_POLICY_SWITCHES_NB switches and the content of the limits
// from the policy stored in NVM.
void session_policy_menu_prepare(nbgl_contentSwitch_t *switches, nbgl_content_t *limits);

// Handles a tap on a policy switch. Returns false for any other token.
bool session_policy_switch_tapped(int token);

#endif
