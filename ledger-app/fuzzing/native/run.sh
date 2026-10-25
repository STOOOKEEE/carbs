#!/usr/bin/env bash
# Native fuzz loop for the transaction parser, for a machine without the Ledger SDK or a clang
# with libFuzzer (Apple clang): the parser and the policy are built against the SDK test doubles
# of unit-tests/, with AddressSanitizer and UndefinedBehaviorSanitizer, and fed random mutations
# of the ClusterFuzzLite corpus and of every test vector. Not coverage-guided: the real fuzzer is
# fuzzing/ under ClusterFuzzLite (Docker).
#   ledger-app/fuzzing/native/run.sh [seconds]   (default 60; needs Homebrew openssl@3 for cx.c)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$(cd "$here/../.." && pwd)"
out="${TMPDIR:-/tmp}/carbs-native-fuzz"
mkdir -p "$out/crashes"
ossl="$(brew --prefix openssl@3)"
srcs=()
while IFS= read -r src; do srcs+=("$app/${src#../}"); done < <(
  sed -n '/add_library(xrp/,/)/p' "$app/unit-tests/CMakeLists.txt" | tr -d '\r' |
    grep -o '\.\./src/[A-Za-z0-9_/]*\.c'
)
clang -std=c11 -g -O1 -fsanitize=address,undefined -fno-sanitize-recover=undefined \
  -fno-omit-frame-pointer -include "$here/shim/compat.h" -I "$here/shim" \
  -I "$app/unit-tests/include" -I "$app/src" -I "$app/src/xrp" -I "$app/src/apdu/messages" \
  -I "$app/src/apdu" -I "$app/src/policy" -I "$ossl/include" \
  "${srcs[@]}" "$app/unit-tests/src/cx.c" "$app/fuzzing/src/fuzz_tx.c" "$here/driver.c" \
  -L "$ossl/lib" -lcrypto -o "$out/fuzz_native"
"$out/fuzz_native" "${1:-60}" "$out/crashes" "$app/fuzzing/corpus/fuzz_tx" "$app/tests/standalone/testcases"
