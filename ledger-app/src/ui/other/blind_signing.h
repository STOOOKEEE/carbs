#ifdef HAVE_NBGL

int ui_error_blind_signing(void);

// A session transaction that cannot be clear-signed is refused, whatever the
// blind-signing setting says. Only shows the screen: the caller answers.
void ui_error_session_blind_signing(void);

#endif
