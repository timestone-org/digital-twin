"""在用例回滚事务中模拟以后扩展迁移产生的 HTTP 行。"""

from dataclasses import dataclass

from conftest import AppContext, CollectFakes
from sqlalchemy import text

from integration.collect_helpers import create_points, create_source


@dataclass(frozen=True)
class HttpRows:
    source_id: str
    point_id: str


async def seeded_http(context: AppContext, fakes: CollectFakes) -> HttpRows:
    """约束扩展与种行只在独立测试库的外层回滚事务里生效。

    Args: context, fakes。
    """
    source = await create_source(context.client)
    points = await create_points(context.client, source["id"])
    await context.session.execute(
        text(
            "ALTER TABLE platform.collect_sources"
            " DROP CONSTRAINT ck_collect_sources_protocol_known"
        )
    )
    await context.session.execute(
        text(
            "ALTER TABLE platform.collect_sources ADD CONSTRAINT"
            " ck_collect_sources_protocol_known"
            " CHECK (protocol IN ('http', 'modbus_tcp', 'opcua'))"
        )
    )
    await context.session.execute(
        text(
            "UPDATE platform.collect_sources SET protocol = 'http',"
            " endpoint = 'http://data.test/data', read_mode = 'poll'"
            " WHERE id = :id"
        ),
        {"id": source["id"]},
    )
    fakes.bus.sent.clear()
    fakes.plans.published.clear()
    return HttpRows(source["id"], points["items"][0]["id"])
