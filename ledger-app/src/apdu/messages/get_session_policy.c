/*******************************************************************************
 *   carbs: INS_GET_SESSION_POLICY (see get_session_policy.h).
 ********************************************************************************/

#include "get_session_policy.h"

#include <os.h>

#include "globals.h"
#include "io.h"
#include "ledger_assert.h"
#include "session_policy.h"
#include "status_words.h"

int handle_get_session_policy(uint8_t p1, uint8_t p2) {
    if (p1 != 0 || p2 != 0) {
        return io_send_sw(SWO_WRONG_P1_P2);
    }

    session_policy_t policy = N_storage.session_policy;
    uint8_t buf[SESSION_POLICY_SERIALIZED_SIZE];
    size_t length = session_policy_serialize(&policy, buf, sizeof(buf));
    LEDGER_ASSERT(length == sizeof(buf), "session policy size");
    return io_send_response_pointer(buf, length, SWO_SUCCESS);
}
