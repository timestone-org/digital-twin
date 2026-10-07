"""种子管理员口令复用业务强度政策并拒绝空值哨兵。"""

import importlib.util
from pathlib import Path

import pytest
from pydantic import SecretStr, TypeAdapter, ValidationError

from auth_server.apps.auth.schemas.password import RawPassword
from lib.config import load_settings_or_exit

SEED_PATH = Path(__file__).resolve().parents[2] / "scripts" / "seed.py"
SPEC = importlib.util.spec_from_file_location("auth_seed_contract", SEED_PATH)
assert SPEC is not None
assert SPEC.loader is not None
SEED_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SEED_MODULE)
SeedSettings = SEED_MODULE.SeedSettings


@pytest.mark.parametrize(
    "password", ["null", "short1", "abcdefghij", "1234567890"]
)
def test_seed_admin_rejects_passwords_outside_business_policy(
    password: str,
) -> None:
    with pytest.raises(ValidationError):
        SeedSettings(admin_password=password)


def test_seed_admin_rejects_null_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTH_SEED_ADMIN_PASSWORD", "null")
    with pytest.raises(ValidationError):
        SeedSettings(_env_file=None)


def test_seed_admin_accepts_strong_secret_without_exposing_it() -> None:
    given = "QaOnlyPassword123"
    settings = SeedSettings(admin_password=given)
    assert settings.admin_password.get_secret_value() == given
    assert given not in repr(settings)


@pytest.mark.parametrize(
    "password",
    ["short1", "abcdefghij", "1234567890", "A1" * 65],
    ids=["short", "letters", "digits", "long"],
)
@pytest.mark.parametrize("is_wrapped", [False, True], ids=["raw", "secret"])
def test_rejected_seed_password_stays_masked_in_validation_errors(
    password: str, is_wrapped: bool
) -> None:
    supplied = SecretStr(password) if is_wrapped else password
    with pytest.raises(ValidationError) as caught:
        SeedSettings(_env_file=None, admin_password=supplied)
    error = caught.value
    assert password not in str(error)
    assert password not in repr(error)
    assert password not in error.json()
    assert password not in repr(error.errors())
    assert error.__cause__ is None
    assert error.__context__ is None


@pytest.mark.parametrize(
    ("password", "is_valid"),
    [
        ("Abcdefgh1", False),
        ("Abcdefghi1", True),
        ("A1" * 64, True),
        ("A1" * 64 + "A", False),
        ("汉字汉字汉字汉字汉１", True),
        ("nullPolicy1", True),
    ],
    ids=["below-min", "min", "max", "above-max", "unicode", "null-part"],
)
def test_seed_password_matches_real_account_policy(
    password: str, is_valid: bool
) -> None:
    if is_valid:
        assert TypeAdapter(RawPassword).validate_python(password) == password
        settings = SeedSettings(_env_file=None, admin_password=password)
        assert settings.admin_password.get_secret_value() == password
    else:
        with pytest.raises(ValidationError):
            TypeAdapter(RawPassword).validate_python(password)
        with pytest.raises(ValidationError):
            SeedSettings(_env_file=None, admin_password=password)


def test_seed_cli_rejects_password_without_echoing_it(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    password = "RejectedLettersOnly"
    monkeypatch.setenv("AUTH_SEED_ADMIN_PASSWORD", password)
    with pytest.raises(SystemExit) as caught:
        load_settings_or_exit(SeedSettings)
    assert caught.value.code == 2
    assert password not in capsys.readouterr().err
