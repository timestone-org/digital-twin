"""接了外部解析后端之后，**三处必须一起变**：能力面、上传校验、worker。

⚠ 这三处必须同时对得上，而它们之间没有任何一处会互相校验：能力面下发的
accept 名单少了 `.pdf`，界面就选不中 PDF；上传校验少了它，选中了也会被拒；
worker 少了那一路后端，传进来了也解不了。**三处单看都对。**

`accepted_suffixes()` 与 `external_for()` 的 `external` 是必填的——漏传是类型
错误而不是静默只报本地那几路。这几条用例守的是「必填之后真的被传对了」。
"""

import pytest
from pydantic import SecretStr

from knowledge_server.apps.knowledge.errors import UnsupportedRawItem
from knowledge_server.apps.knowledge.schemas import UploadTicketIn
from knowledge_server.apps.knowledge.services import capability_of
from knowledge_server.apps.knowledge.services.assembly import external_parsers
from knowledge_server.apps.knowledge.services.capability import Installed
from knowledge_server.apps.knowledge.services.document_service import (
    presign_upload,
)
from knowledge_server.apps.knowledge.services.parsing import MINERU_KIND
from knowledge_server.settings import Settings

PLACEHOLDER = "knowledge-test"


def _settings(**extra: object) -> Settings:
    return Settings(  # pyright: ignore[reportArgumentType]
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        redis_host=PLACEHOLDER,
        objectstore_endpoint="http://knowledge-test:9000",
        objectstore_bucket=PLACEHOLDER,
        objectstore_access_key=SecretStr(PLACEHOLDER),
        objectstore_secret_key=SecretStr("s" * 16),
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
        **extra,
    )


def _wired() -> Settings:
    return _settings(mineru_enabled=True, mineru_base_url="http://mineru:8000")


def test_nothing_is_assembled_when_mineru_is_off() -> None:
    assert external_parsers(_settings()) == ()


def test_mineru_is_assembled_from_the_configured_address() -> None:
    made = external_parsers(_wired())
    assert [one.name for one in made] == [MINERU_KIND]
    assert ".pdf" in made[0].suffixes


def test_connecting_mineru_puts_pdf_on_the_accept_list() -> None:
    """⚠ 界面的 accept 名单由能力面下发。少了 `.pdf` 的表现是「接了 MinerU，
    选文件时根本选不中 PDF」，而后端日志一切正常。"""
    off = capability_of(_settings())
    on = capability_of(
        _wired(),
        installed=Installed(external_parsers=external_parsers(_wired())),
    )
    assert ".pdf" not in off.accepted_suffixes
    assert ".pdf" in on.accepted_suffixes
    assert on.parsing.external_backends == [MINERU_KIND]
    assert on.parsing.reason == ""


class _Store:
    """签到这里就说明校验放行了的假对象存储。

    ⚠ 故意抛：这几条用例问的是「后缀校验放不放行」，签凭证那一步不是它们的事。
    """

    async def presign_post(self, key: str, **rest: object) -> object:
        del rest
        raise AssertionError(f"校验已放行，走到签凭证了：{key}")


async def test_the_upload_check_refuses_pdf_until_mineru_is_connected() -> None:
    """⚠ 这一道与上面那一道必须同时变。只改了能力面的话，界面选得中 PDF、
    传上去被拒——而两边单看都对。"""
    with pytest.raises(UnsupportedRawItem, match=r"图纸\.pdf"):
        await presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            __import__("uuid").uuid4(),
            UploadTicketIn(filename="图纸.pdf", size_bytes=1024),
            (),
        )


async def test_the_upload_check_lets_pdf_through_once_connected() -> None:
    """放行之后会走到签凭证那一步——假件在那里抛，抛出来就说明校验放行了。"""
    with pytest.raises(AssertionError, match="校验已放行"):
        await presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            __import__("uuid").uuid4(),
            UploadTicketIn(filename="图纸.pdf", size_bytes=1024),
            external_parsers(_wired()),
        )
