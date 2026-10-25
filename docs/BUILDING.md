# Building and running

## TypeScript packages

```sh
pnpm install            # Node >= 22.18, pnpm 10.33.0 (see .nvmrc and package.json)
pnpm format:check
pnpm typecheck
pnpm test
```

## The daemon (`rippled/`), macOS on Apple silicon

Recorded from a working build: Apple clang 17, CMake 4.x, Ninja, Python 3, Conan 2.32.0, Debug configuration. With a warm Conan cache (the dependencies were already built for the same Conan profile) the 853 build steps took about 7 minutes on a 10-core machine; a cold cache means building every dependency first and takes much longer. The build tree is about 4 GB and `xrpld` about 0.5 GB.

```sh
# Conan 2.32.0 in its own virtual environment
python3 -m venv ~/tools/conan-venv && ~/tools/conan-venv/bin/pip install "conan==2.32.0"
export PATH="$HOME/tools/conan-venv/bin:/opt/homebrew/bin:$PATH"

cd rippled
./conan/init.sh                    # installs the profiles, global.conf and the xrplf remote

mkdir -p build && cd build         # rippled/build is git-ignored
conan install .. --output-folder . --build missing --settings build_type=Debug
cmake -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE:FILEPATH="$PWD/build/generators/conan_toolchain.cmake" \
  -DCMAKE_BUILD_TYPE=Debug -Dxrpld=ON -Dtests=ON ..
cmake --build . --parallel "$(sysctl -n hw.ncpu)" --target xrpld

./xrpld --version                  # xrpld version 3.4.1+DEBUG
./xrpld --unittest=PasskeyListSet  # 11 cases, 250 tests, 0 failures on the imported tree
```

Notes:

- Conan puts its generated files in `build/build/generators` when the output folder is `build`; the toolchain path above matches that.
- The default Conan profile in this repository's configuration sets `build_type=Debug`; keep the same build type as the cached dependencies, or Conan rebuilds them.
- Protocol codes and generated code are regenerated with the `cmake/codegen` targets listed in [ARCHITECTURE.md](ARCHITECTURE.md), for our types only.

## The Ledger app (`ledger-app/`)

Built in the `ledger-app-builder` Docker image with `make BOLOS_SDK=$STAX_SDK`; loaded on a device from the host, because Docker Desktop on macOS does not pass USB to a container. The loading route (`ledgerctl`, `ledgerblue` or Ledger Dev Tools) is decided when the baseline is loaded and recorded in [DEVLOG.md](DEVLOG.md). Unit tests are a CMake project:

```sh
cmake -S ledger-app/unit-tests -B build/ledger-unit && cmake --build build/ledger-unit && ctest --test-dir build/ledger-unit
```

They need cmocka and OpenSSL. Run natively on macOS (Apple clang 17, arm64) with cmocka 1.1.7 built from its release tarball into a scratch prefix and Homebrew's `openssl@3`. Two local workarounds, no change to the project: `CMakeLists.txt` links `-lgcov`, which Apple clang does not ship, so an empty `libgcov.a` in a scratch directory is put on the linker path; `test_tx` opens its vectors by the relative path `../../tests/standalone/testcases`, so it runs from `ledger-app/unit-tests/src` (or a build directory two levels under `ledger-app/`). `test_pq_root` finds its vectors by an absolute path set at configure time.

```sh
cmake -S ledger-app/unit-tests -B <build> -G Ninja \
  -DCMAKE_C_FLAGS="-I<cmocka>/include -I$(brew --prefix openssl@3)/include" \
  -DCMAKE_EXE_LINKER_FLAGS="-L<gcov-shim> -L<cmocka>/lib -L$(brew --prefix openssl@3)/lib -Wl,-rpath,<cmocka>/lib"
cmake --build <build>
(cd ledger-app/unit-tests/src && for t in test_printers test_swap test_tx test_pq_root; do <build>/$t; done)
```
