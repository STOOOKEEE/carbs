#pragma once

#ifdef HAVE_NBGL

#include "nbgl_content.h"

// Settings contents of the session policy: its switches, then its limits
#define SESSION_POLICY_CONTENTS_NB 2

// Fills SESSION_POLICY_CONTENTS_NB contents from the policy stored in NVM.
void session_policy_menu_prepare(nbgl_content_t *contents);

#endif
