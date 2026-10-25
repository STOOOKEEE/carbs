#pragma once

#ifdef HAVE_NBGL

#include "session_policy.h"

// Shows why the session policy refuses the transaction, answers
// SW_SESSION_POLICY_REFUSED and drops the transaction.
void ui_session_policy_refusal(const session_policy_verdict_t *verdict);

#endif
