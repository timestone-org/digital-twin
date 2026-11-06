"""编码唯一性由数据库判定：并发撞约束时回业务 409，不漏成 500。"""

import uuid
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import (
    BindingCodeTaken,
    PipelineCodeTaken,
)
from platform_server.apps.modeling.schemas import PipelineCreateIn
from platform_server.apps.modeling.services import (
    binding_service,
    pipeline_service,
)
from platform_server.apps.modeling.services.binding_service import BindingDraft
from platform_server.apps.modeling.services.pipeline_service import Actor
from unit.modeling_fakes import linear_graph

ACTOR = Actor("user", "用户")


class RacedSession:
    """先查没撞上、flush 时才撞唯一约束的会话假件。"""

    def add(self, _row: object) -> None:
        return None

    async def flush(self) -> None:
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))


async def _nothing(*_args: object, **_kwargs: object) -> None:
    return None


async def test_a_raced_pipeline_code_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pipeline_service.pipeline_crud, "get_by_code", _nothing)
    with pytest.raises(PipelineCodeTaken):
        await pipeline_service.create_pipeline(
            cast("AsyncSession", RacedSession()),
            payload=PipelineCreateIn(
                code="q4", name="第四季度", graph=linear_graph()
            ),
            actor=ACTOR,
        )


async def test_a_raced_binding_code_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    version = SimpleNamespace(
        id=uuid.uuid4(),
        task="regression",
        servable=True,
        signature_json={"inputs": [{"key": "x"}]},
        feature_keys=["x"],
    )

    async def active(*_args: object) -> object:
        return version

    async def params(*_args: object) -> tuple[str, ...]:
        return ("a",)

    monkeypatch.setattr(binding_service.binding_crud, "get_by_code", _nothing)
    monkeypatch.setattr(binding_service, "require_active_version", active)
    monkeypatch.setattr(binding_service, "_column_params", params)
    with pytest.raises(BindingCodeTaken):
        await binding_service.create_binding(
            cast("AsyncSession", RacedSession()),
            draft=BindingDraft(fx_code="FX", model_version_id=version.id),
            actor=ACTOR,
        )
