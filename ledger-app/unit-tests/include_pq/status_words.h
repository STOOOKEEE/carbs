#pragma once

/* Test double of the SDK's include/status_words.h for test_pq_root: the
 * ISO 7816 status words src/pq/pq_root.c uses, with the SDK's values. */

#define SWO_WRONG_LENGTH                     0x6700
#define SWO_SECURITY_CONDITION_NOT_SATISFIED 0x6982
#define SWO_CONDITIONS_NOT_SATISFIED         0x6985
#define SWO_INCORRECT_DATA                   0x6a80
#define SWO_WRONG_P1_P2                      0x6b00
#define SWO_UNKNOWN                          0x6f00
#define SWO_SUCCESS                          0x9000
