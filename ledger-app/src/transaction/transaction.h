/*******************************************************************************
 *   XRP Wallet
 *   (c) 2020 Towo Labs
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

#ifndef LEDGER_APP_XRP_TRANSACTION_H
#define LEDGER_APP_XRP_TRANSACTION_H

#include "xrp_parse.h"
#include "common.h"

typedef void (*resultAction_t)(unsigned int result);

// carbs: checks the transaction in parse_context against the session policy.
// When it does not fit, shows the refusal (which answers 0x6986) and
// returns true.
bool refused_by_session_policy(void);

void review_transaction(parseResult_t *transaction,
                        action_t on_approve,
                        action_t on_reject,
                        bool blind_sign);

#endif  // LEDGER_APP_XRP_TRANSACTION_H
