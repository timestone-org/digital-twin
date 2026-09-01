"""公式绑定的数据访问。

⚠ `fx_code` 是**逻辑引用**，库里没有外键指向公式条目（跨模块的表间外键会让
models 层跨模块，结构闸拦）。孤儿由读侧每次列表时校验，不做后台对账
（docs/MODELING_DESIGN.md §4.5、§7.5）。
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import ModelingBinding

DEFAULT_ORDER = (ModelingBinding.fx_code.asc(), ModelingBinding.id.asc())


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

    async def list_all(self, session: AsyncSession) -> list[ModelingBinding]:
        """全部绑定，按公式标识排序。量级是几十条，不分页。

        Args: session。
        """
        rows = await session.execute(
            select(ModelingBinding).order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def count_of_version(
        self, session: AsyncSession, model_version_id: uuid.UUID
    ) -> int:
        """还有几条绑定指着这个版本。退役前要问一次。

        Args: session, model_version_id。
        """
        return await self.count(
            session,
            statement=select(ModelingBinding).where(
                ModelingBinding.model_version_id == model_version_id
            ),
        )


binding_crud = BindingCrud()
