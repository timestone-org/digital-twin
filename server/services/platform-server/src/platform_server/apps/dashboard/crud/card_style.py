"""卡片样式数据访问。

⚠ 两袋 JSON **不 defer**：样式墙上每一格都要照着取值渲染一张预览，列表页本来
就要它们（与整屏模板刻意相反，那边一份包几百 KB，列表必须把它挡在查询外）。
"""

from sqlalchemy import Select, select

from lib.db import CrudBase
from platform_server.apps.dashboard.models import CardStyle

# 刚改过的排在前面——用户存完一条就回列表找它。带上 id 是为了让同一毫秒
# 落库的两条也有确定序，否则翻页时它们会在两页之间来回跳
DEFAULT_ORDER = (CardStyle.updated_at.desc(), CardStyle.id.desc())


class CardStyleCrud(CrudBase[CardStyle]):
    """`card_styles` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(CardStyle)

    @staticmethod
    def build_query(*, module_type: str | None) -> Select[tuple[CardStyle]]:
        """按模块类型构造列表查询。

        ⚠ 不传 `module_type` 是「全都要」，与传空串截然不同：通用外壳样式那一档
        的列值是 `NULL`，要单挑它得走 `module_type IS NULL`，而入参层已把空串
        挡在外面（`ModuleType` 限了最小长度）。
        Args: module_type。
        """
        statement = select(CardStyle)
        if module_type is not None:
            statement = statement.where(CardStyle.module_type == module_type)
        return statement.order_by(*DEFAULT_ORDER)


card_style_crud = CardStyleCrud()
