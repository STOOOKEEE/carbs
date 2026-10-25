#pragma once

/* Test double of the SDK's io.h for test_pq_root: the answers are recorded
 * by the test (src/test_pq_root.c). */

#include <stddef.h>
#include <stdint.h>

extern uint8_t G_io_apdu_buffer[260];

int io_send_sw(uint16_t sw);
int io_send_response_pointer(const uint8_t *ptr, size_t size, uint16_t sw);
