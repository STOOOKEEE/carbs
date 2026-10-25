"""carbs: a session transaction is clear-signed or refused, never blind-signed.

The Agent ID row itself is covered by test_sign_valid_tx in functional_test.py
(testcases/34-session-agent-id/01-agent-id.raw and its snapshots).
"""

from pathlib import Path

import pytest
from ledgered.devices import Device  # type: ignore [import]
from ragger.backend import BackendInterface, RaisePolicy
from ragger.error import ExceptionRAPDU
from ragger.navigator import Navigator

from .functional_test import _enable_blind_signing
from .utils import DEFAULT_BIP32_PATH
from .xrp import XRPClient

TESTCASES = Path(__file__).parent / "testcases" / "34-session-agent-id"

# parse_tx() result SESSION_BLIND_SIGN_REFUSED (21), answered as 0x6800 | code
# (ledger-app/src/xrp/signing_session.h, sign_transaction.c).
SW_SESSION_BLIND_SIGN_REFUSED = 0x6815

# "Session transactions are never blind-signed", matched on any line it wraps to.
REFUSAL_SCREEN_TEXT = ".*never"


@pytest.mark.parametrize(
    "name",
    [
        "02-unknown-field-refused",  # a field the app cannot name
        "03-batch-session-refused",  # a Batch that would go blind, holding a session
    ],
)
def test_session_never_blind_signed(backend: BackendInterface, device: Device, navigator: Navigator, name: str):
    """Refused with the blind-signing setting on (Nano has no setting: refused all the same)."""
    if not backend.device.is_nano:
        _enable_blind_signing(device, navigator)

    xrp = XRPClient(backend, navigator)
    tx = (TESTCASES / f"{name}.raw").read_bytes()

    backend.wait_for_home_screen()
    backend.raise_policy = RaisePolicy.RAISE_ALL_BUT_0x9000
    with pytest.raises(ExceptionRAPDU) as err:
        with xrp.sign(DEFAULT_BIP32_PATH + tx):
            pass  # refused before any review: no blind-signing offer
    assert err.value.status == SW_SESSION_BLIND_SIGN_REFUSED

    backend.wait_for_text_on_screen(REFUSAL_SCREEN_TEXT)
    backend.wait_for_home_screen()
