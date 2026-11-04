"""公式绑定的数据访问。

⚠ `fx_code` 是**逻辑引用**，库里没有外键指向公式条目（跨模块的表间外键会让
models 层跨模块，结构闸拦）。孤儿由读侧每次列表时校验，不做后台对账
（docs/MODELING_DESIGN.md §4.5、§7.5）。
"""

from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelingModelVersion,
    ModelingPipeline,
)
from platform_server.apps.modeling.schemas.management import BindingListQuery

DEFAULT_ORDER = (ModelingBinding.fx_code.asc(), ModelingBinding.id.asc())


@dataclass(frozen=True)
class BindingRecord:
    binding: ModelingBinding
    model_name: str
    model_version: int


class BindingCrud(CrudBase[ModelingBinding]):
    """`modeling_bindings` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingBinding)

    async def get_by_code(
        self, session: AsyncSession, fx_code: str
    ) -> ModelingBinding | None:
        """按公式标识取绑定。**推理路径每批就查这一次。**

        Args: session, fx_code。
        """
        rows = await session.execute(
            select(ModelingBinding).where(ModelingBinding.fx_code == fx_code)
        )
        return rows.scalars().first()

    async def list_by_codes(
        self, session: AsyncSession, fx_codes: tuple[str, ...]
    ) -> list[ModelingBinding]:
        """一次取一批绑定。求值前的加载相位用它，一次重算只查一次。

        Args: session, fx_codes。
        """
        if not fx_codes:
            return []
        rows = await session.execute(
            select(ModelingBinding).where(ModelingBinding.fx_code.in_(fx_codes))
        )
        return list(rows.scalars().all())

    async def list_filtered(
        self, session: AsyncSession, query: BindingListQuery
    ) -> tuple[list[BindingRecord], int]:
        statement = _filtered(query.q)
        page = query.page_params
        total = 0
        if page is not None:
            total = int(
                await session.scalar(
                    select(func.count()).select_from(statement.subquery())
                )
                or 0
            )
            statement = (
                statement.order_by(
                    ModelingBinding.created_at.desc(), ModelingBinding.id.desc()
                )
                .offset(page.offset)
                .limit(page.size)
            )
        else:
            statement = statement.order_by(*DEFAULT_ORDER)
        rows = await session.execute(statement)
        return [BindingRecord(*row) for row in rows], total


def _filtered(keyword: str | None) -> Select[tuple[ModelingBinding, str, int]]:
    statement = (
        select(
            ModelingBinding,
            ModelingModelVersion.name,
            ModelingModelVersion.version,
        )
        .join(
            ModelingModelVersion,
            ModelingBinding.model_version_id == ModelingModelVersion.id,
        )
        .join(
            ModelingPipeline,
            ModelingModelVersion.pipeline_id == ModelingPipeline.id,
        )
    )
    if keyword:
        statement = statement.where(
            ModelingBinding.fx_code.icontains(keyword, autoescape=True)
            | ModelingModelVersion.name.icontains(keyword, autoescape=True)
            | ModelingModelVersion.description.icontains(
                keyword, autoescape=True
            )
            | ModelingPipeline.name.icontains(keyword, autoescape=True)
            | ModelingPipeline.code.icontains(keyword, autoescape=True)
        )
    return statement


binding_crud = BindingCrud()
