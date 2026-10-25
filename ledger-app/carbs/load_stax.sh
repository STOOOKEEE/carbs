#!/usr/bin/env bash
# carbs: side-load the XRP app of this repository, built for the Ledger Stax (bin/app.hex,
# debug/app.map), from macOS, with ledgerblue, outside Docker (Docker Desktop does not pass
# USB through).
#
# WARNING: this deletes the "XRP" app installed on the device (from Ledger Live or an earlier
# side-load) and its settings (blind signing, session policy) before installing this build.
# The classical XRP keys do not change (same derivation from the 24 words). The ML-DSA-44 key
# of a build with the SLIP-21 seed fix is NOT the one of earlier builds (docs/DEVLOG.md).
#
# Before: the Stax connected over USB, unlocked, on the dashboard (no app open). A locked
# device answers 0x5515, an open app 0x6d00 (docs/ledger-dx-feedback.md).
# On the device: approve each prompt of the install; ledgerblue prints "Broken certificate
# chain - loading from user key", which is expected for a side-loaded app and not an error.
#
# Usage: ledger-app/carbs/load_stax.sh [--offline out.apdu]
#   --offline writes the load APDUs to a file instead of talking to a device (no device needed).
# Needs: python3 -m pip install ledgerblue   (in a virtual environment)
# The parameters are those `make load` prints for TARGET_STAX in ledger-app-builder-lite
# (`make -n load BOLOS_SDK=/opt/stax-secure-sdk`): targetId 0x33200004, API level 27,
# appName XRP, flags 0xa00, sizes read from debug/app.map.
set -euo pipefail

cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
MAP=debug/app.map
HEX=bin/app.hex
[ -f "$HEX" ] && [ -f "$MAP" ] || { echo "build first: no $HEX / $MAP (docs/BUILDING.md)" >&2; exit 1; }
grep -q "HAVE_PQ_ROOT" Makefile || { echo "not the carbs Makefile" >&2; exit 1; }
grep -q "stax" "$MAP" || { echo "$MAP is not a Stax build" >&2; exit 1; }

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
    --fileName "$HEX" --appName XRP --appFlags 0xa00 \
    --delete --tlv --dataSize "$data_size" --installparamsSize "$params_size" \
    ${extra[@]+"${extra[@]}"}
