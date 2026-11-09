"""建实例时只有撞上编码唯一约束才报「编码已占用」，别的完整性错误原样抛出。"""

import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import PipelineCodeTaken
from platform_server.apps.modeling.schemas.template import (
    ModelingInstanceCreateIn,
)
from platform_server.apps.modeling.services import instance_service
from platform_server.apps.modeling.services.pipeline_service import Actor


class _DriverError(Exception):
    """驱动层异常：约束名挂在 `__cause__` 上。"""


def _violation(constraint: str) -> IntegrityError:
    """Args: constraint。"""
    cause = _DriverError()
    setattr(cause, "constraint_name", constraint)  # noqa: B010
    orig = _DriverError()
    orig.__cause__ = cause
    return IntegrityError("INSERT", {}, orig)


def _session(error: IntegrityError) -> AsyncSession:
    """Args: error。"""

    async def flush() -> None:
        raise error

    return cast("AsyncSession", SimpleNamespace(flush=flush))


@pytest.fixture(autouse=True)
def _template(monkeypatch: pytest.MonkeyPatch) -> None:
    async def lock(*args: Any) -> object:
        del args
        return SimpleNamespace(
            id=uuid.uuid4(), is_enabled=True, graph_json={"nodes": []}
        )

    monkeypatch.setattr(instance_service.templates, "lock", lock)
    monkeypatch.setattr(
        instance_service, "require_template_graph", lambda graph: graph
    )
    monkeypatch.setattr(
        instance_service.pipeline_crud, "add", lambda _session, row: row
    )


async def _create(error: IntegrityError) -> None:
    """Args: error。"""
    await instance_service.create_instance(
        _session(error),
        ModelingInstanceCreateIn(
            template_id=uuid.uuid4(), code="energy-k9", name="九号机"
        ),
        Actor(user_id="u", name="n"),
    )


async def test_a_code_collision_is_reported_as_taken() -> None:
    with pytest.raises(PipelineCodeTaken):
        await _create(_violation("uq_modeling_pipelines_code"))


async def test_another_integrity_error_is_not_disguised() -> None:
    with pytest.raises(IntegrityError):
        await _create(_violation("ck_modeling_pipelines_name"))
