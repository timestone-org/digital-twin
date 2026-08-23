"""公式库的数据访问。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.dataset.models import DatasetFormula

# 列表页与插入面板都按分类分组，组内按名称。第三排序键钉住同名条目的先后
DEFAULT_ORDER = (
    DatasetFormula.category.asc(),
    DatasetFormula.name.asc(),
    DatasetFormula.code.asc(),
)


class FormulaCrud(CrudBase[DatasetFormula]):
    """`dataset_formulas` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DatasetFormula)

    async def list_all(self, session: AsyncSession) -> list[DatasetFormula]:
        """全部条目，**含停用的**。

        ⚠ 不加 `WHERE is_enabled`：快照里少了停用的那条，引用它的公式就只能
        报「公式库里没有 X」，而真话是「X 被停用了」——前者会把人送去建一条
        已经存在的公式（docs/DATASET_DESIGN.md §5.11）。
        Args: session。
        """
        rows = await session.execute(
            select(DatasetFormula).order_by(*DEFAULT_ORDER)
        )
        return list(rows.scalars().all())

    async def search(
        self,
        session: AsyncSession,
        *,
        keyword: str | None = None,
        category: str | None = None,
    ) -> list[DatasetFormula]:
        """按关键字与分类筛。集合只有几十条，故不分页。

        Args: session, keyword, category。
        """
        statement = select(DatasetFormula).order_by(*DEFAULT_ORDER)
        if category:
            statement = statement.where(DatasetFormula.category == category)
        if keyword:
            like = f"%{keyword}%"
            statement = statement.where(
                DatasetFormula.code.ilike(like)
                | DatasetFormula.name.ilike(like)
            )
        rows = await session.execute(statement)
        return list(rows.scalars().all())

    async def get_by_code(
        self, session: AsyncSession, code: str
    ) -> DatasetFormula | None:
        """按标识取一条。

        Args: session, code。
        """
        rows = await session.execute(
            select(DatasetFormula).where(DatasetFormula.code == code)
        )
        return rows.scalars().first()


formula_crud = FormulaCrud()
