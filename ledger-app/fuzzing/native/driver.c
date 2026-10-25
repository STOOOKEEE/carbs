// A native mutational fuzz loop for the XRP app's transaction parser (no libFuzzer on this
// machine): seeds from the corpus and the test vectors, random mutations, ASan and UBSan.
#include <dirent.h>
#include <sanitizer/common_interface_defs.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);

enum { kMaxInputs = 2048, kMaxLen = 4096 };
static uint8_t *inputs[kMaxInputs];
static size_t lens[kMaxInputs];
static int n_inputs;
static uint8_t cur[kMaxLen];
static size_t cur_len;
static const char *crash_dir;

// <time.h> is shadowed by the app's own src/xrp/time.h on the include path.
static long now_seconds(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long)tv.tv_sec;
}

static void on_death(void) {
    char path[1024];
    snprintf(path, sizeof path, "%s/crash-%ld.bin", crash_dir, now_seconds());
    FILE *f = fopen(path, "wb");
    if (f) {
        fwrite(cur, 1, cur_len, f);
        fclose(f);
        fprintf(stderr, "crash input saved to %s (%zu bytes)\n", path, cur_len);
    }
}

static void load_dir(const char *dir, const char *suffix) {
    DIR *d = opendir(dir);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d)) != NULL && n_inputs < kMaxInputs) {
        if (e->d_name[0] == '.') continue;
        char path[2048];
        snprintf(path, sizeof path, "%s/%s", dir, e->d_name);
        struct stat st;
        if (stat(path, &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) { load_dir(path, suffix); continue; }
        size_t nl = strlen(e->d_name), sl = suffix ? strlen(suffix) : 0;
        if (suffix && (nl < sl || strcmp(e->d_name + nl - sl, suffix) != 0)) continue;
        if (st.st_size <= 0 || st.st_size > kMaxLen) continue;
        FILE *f = fopen(path, "rb");
        if (!f) continue;
        uint8_t *buf = malloc((size_t)st.st_size);
        size_t got = fread(buf, 1, (size_t)st.st_size, f);
        fclose(f);
        inputs[n_inputs] = buf;
        lens[n_inputs] = got;
        n_inputs++;
    }
    closedir(d);
}

static uint32_t rnd(void) { return arc4random(); }

static void insert(size_t p, const uint8_t *src, size_t len) {
    if (cur_len + len > kMaxLen) len = kMaxLen - cur_len;
    if (len == 0) return;
    memmove(cur + p + len, cur + p, cur_len - p);
    memcpy(cur + p, src, len);
    cur_len += len;
}

static void mutate(void) {
    static const uint8_t interesting[] = {0x00, 0xFF, 0x7F, 0x80, 0x01, 0xFE, 0x20, 0xE1, 0xF1, 0xEF};
    int n = 1 + (int)(rnd() % 8);
    for (int i = 0; i < n; i++) {
        switch (rnd() % 8) {
            case 0:
                if (cur_len) cur[rnd() % cur_len] ^= (uint8_t)(1u << (rnd() % 8));
                break;
            case 1:
                if (cur_len) cur[rnd() % cur_len] = interesting[rnd() % sizeof interesting];
                break;
            case 2: {
                uint8_t b = (uint8_t)rnd();
                insert(cur_len ? rnd() % (cur_len + 1) : 0, &b, 1);
                break;
            }
            case 3:
                if (cur_len) {
                    size_t p = rnd() % cur_len;
                    memmove(cur + p, cur + p + 1, cur_len - p - 1);
                    cur_len--;
                }
                break;
            case 4:
                if (cur_len) cur_len = rnd() % cur_len;
                break;
            case 5: {
                int j = (int)(rnd() % (uint32_t)n_inputs);
                if (lens[j]) {
                    size_t off = rnd() % lens[j];
                    size_t len = 1 + rnd() % (lens[j] - off);
                    insert(cur_len ? rnd() % (cur_len + 1) : 0, inputs[j] + off, len);
                }
                break;
            }
            case 6:
                if (cur_len >= 2) {
                    size_t a = rnd() % cur_len, b = rnd() % cur_len;
                    uint8_t t = cur[a];
                    cur[a] = cur[b];
                    cur[b] = t;
                }
                break;
            case 7:
                if (cur_len) {
                    size_t p = rnd() % cur_len, l = 1 + rnd() % (cur_len - p);
                    uint8_t tmp[kMaxLen];
                    memcpy(tmp, cur + p, l);
                    insert(p, tmp, l);
                }
                break;
        }
    }
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: %s <seconds> <crash-dir> <corpus-dir> [vectors-dir]\n", argv[0]);
        return 2;
    }
    int seconds = atoi(argv[1]);
    crash_dir = argv[2];
    load_dir(argv[3], NULL);
    if (argc > 4) load_dir(argv[4], ".raw");
    if (n_inputs == 0) return 2;
    __sanitizer_set_death_callback(on_death);
    fprintf(stderr, "seeds: %d\n", n_inputs);
    unsigned long long execs = 0;
    for (int i = 0; i < n_inputs; i++) {
        memcpy(cur, inputs[i], lens[i]);
        cur_len = lens[i];
        LLVMFuzzerTestOneInput(cur, cur_len);
        execs++;
    }
    long start = now_seconds(), last = start;
    while (now_seconds() - start < seconds) {
        int j = (int)(rnd() % (uint32_t)n_inputs);
        memcpy(cur, inputs[j], lens[j]);
        cur_len = lens[j];
        mutate();
        LLVMFuzzerTestOneInput(cur, cur_len);
        execs++;
        if (now_seconds() - last >= 60) {
            last = now_seconds();
            fprintf(stderr, "%lds: %llu executions\n", last - start, execs);
        }
    }
    fprintf(stderr, "done: %llu executions in %d s, no crash\n", execs, seconds);
    return 0;
}
