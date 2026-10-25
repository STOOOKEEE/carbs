"""carbs: session policy (src/policy/session_policy.h).

The policy is set on the device itself, by touching its settings, as a user
would: the host can only read it (INS 0x08). The backend is shared by the whole
session (conftest.py), so the test turns the policy off again when it ends.
"""

from pathlib import Path

import pytest
from ledgered.devices import Device, DeviceType  # type: ignore [import]
from ragger.backend import BackendInterface, RaisePolicy
from ragger.error import ExceptionRAPDU
from ragger.navigator import Navigator, NavIns, NavInsID
from ragger.navigator.navigation_scenario import NavigateWithScenario

from .utils import DEFAULT_BIP32_PATH, verify_ecdsa_secp256k1
from .xrp import Errors, XRPClient

CLA = 0xE0
INS_GET_SESSION_POLICY = 0x08
SW_SESSION_POLICY_REFUSED = 0x6986

POLICY_VERSION = 1
FLAG_ENABLED = 0x01
DROPS_PER_XRP = 1_000_000

TESTCASES = Path(__file__).parent / "testcases" / "33-session-policy"
WITHIN_POLICY = TESTCASES / "01-within-policy.raw"
ABOVE_POLICY = TESTCASES / "02-above-policy.raw"


def _policy_bytes(flags: int, max_cap: int, max_per_tx: int = 0, max_duration: int = 0) -> bytes:
    return (
        bytes([POLICY_VERSION, flags])
        + max_cap.to_bytes(8, "big")
        + max_per_tx.to_bytes(8, "big")
        + max_duration.to_bytes(4, "big")
    )


def _get_policy(backend: BackendInterface) -> bytes:
    reply = backend.exchange(CLA, INS_GET_SESSION_POLICY, 0, 0)
    assert reply.status == Errors.SW_SUCCESS
    return reply.data


def _first_row(device: Device) -> tuple[int, int]:
    # First element of a settings page, where the blind signing test touches
    # its switch (functional_test.py)
    if device.type is DeviceType.APEX_P:
        return (263, 95)
    return (348, 132)


def _toggle_policy(device: Device, navigator: Navigator) -> None:
    # Page 1 of the settings: "Session policy" is its first switch
    navigator.navigate(
        [
            NavInsID.USE_CASE_HOME_SETTINGS,
            NavInsID.USE_CASE_SETTINGS_NEXT,
            NavIns(NavInsID.TOUCH, _first_row(device)),
            NavInsID.USE_CASE_SETTINGS_MULTI_PAGE_EXIT,
        ],
        screen_change_before_first_instruction=False,
    )


def _set_max_spend_50_xrp(device: Device, navigator: Navigator) -> None:
    # "Max spend" is the first limit; each tap moves to the next preset:
    # no limit -> XRP 10 -> XRP 50
    row = NavIns(NavInsID.TOUCH, _first_row(device))
    navigator.navigate([NavInsID.USE_CASE_HOME_SETTINGS], screen_change_before_first_instruction=False)
    navigator.navigate_until_text(
        navigate_instruction=NavInsID.USE_CASE_SETTINGS_NEXT,
        validation_instructions=[row, row, NavInsID.USE_CASE_SETTINGS_MULTI_PAGE_EXIT],
        text="^Max spend",
        screen_change_before_first_instruction=False,
    )


def test_get_session_policy_default(backend: BackendInterface) -> None:
    """Fresh install: policy off, no limit."""
    assert _get_policy(backend) == _policy_bytes(0, 0)


def test_get_session_policy_wrong_p1p2(backend: BackendInterface) -> None:
    backend.raise_policy = RaisePolicy.RAISE_ALL_BUT_0x9000
    with pytest.raises(ExceptionRAPDU) as err:
        backend.exchange(CLA, INS_GET_SESSION_POLICY, 1, 0)
    assert err.value.status == Errors.SW_INVALIDP1P2


def test_session_policy(
    backend: BackendInterface,
    device: Device,
    navigator: Navigator,
    scenario_navigator: NavigateWithScenario,
    test_name: str,
    default_screenshot_path: Path,
) -> None:
    """Max spend 50 XRP: a 20 XRP session signs, a 500 XRP one is refused."""
    if backend.device.is_nano:
        pytest.skip("Settings are set by touch in this test")

    xrp = XRPClient(backend, navigator)
    backend.wait_for_home_screen()
    _toggle_policy(device, navigator)
    try:
        _set_max_spend_50_xrp(device, navigator)
        assert _get_policy(backend) == _policy_bytes(FLAG_ENABLED, 50 * DROPS_PER_XRP)

        # Within the policy: the usual review, then the signature
        tx = WITHIN_POLICY.read_bytes()
        backend.wait_for_home_screen()
        with xrp.sign(DEFAULT_BIP32_PATH + tx):
            scenario_navigator.review_approve(
                test_name=f"33-session-policy/{WITHIN_POLICY.stem}",
                custom_screen_text="^Hold to sign$",
            )
        reply = xrp.get_async_response()
        assert reply and reply.status == Errors.SW_SUCCESS
        verify_ecdsa_secp256k1(tx, reply.data, str(WITHIN_POLICY))

        # Above it: refused before any review
        backend.wait_for_home_screen()
        backend.raise_policy = RaisePolicy.RAISE_ALL_BUT_0x9000
        with pytest.raises(ExceptionRAPDU) as err:
            with xrp.sign(DEFAULT_BIP32_PATH + ABOVE_POLICY.read_bytes()):
                pass  # answered synchronously by ui_session_policy_refusal()
        assert err.value.status == SW_SESSION_POLICY_REFUSED

        navigator.navigate_until_text_and_compare(
            navigate_instruction=NavInsID.USE_CASE_CHOICE_REJECT,
            validation_instructions=[NavInsID.USE_CASE_CHOICE_CONFIRM],
            text="Blocked by your",
            path=default_screenshot_path,
            test_case_name=test_name,
        )
        backend.wait_for_home_screen()
    finally:
        _toggle_policy(device, navigator)

    assert _get_policy(backend) == _policy_bytes(0, 50 * DROPS_PER_XRP)
