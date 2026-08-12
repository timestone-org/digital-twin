"""服务器证书：自签、复用、指纹、私钥不外泄。"""

import stat
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from cryptography import x509
from cryptography.hazmat.primitives import serialization

from lib.testing import FrozenClock
from opcua_server.apps.instance.runtime.pki import (
    KEY_FILE_MODE,
    PkiStore,
    fingerprint_of,
)

APPLICATION_URI = "urn:digitaltwin:opcua:test"


def _store(directory: Path) -> PkiStore:
    return PkiStore(
        directory,
        valid_days=30,
        clock=FrozenClock(current=datetime(2026, 8, 12, tzinfo=UTC)),
    )


async def test_material_is_none_before_anything_is_generated(
    tmp_path: Path,
) -> None:
    assert await _store(tmp_path).material(uuid4()) is None


async def test_ensure_creates_certificate_and_key(tmp_path: Path) -> None:
    store = _store(tmp_path)
    instance_id = uuid4()
    material = await store.ensure(
        instance_id, application_uri=APPLICATION_URI, hostname="plant"
    )
    assert material.certificate_path.is_file()
    assert material.private_key_path.is_file()


async def test_ensure_is_idempotent(tmp_path: Path) -> None:
    """第二次调用必须复用同一张证书——换证等于让上位机的信任列表失效。"""
    store = _store(tmp_path)
    instance_id = uuid4()
    first = await store.ensure(
        instance_id, application_uri=APPLICATION_URI, hostname="plant"
    )
    second = await store.ensure(
        instance_id, application_uri=APPLICATION_URI, hostname="plant"
    )
    assert first.fingerprint_sha256 == second.fingerprint_sha256


async def test_two_instances_get_different_certificates(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    one = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    other = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    assert one.fingerprint_sha256 != other.fingerprint_sha256


async def test_private_key_is_only_readable_by_owner(tmp_path: Path) -> None:
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    mode = stat.S_IMODE(material.private_key_path.stat().st_mode)
    assert mode == KEY_FILE_MODE


async def test_material_never_carries_the_private_key(tmp_path: Path) -> None:
    """⚠ 私钥只在卷上；对外的元信息里只能有路径、指纹、主体与有效期。"""
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    secret = material.private_key_path.read_bytes()
    assert b"PRIVATE KEY" in secret
    assert "PRIVATE KEY" not in repr(material)


async def test_fingerprint_matches_the_der_on_disk(tmp_path: Path) -> None:
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    der = material.certificate_path.read_bytes()
    assert material.fingerprint_sha256 == fingerprint_of(der)


async def test_certificate_carries_the_application_uri_in_san(
    tmp_path: Path,
) -> None:
    """⚠ SAN 里的 URI 与端点声明不一致时，客户端只会说「证书不受信任」。"""
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    certificate = x509.load_der_x509_certificate(
        material.certificate_path.read_bytes()
    )
    san = certificate.extensions.get_extension_for_class(
        x509.SubjectAlternativeName
    ).value
    uris = san.get_values_for_type(x509.UniformResourceIdentifier)
    assert uris == [APPLICATION_URI]


async def test_certificate_is_not_a_certificate_authority(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    certificate = x509.load_der_x509_certificate(
        material.certificate_path.read_bytes()
    )
    constraints = certificate.extensions.get_extension_for_class(
        x509.BasicConstraints
    ).value
    assert constraints.ca is False


async def test_validity_end_follows_the_configured_window(
    tmp_path: Path,
) -> None:
    store = PkiStore(
        tmp_path,
        valid_days=10,
        clock=FrozenClock(current=datetime(2026, 8, 12, tzinfo=UTC)),
    )
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    assert material.not_valid_after == datetime(2026, 8, 22, tzinfo=UTC)


async def test_private_key_is_pkcs8_pem_without_passphrase(
    tmp_path: Path,
) -> None:
    store = _store(tmp_path)
    material = await store.ensure(
        uuid4(), application_uri=APPLICATION_URI, hostname="plant"
    )
    key = serialization.load_pem_private_key(
        material.private_key_path.read_bytes(), password=None
    )
    assert key.key_size == 2048


async def test_missing_key_file_makes_material_report_nothing(
    tmp_path: Path,
) -> None:
    """半套证书不算数：只剩证书没有私钥时必须当作没有，重新签发。"""
    store = _store(tmp_path)
    instance_id = uuid4()
    material = await store.ensure(
        instance_id, application_uri=APPLICATION_URI, hostname="plant"
    )
    material.private_key_path.unlink()
    assert await store.material(instance_id) is None
