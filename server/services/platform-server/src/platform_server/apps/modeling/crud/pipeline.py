"""流水线定义的数据访问。"""

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.modeling.models import ModelingPipeline
from platform_server.apps.modeling.models.template import ModelingInstance

# ⚠ 排序写死：两次列出同一批流水线不保证同序的话，界面翻页会重复与漏行
DEFAULT_ORDER = (ModelingPipeline.code.asc(), ModelingPipeline.id.asc())
# LIKE 的两个通配符与转义符自身。不转义的话搜「50%」会退化成「列全部」，
# 而现象只是「搜索好像没生效」
_LIKE_SPECIALS = str.maketrans({"\\": r"\\", "%": r"\%", "_": r"\_"})


class PipelineCrud(CrudBase[ModelingPipeline]):
    """`modeling_pipelines` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ModelingPipeline)

    async def get_by_code(
        self, session: AsyncSession, code: str
    ) -> ModelingPipeline | None:
        """按编码取一条。

        Args: session, code。
        """
        rows = await session.execute(
            select(ModelingPipeline).where(ModelingPipeline.code == code)
        )
        return rows.scalars().first()

    async def page(
        self,
        session: AsyncSession,
        *,
        keyword: str | None,
        offset: int,
        limit: int,
        should_include_instances: bool = True,
    ) -> tuple[list[ModelingPipeline], int]:
        """按名称与编码模糊搜一页，连同总数。

        Args: session, keyword, offset, limit。
        """
        return await self.list_page(
            session,
            statement=self._filtered(
                keyword, should_include_instances
            ).order_by(*DEFAULT_ORDER),
            offset=offset,
            limit=limit,
        )

    @staticmethod
    def _filtered(
        keyword: str | None, should_include_instances: bool
    ) -> Select[tuple[ModelingPipeline]]:
        instance_exists = (
            select(ModelingInstance.id)
            .where(ModelingInstance.id == ModelingPipeline.id)
            .exists()
        )
        statement = select(ModelingPipeline)
        if not should_include_instances:
            statement = statement.where(~instance_exists)
        if not keyword:
            return statement
        pattern = f"%{keyword.translate(_LIKE_SPECIALS)}%"
        return statement.where(
            ModelingPipeline.name.ilike(pattern, escape="\\")
            | ModelingPipeline.code.ilike(pattern, escape="\\")
        )


pipeline_crud = PipelineCrud()
