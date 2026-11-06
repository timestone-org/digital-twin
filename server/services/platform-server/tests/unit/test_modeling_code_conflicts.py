"""编码唯一性由数据库判定：并发撞约束时回业务 409，不漏成 500。"""

import uuid
from dataclasses import dataclass
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.errors import (
    BindingCodeTaken,
    PipelineCodeTaken,
)
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingPipeline,
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


PIPELINE_UNIQUE = "uq_modeling_pipelines_code"
BINDING_UNIQUE = "uq_modeling_bindings_fx_code"
BINDING_FOREIGN_KEY = "fk_modeling_bindings_model_version_id"
NAME_CHECK = "ck_modeling_pipelines_name_nonempty"


class DriverError(Exception):
    """驱动层异常：约束名挂在它身上。"""

    def __init__(self, constraint_name: str) -> None:
        super().__init__("constraint violated")
        self.constraint_name = constraint_name


def integrity_error(constraint: str) -> IntegrityError:
    """按 SQLAlchemy asyncpg 适配层的形状造一个完整性错误。Args: constraint。"""
    wrapper = Exception("constraint violated")
    wrapper.__cause__ = DriverError(constraint)
    return IntegrityError("INSERT", {}, wrapper)


@dataclass
class RacedSession:
    """先查没撞上、flush 时才撞约束的会话假件。"""

    constraint: str

    def add(self, _row: object) -> None:
        return None

    async def flush(self) -> None:
        raise integrity_error(self.constraint)


async def _nothing(*_args: object, **_kwargs: object) -> None:
    return None


async def create_pipeline_hitting(
    monkeypatch: pytest.MonkeyPatch, constraint: str
) -> None:
    """建一条流水线，flush 时撞指定约束。Args: monkeypatch, constraint。"""
    monkeypatch.setattr(pipeline_service.pipeline_crud, "get_by_code", _nothing)
    await pipeline_service.create_pipeline(
        cast("AsyncSession", RacedSession(constraint)),
        payload=PipelineCreateIn(
            code="q4", name="第四季度", graph=linear_graph()
        ),
        actor=ACTOR,
    )


async def create_binding_hitting(
    monkeypatch: pytest.MonkeyPatch, constraint: str
) -> None:
    """建一条绑定，flush 时撞指定约束。Args: monkeypatch, constraint。"""
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
    await binding_service.create_binding(
        cast("AsyncSession", RacedSession(constraint)),
        draft=BindingDraft(fx_code="FX", model_version_id=version.id),
        actor=ACTOR,
    )


async def test_a_raced_pipeline_code_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(PipelineCodeTaken):
        await create_pipeline_hitting(monkeypatch, PIPELINE_UNIQUE)


async def test_a_raced_binding_code_is_a_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(BindingCodeTaken):
        await create_binding_hitting(monkeypatch, BINDING_UNIQUE)


async def test_another_pipeline_constraint_is_not_called_a_taken_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """撞的不是编码唯一约束：原样上抛，不把它说成「编码已占用」。"""
    with pytest.raises(IntegrityError):
        await create_pipeline_hitting(monkeypatch, NAME_CHECK)


async def test_a_foreign_key_violation_is_not_called_a_taken_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """模型版本外键撞了：原样上抛，不把它说成「已经绑过」。"""
    with pytest.raises(IntegrityError):
        await create_binding_hitting(monkeypatch, BINDING_FOREIGN_KEY)


@pytest.mark.parametrize(
    ("model", "constraint"),
    [(ModelingPipeline, PIPELINE_UNIQUE), (ModelingBinding, BINDING_UNIQUE)],
)
def test_the_named_constraints_exist_on_the_models(
    model: type[ModelingPipeline | ModelingBinding], constraint: str
) -> None:
    """约束改名后判定会静默失效，退回 500。"""
    names = {item.name for item in model.__table__.constraints}
    assert constraint in names
