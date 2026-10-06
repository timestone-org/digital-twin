"""完整 HTTP 写面种合法配置，兼容回归不再临时放宽数据库约束。"""

from dataclasses import dataclass

from conftest import AppContext, CollectFakes

from integration.collect_helpers import create_points, create_source, point_item


@dataclass(frozen=True)
class HttpRows:
    source_id: str
    point_id: str


async def seeded_http(context: AppContext, fakes: CollectFakes) -> HttpRows:
    """所有测试输入遵守完整 HTTP 配置校验，样本随外层事务回滚。

    Args: context, fakes。
    """
    source = await create_source(
        context.client,
        protocol="http",
        endpoint="http://data.test/data",
        read_mode="poll",
        options_json={"auth_type": "none"},
        is_enabled=False,
    )
    points = await create_points(
        context.client, source["id"], point_item(address="/value")
    )
    fakes.bus.sent.clear()
    fakes.plans.published.clear()
    return HttpRows(source["id"], points["items"][0]["id"])
