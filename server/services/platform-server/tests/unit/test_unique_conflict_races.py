"""「先查再插」被并发穿过时，撞唯一约束要收敛成约定的 409。

查的那一步挡不住两个同时到的请求：后到的那个死在 flush 上，不翻译就是 500。
"""

import uuid
from typing import Any, cast

import pytest
from pydantic import SecretStr
from sqlalchemy.exc import IntegrityError

from lib.crypto import SecretCipher
from platform_server.apps.collect.crud import point_crud, source_crud
from platform_server.apps.collect.errors import PointCodeTaken, SourceCodeTaken
from platform_server.apps.collect.schemas import PointCreateIn, SourceCreateIn
from platform_server.apps.collect.services import point_service, source_service
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.errors import LlmProviderNameTaken
from platform_server.apps.llm_providers.models import LlmProvider
from platform_server.apps.llm_providers.schemas import (
    LlmProviderIn,
    LlmProviderUpdateIn,
)
from platform_server.apps.llm_providers.services import provider_service

CIPHER = SecretCipher("k" * 32, label="test")
SOURCE_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000005")


class UniqueViolation(Exception):
    """asyncpg 的错：带着约束名。"""

    def __init__(self, constraint: str) -> None:
        super().__init__("duplicate key")
        self.constraint_name = constraint


class CollidingSession:
    """flush 时撞上给定约束的会话。"""

    def __init__(self, constraint: str) -> None:
        self._constraint = constraint

    async def flush(self) -> None:
        # SQLAlchemy 的驱动适配层把 asyncpg 的错包一层，原件在 `__cause__` 上
        wrapped = Exception("duplicate key")
        wrapped.__cause__ = UniqueViolation(self._constraint)
        raise IntegrityError("INSERT", {}, wrapped)


def colliding(constraint: str) -> Any:
    return cast(Any, CollidingSession(constraint))


def point_payload() -> PointCreateIn:
    return PointCreateIn.model_validate(
        {
            "source_id": str(SOURCE_ID),
            "items": [
                {"code": "temp", "name": "温度", "address": "ns=2;s=temp"}
            ],
        }
    )


def source_payload() -> SourceCreateIn:
    return SourceCreateIn.model_validate(
        {
            "name": "一号线",
            "code": "line-1",
            "protocol": "opcua",
            "endpoint": "opc.tcp://plc:4840",
        }
    )


def provider_payload() -> LlmProviderIn:
    return LlmProviderIn.model_validate(
        {
            "name": "百炼",
            "base_url": "https://endpoint/v1",
            "api_key": SecretStr("sk-x"),
        }
    )


def ignore(*_args: object) -> None:
    return None


def second_of(_session: object, row: LlmProvider) -> LlmProvider:
    return row


def install_point_fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def taken_codes(*_args: object) -> set[str]:
        return set()

    monkeypatch.setattr(point_crud, "taken_codes", taken_codes)
    monkeypatch.setattr(point_crud, "add", ignore)


def install_source_fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def get_by_code(*_args: object) -> None:
        return None

    monkeypatch.setattr(source_crud, "get_by_code", get_by_code)
    monkeypatch.setattr(source_crud, "add", ignore)


def install_provider_fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def by_name(*_args: object) -> None:
        return None

    async def get(*_args: object) -> LlmProvider:
        return LlmProvider(
            name="旧名",
            kind="openai_compatible",
            base_url="https://endpoint/v1",
            api_key_enc="cipher",
            models_json=[],
        )

    monkeypatch.setattr(crud.provider, "by_name", by_name)
    monkeypatch.setattr(crud.provider, "get", get)
    monkeypatch.setattr(crud.provider, "add", second_of)


async def test_racing_point_codes_read_as_taken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_point_fakes(monkeypatch)
    session = colliding("uq_collect_points_source_id_code")

    with pytest.raises(PointCodeTaken):
        await point_service._insert_points(session, SOURCE_ID, point_payload())


async def test_racing_source_codes_read_as_taken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_source_fakes(monkeypatch)
    context = source_service.SourceContext(
        states=cast(Any, object()), cipher=cast(Any, object())
    )

    with pytest.raises(SourceCodeTaken):
        await source_service.create_source(
            colliding("uq_collect_sources_code"),
            context,
            payload=source_payload(),
        )


async def test_racing_provider_names_read_as_taken_on_create(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider_fakes(monkeypatch)

    with pytest.raises(LlmProviderNameTaken):
        await provider_service.create_provider(
            colliding("uq_llm_providers_name"),
            provider_payload(),
            cipher=CIPHER,
            actor="tester",
        )


async def test_racing_provider_names_read_as_taken_on_rename(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider_fakes(monkeypatch)

    with pytest.raises(LlmProviderNameTaken):
        await provider_service.update_provider(
            colliding("uq_llm_providers_name"),
            SOURCE_ID,
            LlmProviderUpdateIn(name="新名"),
            cipher=CIPHER,
            actor="tester",
        )


async def test_another_constraint_is_not_dressed_up_as_taken(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_provider_fakes(monkeypatch)

    # 别的约束撞了是数据问题，翻成「名字已被占用」会把人指到错的方向
    with pytest.raises(IntegrityError):
        await provider_service.create_provider(
            colliding("ck_llm_providers_kind"),
            provider_payload(),
            cipher=CIPHER,
            actor="tester",
        )
