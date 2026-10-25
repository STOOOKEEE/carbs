# carbs: post-quantum passkeys in the Security Key app

This directory is Ledger's FIDO2 "Security Key" app ([LedgerHQ/app-security-key](https://github.com/LedgerHQ/app-security-key), branch `main`, commit `1fce46957b5d155cc2d5d47d2cea6840e50b3b23`, app 1.7.8), imported unmodified in its own commit (see `../UPSTREAM.md`). The commits after the import add one thing: **ML-DSA-44 credentials** (COSE algorithm -48), so that a Ledger Stax becomes a post-quantum WebAuthn authenticator. With the XRPL passkey path (a parallel task adds ML-DSA-44 passkeys to rippled), such a credential signs XRPL transactions: `SigningPubKey` is the raw 1,312-byte ML-DSA-44 public key and `PasskeySignature.Signature` the raw 2,420-byte signature over `authenticatorData || SHA-256(clientDataJSON)`.

`git diff <import commit> HEAD -- security-key-app` shows every change; find the import commit with `git log --diff-filter=A --format=%h -- security-key-app/Makefile`.

## What the app does now

| Command                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| authenticatorGetInfo         | Gains the `algorithms` member (0x0A, upstream had it commented out): ES256, EdDSA, ES256K, then ML-DSA-44 (-48) when the request came over USB CTAPHID.                                                                                                                                                                                                                                                                           |
| authenticatorMakeCredential  | Accepts -48 in `pubKeyCredParams`, in its place in the list (the app keeps the first algorithm it supports, as before). The credential's public key is a COSE **AKP** key `{1 (kty): 7, 3 (alg): -48, -1 (pub): bstr(1312)}` (draft-ietf-cose-dilithium), generated in place in the authenticator data. Attestation is unchanged: `packed` ES256 over `authData \|\| clientDataHash`; a side-loaded build signs it with the app's **public TEST attestation key**, under Ledger's AAGUID (see "Attestation of a side-loaded build"). |
| authenticatorGetAssertion    | For an ML-DSA-44 credential, re-derives the key pair and signs `authenticatorData \|\| clientDataHash` with pure ML-DSA-44 and an empty context (FIPS 204 ML-DSA.Sign, hedged), the 2,420-byte signature in the `signature` member. Resident and non-resident credentials go through the same code (see "Resident keys").                                                                                                          |
| Screens                      | None added or changed. The device shows the usual registration and login reviews; the algorithm is not displayed.                                                                                                                                                                                                                                                                                                                 |

### Key derivation

A credential's ML-DSA-44 key pair is derived, never stored, in the app's own style for its ECDSA keys (`src/crypto.c`, `src/mldsa_credential.c`):

```
xi       = SHA256((3 << 128 | nonce) || privateKeySeed)     role 3; the ECDSA key is role 0, credRandom 1 and 2
(pk, sk) = ML-DSA-44.KeyGen_internal(xi)                    FIPS 204 Algorithm 6, SDK MLDSA_internal_keygen
```

`nonce` is the credential's 16-byte random nonce, carried AES-SIV encrypted in its credential ID (or in the resident-key storage), and `privateKeySeed` is derived by the app from the device seed (`src/config.c`). The same credential ID on a device holding the same 24 words gives the same key pair. The deterministic key generation is an internal SDK function (`lib_cxng/src/cx_mldsa_internal.h`), the same one `ledger-app/src/pq/pq_root.c` uses, because the public `lcx_mldsa.h` only has the random `MLDSA_keygen`.

### Memory (Ledger Stax, 36 KB of SRAM)

ML-DSA is not exported by the OS crypto library, so the SDK sources (`lib_cxng/src/cx_mldsa*.c`) are compiled in with `HAVE_MLDSA_OPTIMIZATION`, which selects their **low-RAM** variant, as in `ledger-app/` (Makefile). Measured on the build (`debug/app.map`):

|                                  | upstream 1.7.8 | with ML-DSA-44 | change                                                      |
| -------------------------------- | -------------- | -------------- | ----------------------------------------------------------- |
| `.bss` (`_bss` to `_ebss`)       | 11,094 B       | 14,830 B       | +3,736 B: `responseBuffer` 1,032 → 3,445, `sharedBuffer` 500 → 1,822 |
| Stack (`_stack` to `_estack`)    | 25,760 B       | 22,024 B       |                                                             |
| Deepest ML-DSA path (estimate)   |                | 12,680 B       | `get_assertion_confirm` down to the SHAKE syscall           |

- **No new buffer for keys or signatures.** The secret key (2,560 B) lives on the stack for one call and is wiped. The public key is generated where it is sent: in the COSE key inside the authenticator data at registration, in the signature buffer (then overwritten by the signature) at login. The 2,420-byte signature is computed at the end of `responseBuffer`, which nothing uses yet, and the CBOR encoder moves it into place behind the credential ID and the authenticator data (`memmove`); a check refuses a credential ID that would reach it.
- **The two buffers that grow** are the CTAP2 response (an assertion is about 2,600 to 3,000 B, a registration about 2,250 B) and the buffer the authenticator data of a registration is built in (it now carries the 1,322-byte COSE key).
- **`CUSTOM_IO_APDU_BUFFER_SIZE` stays 1,031.** It sizes five SDK buffers (`G_io_rx_buffer`, `G_io_tx_buffer`, the USB, NFC and BLE buffers) and two app buffers, so raising it would cost about seven times the increase. A CTAPHID response is sent by the SDK's HID transport straight from the app's buffer (`lib_stusb/src/usbd_ledger_hid_u2f.c`, `lib_u2f/src/u2f_transport.c`), so it is not bound by it; requests stay small.
- **Stack estimate.** Built once with `CC="clang -fstack-usage"`, the frame sizes summed along the direct call graph of `debug/app.asm`: 12,680 B from `get_assertion_confirm` (ML-DSA signing: `MLDSA_internal_sign_core` alone is 7,800 B, `mldsa_credential_sign` 2,616 B with the secret key) and 7,776 B from `ctap2_make_credential_confirm` (key generation). Indirect calls, the UI and IO frames above these functions and the OS side of syscalls are not counted, which leaves about 9 KB of the 22,024 B for them. This is an estimate from the build, **not a measurement on the device**.

### Transports

An ML-DSA-44 response does not fit the 1,031-byte APDU buffer, so ML-DSA-44 is offered only where the response goes out over **USB CTAPHID** (`ctap2_large_response_supported()` in `src/ctap2/ctap2_utils.c`): CTAP2 proxied in a U2F_MSG APDU and NFC copy the response into the IO buffer. There, makeCredential skips -48 like an unknown algorithm (and answers `CTAP2_ERR_UNSUPPORTED_ALGORITHM` if it was the only one), getInfo does not list it, and getAssertion of an ML-DSA-44 credential answers `CTAP2_ERR_UNSUPPORTED_ALGORITHM`. In an allowList, an ML-DSA-44 credential is skipped on those transports as an unusable candidate (`handle_allowList_item`), so a classical credential later in the list is used instead of the whole request failing. A nonce pre-generated while NFC was idle can be taken by a USB registration; the ML-DSA key is then derived from it and the nonce is consumed as for the other algorithms.

### Attestation of a side-loaded build

The production attestation keys are passed at build time (`PROD_FIDO2_STAX_PRIVATE_KEY` and the like, Makefile) and only Ledger has them; without them the app uses the **test** key and certificate of `attestations/data/test/`, whose private key is public in the app's repository. A side-loaded build, this one included, therefore attests with a key anyone has, under the same AAGUID as the store app (`src/ctap2/aaguid.c`), and its test certificate carries the same names as the production one ("Ledger Stax FIDO 2 Attestation Batch 1", issued by "Ledger FIDO Attestation CA"). Its attestation proves nothing about the hardware: an RP that verifies the chain against Ledger's production root rejects it (checked with `openssl verify`: the Stax test certificate fails against `attestations/data/prod/ca-cert.pem` and passes against the test CA), and one that does not verify the chain cannot tell it from a genuine one. `carbs/mldsa_passkey_test.py` says which certificate it got by comparing it with both folders. The AAGUID is left unchanged: a separate one would be unregistered (no FIDO metadata), and it would also change what the classical credentials of this build report; it would be the right move for any distribution of a modified build. Not for production use.

### Keepalive

CTAP asks for a KEEPALIVE every 100 ms while the authenticator works. The app sends one right before and right after each ML-DSA-44 computation (`ctap2_send_keepalive_processing`), but none during it: the SDK's key generation and signing are single calls that cannot yield. A platform with a short timeout could give up during a long signature; python-fido2 waits. The signing time on the Stax is not measured.

### U2F

U2F authenticate (`src/u2f_processing.c`) accepts any CTAP2 credential ID and signs with the ES256 key derived from its nonce, an upstream behaviour for every non-ES256 credential. For an ML-DSA-44 credential that is the role-0 ECDSA key of the same nonce, a key no relying party holds, so nothing can be forged with it; it is left as upstream.

### Devices

`HAVE_MLDSA_CREDENTIALS` is set for Stax, Flex and Apex P (RAM). All five targets of the image build (Stax, Flex, Apex P with ML-DSA; Nano X and Nano S Plus without, unchanged behaviour). Only the Stax is the owner's device.

### Resident keys

The app is built with `ENABLE_RK_CONFIG` and without `ENABLE_RK_CONFIG_UI_SETTING`, so resident (discoverable) credentials are off and cannot be turned on (upstream choice, see its README). On the device, ML-DSA-44 credentials are therefore **non-resident** only. The resident path (credential rewrapped inside the response buffer, user entity after the signature) is covered by a unit test, not by the device.

## Build

In the `ledger-app-builder-lite` image (no Speculos, no other image), from the repository root:

```sh
docker run --rm -v "$PWD:/app" -w /app/security-key-app \
  ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder-lite:latest \
  make BOLOS_SDK=/opt/stax-secure-sdk APP_DIR=/app
```

Output: `security-key-app/bin/app.hex`, `bin/app.apdu`, `debug/app.map` (git-ignored). `APP_DIR=/app` is needed when the checkout is a git worktree: the SDK runs `git rev-parse --show-toplevel`, and a worktree's `.git` file points outside the mounted directory, which fails with a warning and then `undefined symbol: app_main` (see `docs/ledger-dx-feedback.md`). Other devices: `BOLOS_SDK=/opt/flex-secure-sdk`, `/opt/apex-secure-sdk`, `/opt/nanox-secure-sdk`, `/opt/nanosplus-secure-sdk`.

## Unit tests

```sh
docker run --rm -v "$PWD:/app" -w /app/security-key-app/unit-tests -e BOLOS_SDK=/opt/stax-secure-sdk \
  ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder-lite:latest \
  sh -c 'cmake -B build -S . && cmake --build build && ctest --test-dir build --output-on-failure'
```

The SDK's LedgerUT (Unity, CMock) ships in the image. Seven suites are ours, built with `HAVE_MLDSA_CREDENTIALS` (the upstream suites keep the configuration of the other devices):

| Suite                               | What it proves                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_mldsa_cose`                   | The AKP key encodes to `A3 01 07 03 38 2F 20 59 05 20` then the 1,312 reserved bytes, and decodes back; refused (fault, nothing reserved) one byte short or after an earlier fault; `cbip_reserve_byte_string` header sizes and wrapped length.       |
| `test_mldsa_credential`             | The nonce's seed reaches the key generation; the COSE key is generated in place; signing is ML-DSA-44 with a NULL, zero-length context over the given message with the key generation's secret key; the seed and secret key are wiped on every path, and the signature buffer too when signing fails (the SDK leaves rejected candidates in it). |
| `test_mldsa_seed`                   | The seed hashes `0…0 03 ‖ nonce` then `privateKeySeed`, role 3 where the ECDSA key of the same nonce has role 0; the block is wiped.                                                                                                                  |
| `test_mldsa_get_assertion`          | Decoding the assertion: the 2,420-byte signature arrives intact behind the credential and authData, resident (with user entity and count) or not; the message is `authData ‖ clientDataHash`; the nonce is read before the rewrap; an oversized credential ID is refused; refused over an APDU transport; in a mixed allowList over an APDU transport the ML-DSA-44 credential is skipped and the ES256 one after it signs; a user entity that does not fit is an error, not a truncated reply; an ES256 assertion still carries its own signature in a response within 1,031 bytes. |
| `test_mldsa_make_credential`        | Decoding the registration: authData carries the credential ID then the AKP key of the credential's own nonce (fresh or pre-generated), attestation `packed` ES256, response over 1,031 bytes, nonce wiped; a key failure answers `CTAP2_ERR_OTHER`. |
| `test_mldsa_make_credential_params` | -48 is chosen in its place in `pubKeyCredParams` over CTAPHID, skipped over an APDU transport, `UNSUPPORTED_ALGORITHM` when alone there.                                                                                                              |
| `test_mldsa_get_info`               | `algorithms` lists ES256, EdDSA, ES256K, ML-DSA-44 over CTAPHID and not -48 elsewhere.                                                                                                                                                                |

Six mutations were each caught, then reverted: role 3 → 0; the transport check removed from `pubKeyCredParams`; `clientDataHash` not appended to the signed message; the allowList skip removed; the signature buffer not wiped on failure; the encoder fault check of the assertion removed. Result on the final tree: 17 of 18 suites pass; `test_client_pin` (upstream, untouched) crashes in AddressSanitizer at process exit on this arm64 image, and does the same on the unmodified import.

What the unit tests cannot prove: the real ML-DSA. The SDK's ML-DSA calls are faked in them; the real key generation and signature run only on the device, and the host script below checks their output.

## Load on the Stax

From macOS, outside Docker (Docker Desktop does not pass USB through), with `ledgerblue` in a virtual environment:

```sh
python3 -m venv ~/tools/ledger-venv && ~/tools/ledger-venv/bin/pip install ledgerblue
PYTHON=~/tools/ledger-venv/bin/python security-key-app/carbs/load_stax.sh
```

**Sideloading deletes the installed "Security Key" app** (the Ledger Live one or an earlier side-load) with its data (resident keys, FIDO2 PIN, signature counter). Non-resident passkeys made with the store app should keep working, as the derivation from the 24 words is the same (not verified); installing the store app again later deletes this build. The signature counter restarts from the release marker `0xF1D0C001` (Makefile, `HAVE_COUNTER_MARKER`). The script reads the load parameters that `make load` uses for the Stax (target `0x33200004`, API level 27, flags `0x200`, sizes from `debug/app.map`); `--offline file.apdu` writes the load APDUs without a device.

## Test on the device

```sh
python3 -m venv ~/tools/fido-venv && ~/tools/fido-venv/bin/pip install fido2==1.2.0 dilithium-py==1.5.1
~/tools/fido-venv/bin/python security-key-app/carbs/mldsa_passkey_test.py selftest     # SIMULATED, no device
~/tools/fido-venv/bin/python security-key-app/carbs/mldsa_passkey_test.py make --out passkey-signature.json
~/tools/fido-venv/bin/python security-key-app/carbs/mldsa_passkey_test.py assert --challenge-hex <XRPL signing data>
```

`make` runs getInfo (and stops if -48 is not listed), makeCredential with only -48, checks the AKP key (exact parameters, 1,312 bytes) and the packed attestation, saves `mldsa-credential.json`, then runs getAssertion on a test challenge (or `--challenge-hex`, e.g. `STX\0 ‖ fields` of a transaction), verifies the signature on the host with dilithium-py (pure ML-DSA-44, empty context; a one-bit change of the message must fail), and prints `SigningPubKey` and `PasskeySignature {PasskeyID, AuthenticatorData, ClientDataJSON, Signature}` with the clientDataJSON shape of `@carbs/core`. `--pin` is for a FIDO2 PIN set in the app. `node security-key-app/carbs/verify_noble.mjs passkey-signature.json` cross-checks the same output with `@noble/post-quantum` 0.7.1, the library `@carbs/core` pins. The device asks for approval twice (registration, then login); after each approval it computes for an unmeasured time with no CTAPHID keepalive (python-fido2 waits).

## What was and was not verified

| Claim                                                                                         | Status                                                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Builds for Stax, Flex, Apex P (with ML-DSA) and Nano X, Nano S Plus (without)                 | Verified (ledger-app-builder-lite, image `3561f39cb806`).                                                      |
| COSE AKP encoding, derivation chain, buffer layout, getInfo, wiping                           | Verified by the unit tests above (SDK ML-DSA faked).                                                           |
| What each transport gets (CTAPHID vs U2F_MSG and NFC)                                         | **Only the logic** that follows the transport check is tested: `ctap2_large_response_supported()` is mocked in every suite. The check itself (`CMD_IS_OVER_CTAP2_CBOR_CMD && !CMD_IS_OVER_U2F_NFC`) and the real transports are not tested. |
| The host script's parsing, verification and XRPL output                                       | Verified with `selftest` (**SIMULATED** software authenticator); dilithium-py and `@noble/post-quantum` agree on its signature and on `KeyGen_internal(seed)`; python-fido2 1.2.0 parses an AKP key and a 2,420-byte signature. |
| `carbs/load_stax.sh` passes the parameters of `make load`                                       | Verified: with `--offline`, its APDU stream is byte-identical to the `bin/app.apdu` that `make` writes (ledgerblue of the image). |
| The app on a real Stax: load, register, sign, signature verifies                              | **Not run.** No Stax was connected when this was built.                                                         |
| Attestation proving a genuine Ledger                                                          | **No**: a side-loaded build attests with the public test key (above).                                          |
| Stack headroom on the device, signing time, keepalive behaviour                               | **Not measured** (static estimate only).                                                                       |
| Browsers (Chrome, Safari, Firefox) with -48 through `navigator.credentials`                   | **Not tested.** The script talks CTAP2 directly.                                                               |
| An XRPL node accepting the resulting `PasskeySignature`                                       | **Not tested here** (the node side is a parallel task).                                                        |
| Side-channel resistance of the low-RAM ML-DSA on the device                                   | **Not claimed** (same SDK code as `ledger-app/`).                                                              |
