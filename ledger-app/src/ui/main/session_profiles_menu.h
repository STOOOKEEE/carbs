#pragma once

#ifdef HAVE_NBGL

#include "nbgl_content.h"

// Fills the "Profiles" content of the settings: one bar per profile
// (session_profiles.h), whose tap opens that profile's own page, where the
// profile is turned on or off and each of its limits moves to the next
// preset. Everything is read from and written to NVM.
void session_profiles_menu_prepare(nbgl_content_t *profiles);

#endif
