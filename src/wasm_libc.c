/* Freestanding byte operations used by compiler-generated structure copies. */
#include <stddef.h>
void *memcpy(void *dst, const void *src, size_t count) {
    unsigned char *d = dst;
    const unsigned char *s = src;
    for (size_t i = 0; i < count; ++i) d[i] = s[i];
    return dst;
}
void *memset(void *dst, int value, size_t count) {
    unsigned char *d = dst;
    for (size_t i = 0; i < count; ++i) d[i] = (unsigned char)value;
    return dst;
}
void *memmove(void *dst, const void *src, size_t count) {
    unsigned char *d = dst;
    const unsigned char *s = src;
    if (d < s) for (size_t i = 0; i < count; ++i) d[i] = s[i];
    else for (size_t i = count; i > 0; --i) d[i-1] = s[i-1];
    return dst;
}
