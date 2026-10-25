#!/usr/bin/env bash
# carbs: side-load the Security Key app built for the Ledger Stax (bin/app.hex, debug/app.map)
# from macOS, with ledgerblue, outside Docker (Docker Desktop does not pass USB through).
#
# WARNING: this deletes the "Security Key" app installed on the device (from Ledger Live or
# an earlier side-load) and its data (resident keys, FIDO2 PIN, signature counter) before
# installing this build. Non-resident passkeys made with the store app should keep working
# (same key derivation from the 24 words; NOT verified), and installing the store app again
# later deletes this build in turn.
#
# Before: the Stax connected over USB, unlocked, on the dashboard (no app open). A locked
# device answers 0x5515, an open app 0x6d00 (docs/ledger-dx-feedback.md).
# On the device: approve each prompt of the install (the wording depends on the OS version);
# ledgerblue prints "Broken certificate chain - loading from user key", which is expected for
# a side-loaded app and not an error.
#
# Usage: security-key-app/carbs/load_stax.sh [--offline out.apdu]
#   --offline writes the load APDUs to a file instead of talking to a device (no device needed).
# Needs: python3 -m pip install ledgerblue   (in a virtual environment)
# The parameters are those of `make load` for TARGET_STAX in the SDK of ledger-app-builder-lite
# (Makefile.standard_app), read from the build: targetId 0x33200004, API level 27, flags 0x200.
set -euo pipefail

cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
MAP=debug/app.map
HEX=bin/app.hex
[ -f "$HEX" ] && [ -f "$MAP" ] || { echo "build first: no $HEX / $MAP (see CARBS.md)" >&2; exit 1; }
grep -q "HAVE_MLDSA_CREDENTIALS" Makefile || { echo "not the carbs Makefile" >&2; exit 1; }

symbol() { grep -E " $1 = \." "$MAP" | head -1 | awk '{print $1}'; }
nvram=$(symbol _nvram_data)
envram=$(symbol _envram_data)
install=$(symbol _install_parameters)
einstall=$(symbol _einstall_parameters)
data_size=$((0x$envram - 0x$nvram))
params_size=$((0x$einstall - 0x$install))

extra=()
if [ "${1:-}" = "--offline" ]; then
    extra=(--offline "${2:?--offline needs a file}")
fi

echo "Loading $HEX (sha256 $(shasum -a 256 "$HEX" | cut -c1-16)...), dataSize $data_size, installparamsSize $params_size"
exec "$PYTHON" -m ledgerblue.loadApp \
    --targetId 0x33200004 --targetVersion="" --apiLevel 27 \
    --fileName "$HEX" --appName "Security Key" --appFlags 0x200 \
    --delete --tlv --dataSize "$data_size" --installparamsSize "$params_size" --nocrc \
    ${extra[@]+"${extra[@]}"}
