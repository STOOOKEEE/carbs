#pragma once

/* Test double of the SDK's lcx_mldsa.h for test_pq_root: the sizes of
 * ML-DSA-44 (FIPS 204) and the signing entry point, recorded by the test. */

#include <stddef.h>
#include <stdint.h>

#include "cx.h"

#define MLDSA44_PUBLICKEYBYTES 1312
#define MLDSA44_SECRETKEYBYTES 2560
#define MLDSA44_SIGBYTES       2420
#define MLDSA_SEEDBYTES        32

typedef enum { MLDSA_44 = 2 } MLDSA_param_t;

cx_err_t MLDSA_sign(uint8_t *sig,
                    size_t sig_max_len,
                    size_t *sig_len,
                    const uint8_t *m,
                    size_t mlen,
                    const uint8_t *ctx,
                    size_t ctxlen,
                    const uint8_t *sk,
                    size_t sk_len,
                    MLDSA_param_t param);
