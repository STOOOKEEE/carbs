/*******************************************************************************
 *   carbs: INS_GET_SESSION_POLICY, the session policy read by the host.
 ********************************************************************************/

#ifndef LEDGER_APP_XRP_GETSESSIONPOLICY_H
#define LEDGER_APP_XRP_GETSESSIONPOLICY_H

#include <stdint.h>

// P1 = P2 = 0, no data. Answers the bytes of session_policy_serialize().
int handle_get_session_policy(uint8_t p1, uint8_t p2);

#endif  // LEDGER_APP_XRP_GETSESSIONPOLICY_H
