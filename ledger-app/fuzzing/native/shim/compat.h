#pragma once
#include <stddef.h>
#if defined(__APPLE__)
static inline void explicit_bzero(void *p, size_t n) {
    volatile unsigned char *b = (volatile unsigned char *)p;
    while (n--) *b++ = 0;
}
#endif
