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

from .functional_test import _enable_blind_signing
from .utils import DEFAULT_BIP32_PATH, verify_ecdsa_secp256k1
from .xrp import Errors, XRPClient

CLA = 0xE0
INS_GET_SESSION_POLICY = 0x08
SW_SESSION_POLICY_REFUSED = 0x6986

POLICY_VERSION = 2
FLAG_ENABLED = 0x01
FLAG_ALLOW_ALL = 0x02
FLAG_ALLOW_PERMISSIONS = 0x04
FLAG_REQUIRE_WITNESS = 0x08
DROPS_PER_XRP = 1_000_000
# Presets a tap cycles through (src/ui/main/session_policy_menu.c), "no limit" first
MAX_SPEND_PRESETS_NB = 5
MAX_PER_PAYMENT_PRESETS_NB = 5
MAX_DURATION_PRESETS_NB = 5
MAX_SETTINGS_PAGES = 8
MAX_PROFILE_PAGES = 3

# Session profiles (src/policy/session_profiles.c): id, mode bits, max cap,
# max per payment, max duration, max transactions, permissions
MODE_CAP = 0x01
MODE_PERMISSIONS = 0x04
PROFILE_ON = 0x01
GAME = 1
FRESH_PROFILES = (
    (0, MODE_CAP, 50 * DROPS_PER_XRP, 5 * DROPS_PER_XRP, 180, 20, ()),
    (GAME, MODE_CAP, 5 * DROPS_PER_XRP, 100_000, 600, 500, ()),
    (2, MODE_PERMISSIONS, 0, 0, 600, 200, (8, 9)),
    (3, MODE_CAP, 2 * DROPS_PER_XRP, 10_000, 600, 1000, ()),
    (4, MODE_PERMISSIONS, 0, 0, 600, 100, (26,)),
)
# Max transactions presets of a profile: 10, 20, 50, 100, 200, 500, 1000
TX_COUNT_PRESETS_NB = 7

TESTCASES = Path(__file__).parent / "testcases" / "33-session-policy"
WITHIN_POLICY = TESTCASES / "01-within-policy.raw"
ABOVE_POLICY = TESTCASES / "02-above-policy.raw"
PROFILE_GAME = TESTCASES / "04-profile-game.raw"
PROFILE_GAME_ABOVE_CAP = TESTCASES / "05-profile-game-above-cap.raw"
PROFILE_TRADING = TESTCASES / "07-profile-trading.raw"
PROFILE_TRADING_PAYMENT = TESTCASES / "08-profile-trading-payment.raw"
# A Batch whose parsing stops at the field limit, before its session
UNREAD_BATCH = Path(__file__).parent / "testcases" / "32-batch" / "06-session-after-field-limit.raw"


def _profile_bytes(game_on: bool = True, game_tx_count: int = 500) -> bytes:
    """The profiles part of the INS 0x08 answer: fresh install, but for the game profile."""
    out = bytes([len(FRESH_PROFILES)])
    for pid, modes, max_cap, max_per_tx, max_duration, max_tx_count, permissions in FRESH_PROFILES:
        on = game_on if pid == GAME else True
        if pid == GAME:
            max_tx_count = game_tx_count
        out += bytes([pid, PROFILE_ON if on else 0, modes])
        out += max_cap.to_bytes(8, "big") + max_per_tx.to_bytes(8, "big")
        out += max_duration.to_bytes(4, "big") + max_tx_count.to_bytes(4, "big")
        out += bytes([len(permissions)]) + b"".join(p.to_bytes(4, "big") for p in permissions)
    return out


def _policy_bytes(
    flags: int, max_cap: int, max_per_tx: int = 0, max_duration: int = 0, profiles: bytes | None = None
) -> bytes:
    return (
        bytes([POLICY_VERSION, flags])
        + max_cap.to_bytes(8, "big")
        + max_per_tx.to_bytes(8, "big")
        + max_duration.to_bytes(4, "big")
        + (_profile_bytes() if profiles is None else profiles)
    )


def _get_policy(backend: BackendInterface) -> bytes:
    reply = backend.exchange(CLA, INS_GET_SESSION_POLICY, 0, 0)
    assert reply.status == Errors.SW_SUCCESS
    return reply.data


def _switch_x(device: Device) -> int:
    # Where the blind signing test touches its switch (functional_test.py)
    if device.type is DeviceType.APEX_P:
        return 263
    return 348


def _row_y(backend: BackendInterface, label: str) -> int | None:
    # A switch is found by its title, a limit by its "<name>: <value>" text
    for event in backend.get_current_screen_content()["events"]:
        if event["text"] == label or event["text"].startswith(f"{label}: "):
            return event["y"] + event["h"] // 2
    return None


def _find_settings_row(backend: BackendInterface, navigator: Navigator, label: str) -> int:
    """Opens the settings and pages to the row titled label; returns its y."""
    navigator.navigate([NavInsID.USE_CASE_HOME_SETTINGS], screen_change_before_first_instruction=False)
    for _ in range(MAX_SETTINGS_PAGES):
        y = _row_y(backend, label)
        if y is not None:
            return y
        navigator.navigate([NavInsID.USE_CASE_SETTINGS_NEXT], screen_change_before_first_instruction=False)
    raise AssertionError(f"no settings row '{label}'")


def _tap_setting(backend: BackendInterface, device: Device, navigator: Navigator, label: str, taps: int = 1) -> None:
    """Opens the settings, pages to the row titled label, taps it, leaves."""
    y = _find_settings_row(backend, navigator, label)
    # A limit redraws its page with the new value: the row stays in place
    navigator.navigate(
        [NavIns(NavInsID.TOUCH, (_switch_x(device), y))] * taps + [NavInsID.USE_CASE_SETTINGS_MULTI_PAGE_EXIT],
        screen_change_before_first_instruction=False,
    )
    backend.wait_for_home_screen()


def _tap_profile_setting(
    backend: BackendInterface, device: Device, navigator: Navigator, profile: str, label: str, taps: int = 1
) -> None:
    """Opens the settings, then the page of a profile (its bar in the list,
    e.g. "Game profile"), taps the row titled label, comes back home."""
    y = _find_settings_row(backend, navigator, profile)
    navigator.navigate([NavIns(NavInsID.TOUCH, (_switch_x(device), y))], screen_change_before_first_instruction=False)
    backend.wait_for_text_on_screen(profile)
    # Five rows do not fit on one page of every device
    for _ in range(MAX_PROFILE_PAGES):
        y = _row_y(backend, label)
        if y is not None:
            break
        navigator.navigate([NavInsID.USE_CASE_SETTINGS_NEXT], screen_change_before_first_instruction=False)
    assert y is not None, f"no '{label}' row on the '{profile}' page"
    # Back to the settings, then home
    navigator.navigate(
        [NavIns(NavInsID.TOUCH, (_switch_x(device), y))] * taps
        + [NavInsID.USE_CASE_SETTINGS_MULTI_PAGE_EXIT, NavInsID.USE_CASE_SETTINGS_MULTI_PAGE_EXIT],
        screen_change_before_first_instruction=False,
    )
    backend.wait_for_home_screen()


def _toggle_policy(backend: BackendInterface, device: Device, navigator: Navigator) -> None:
    _tap_setting(backend, device, navigator, "Session policy")


def _set_max_spend_50_xrp(backend: BackendInterface, device: Device, navigator: Navigator) -> None:
    # Each tap moves to the next preset: no limit -> XRP 10 -> XRP 50
    _tap_setting(backend, device, navigator, "Max spend", taps=2)


def test_get_session_policy_default(backend: BackendInterface) -> None:
    """Fresh install: policy off, no default limit, every profile on with its defaults."""
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
    _toggle_policy(backend, device, navigator)
    try:
        _set_max_spend_50_xrp(backend, device, navigator)
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
        _toggle_policy(backend, device, navigator)
        # 50 XRP is the third preset: three more taps come back to "no limit"
        _tap_setting(backend, device, navigator, "Max spend", taps=MAX_SPEND_PRESETS_NB - 2)

    assert _get_policy(backend) == _policy_bytes(0, 0)


def test_session_policy_settings(backend: BackendInterface, device: Device, navigator: Navigator) -> None:
    """Each switch and each limit, as INS 0x08 reads them back."""
    if backend.device.is_nano:
        pytest.skip("Settings are set by touch in this test")

    backend.wait_for_home_screen()
    assert _get_policy(backend) == _policy_bytes(0, 0)

    flags = 0
    for label, flag in (
        ("Session policy", FLAG_ENABLED),
        ("All transactions", FLAG_ALLOW_ALL),
        ("Permissions", FLAG_ALLOW_PERMISSIONS),
        ("Witness", FLAG_REQUIRE_WITNESS),
    ):
        _tap_setting(backend, device, navigator, label)
        flags |= flag
        assert _get_policy(backend) == _policy_bytes(flags, 0)

    # no limit -> XRP 10; no limit -> XRP 1 -> XRP 5; no limit -> 60 s -> 180 s -> 300 s
    _tap_setting(backend, device, navigator, "Max spend")
    _tap_setting(backend, device, navigator, "Max per payment", taps=2)
    _tap_setting(backend, device, navigator, "Max duration", taps=3)
    assert _get_policy(backend) == _policy_bytes(flags, 10 * DROPS_PER_XRP, 5 * DROPS_PER_XRP, 300)

    # Every limit cycles back to "no limit"; every switch turns off again
    _tap_setting(backend, device, navigator, "Max spend", taps=MAX_SPEND_PRESETS_NB - 1)
    _tap_setting(backend, device, navigator, "Max per payment", taps=MAX_PER_PAYMENT_PRESETS_NB - 2)
    _tap_setting(backend, device, navigator, "Max duration", taps=MAX_DURATION_PRESETS_NB - 3)
    assert _get_policy(backend) == _policy_bytes(flags, 0)
    for label in ("Session policy", "All transactions", "Permissions", "Witness"):
        _tap_setting(backend, device, navigator, label)
    assert _get_policy(backend) == _policy_bytes(0, 0)


def test_session_policy_unread_batch(backend: BackendInterface, device: Device, navigator: Navigator) -> None:
    """A Batch too long to read up to its session: the policy refuses it, even
    with blind signing on (off, it is refused as never blind-signed)."""
    if backend.device.is_nano:
        pytest.skip("Settings are set by touch in this test")

    xrp = XRPClient(backend, navigator)
    backend.wait_for_home_screen()
    _enable_blind_signing(backend, device, navigator)
    backend.wait_for_home_screen()
    _toggle_policy(backend, device, navigator)
    try:
        backend.raise_policy = RaisePolicy.RAISE_ALL_BUT_0x9000
        with pytest.raises(ExceptionRAPDU) as err:
            with xrp.sign(DEFAULT_BIP32_PATH + UNREAD_BATCH.read_bytes()):
                pass  # answered synchronously by ui_session_policy_refusal()
        assert err.value.status == SW_SESSION_POLICY_REFUSED
        backend.wait_for_text_on_screen("Blocked by your")
        navigator.navigate([NavInsID.USE_CASE_CHOICE_CONFIRM], screen_change_before_first_instruction=False)
        backend.wait_for_home_screen()
    finally:
        _toggle_policy(backend, device, navigator)
    assert _get_policy(backend) == _policy_bytes(0, 0)


def _refuse(backend: BackendInterface, xrp: XRPClient, tx: Path) -> None:
    backend.raise_policy = RaisePolicy.RAISE_ALL_BUT_0x9000
    with pytest.raises(ExceptionRAPDU) as err:
        with xrp.sign(DEFAULT_BIP32_PATH + tx.read_bytes()):
            pass  # answered synchronously by ui_session_policy_refusal()
    assert err.value.status == SW_SESSION_POLICY_REFUSED
    backend.raise_policy = RaisePolicy.RAISE_NOTHING


def _sign_reviewed(
    backend: BackendInterface, xrp: XRPClient, scenario_navigator: NavigateWithScenario, tx_path: Path
) -> None:
    tx = tx_path.read_bytes()
    backend.wait_for_home_screen()
    with xrp.sign(DEFAULT_BIP32_PATH + tx):
        scenario_navigator.review_approve(
            test_name=f"33-session-policy/{tx_path.stem}",
            custom_screen_text="^Hold to sign$" if backend.device.touchable else "^Sign transaction?",
        )
    reply = xrp.get_async_response()
    assert reply and reply.status == Errors.SW_SUCCESS
    verify_ecdsa_secp256k1(tx, reply.data, str(tx_path))


def test_session_profiles_policy_off(
    backend: BackendInterface, navigator: Navigator, scenario_navigator: NavigateWithScenario
) -> None:
    """The real app's openings (game: mode C, 5 XRP, 0.1 XRP per payment, 300
    transactions; trading: OfferCreate and OfferCancel, 200 transactions), with
    the policy off as on a fresh install: clear-signed, "Max transactions" and
    "Profile" shown, the same screens as with the policy on."""
    xrp = XRPClient(backend, navigator)
    assert _get_policy(backend) == _policy_bytes(0, 0)
    _sign_reviewed(backend, xrp, scenario_navigator, PROFILE_GAME)
    _sign_reviewed(backend, xrp, scenario_navigator, PROFILE_TRADING)


def test_session_profiles(
    backend: BackendInterface,
    device: Device,
    navigator: Navigator,
    scenario_navigator: NavigateWithScenario,
    test_name: str,
    default_screenshot_path: Path,
) -> None:
    """Policy on, default profiles: the game and trading sessions sign with a
    "Profile" row; one above the game profile, or asking a permission outside
    the trading profile, is refused before any review."""
    if backend.device.is_nano:
        pytest.skip("Settings are set by touch in this test")

    xrp = XRPClient(backend, navigator)
    backend.wait_for_home_screen()
    _toggle_policy(backend, device, navigator)
    try:
        _sign_reviewed(backend, xrp, scenario_navigator, PROFILE_GAME)
        _sign_reviewed(backend, xrp, scenario_navigator, PROFILE_TRADING)

        # 50 XRP: above the game profile's 5 XRP, the reason on screen
        backend.wait_for_home_screen()
        _refuse(backend, xrp, PROFILE_GAME_ABOVE_CAP)
        navigator.navigate_until_text_and_compare(
            navigate_instruction=NavInsID.USE_CASE_CHOICE_REJECT,
            validation_instructions=[NavInsID.USE_CASE_CHOICE_CONFIRM],
            text="Blocked by your",
            path=default_screenshot_path,
            test_case_name=test_name,
        )

        # Payment is not in the trading profile
        backend.wait_for_home_screen()
        _refuse(backend, xrp, PROFILE_TRADING_PAYMENT)
        backend.wait_for_text_on_screen("Blocked by your")
        navigator.navigate([NavInsID.USE_CASE_CHOICE_CONFIRM], screen_change_before_first_instruction=False)
        backend.wait_for_home_screen()
    finally:
        _toggle_policy(backend, device, navigator)
    assert _get_policy(backend) == _policy_bytes(0, 0)


def test_session_profile_settings(backend: BackendInterface, device: Device, navigator: Navigator) -> None:
    """Settings > Game profile: turned off, then its max transactions moved to
    the next preset, as INS 0x08 reads them back; a session naming a profile
    turned off is refused."""
    if backend.device.is_nano:
        pytest.skip("Settings are set by touch in this test")

    xrp = XRPClient(backend, navigator)
    backend.wait_for_home_screen()
    _tap_profile_setting(backend, device, navigator, "Game profile", "Profile")
    assert _get_policy(backend) == _policy_bytes(0, 0, profiles=_profile_bytes(game_on=False))

    _toggle_policy(backend, device, navigator)
    try:
        _refuse(backend, xrp, PROFILE_GAME)
        backend.wait_for_text_on_screen("Blocked by your")
        navigator.navigate([NavInsID.USE_CASE_CHOICE_CONFIRM], screen_change_before_first_instruction=False)
        backend.wait_for_home_screen()
    finally:
        _toggle_policy(backend, device, navigator)

    # 500 -> 1000 transactions
    _tap_profile_setting(backend, device, navigator, "Game profile", "Max transactions")
    assert _get_policy(backend) == _policy_bytes(0, 0, profiles=_profile_bytes(game_on=False, game_tx_count=1000))

    # Back to on, and around the presets to 500
    _tap_profile_setting(backend, device, navigator, "Game profile", "Profile")
    _tap_profile_setting(
        backend, device, navigator, "Game profile", "Max transactions", taps=TX_COUNT_PRESETS_NB - 1
    )
    assert _get_policy(backend) == _policy_bytes(0, 0)
