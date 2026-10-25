#pragma once

/* Test double of the SDK's lib_cxng/src/cx_mldsa_internal.h for test_pq_root:
 * the deterministic key generation, recorded by the test. */

#include "lcx_mldsa.h"

cx_err_t MLDSA_internal_keygen(uint8_t *pk,
                               size_t pk_len,
                               uint8_t *sk,
                               size_t sk_len,
                               const uint8_t seed[MLDSA_SEEDBYTES],
                               MLDSA_param_t param);
