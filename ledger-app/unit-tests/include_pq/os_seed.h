#pragma once

/* Test double of the SDK's os_seed.h for test_pq_root. */

#include "cx.h"

#define HDW_SLIP21 2

cx_err_t os_derive_bip32_with_seed_no_throw(unsigned int derivation_mode,
                                            cx_curve_t curve,
                                            const unsigned int *path,
                                            unsigned int path_length,
                                            unsigned char raw_privkey[64],
                                            unsigned char *chain_code,
                                            unsigned char *seed_key,
                                            unsigned int seed_key_length);
