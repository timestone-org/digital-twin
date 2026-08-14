"""整屏模板数据访问。

⚠ 列表查询显式 `defer` 掉 `payload_json`：那一列是整屏包，出参里用不到它，
不 defer 的话「列出 20 条」会从库里拖十几 MB 出来——而这件事在出参上看不出来。
"""

from sqlalchemy import Select, select
from sqlalchemy.orm import defer

from lib.db import CrudBase
from platform_server.apps.dashboard.models import DashboardTemplate

# 新建的排在前面。带上 id 是为了让同一毫秒建出来的两条也有确定序，
# 否则翻页时它们会在两页之间来回跳
DEFAULT_ORDER = (
    DashboardTemplate.created_at.desc(),
    DashboardTemplate.id.desc(),
)


class TemplateCrud(CrudBase[DashboardTemplate]):
    """`dashboard_templates` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(DashboardTemplate)

    @staticmethod
    def build_query(
        *, category: str | None
    ) -> Select[tuple[DashboardTemplate]]:
        """按分类构造列表查询，整包列不进 SELECT。

        Args: category。
        """
        statement = select(DashboardTemplate).options(
            defer(DashboardTemplate.payload_json)
        )
        if category is not None:
            statement = statement.where(DashboardTemplate.category == category)
        return statement.order_by(*DEFAULT_ORDER)


template_crud = TemplateCrud()
