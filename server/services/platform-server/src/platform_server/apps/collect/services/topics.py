"""采集数据源主题的命名与它要求的权限码。

形状照 api-contract §10 的 `<域>:<标识>`。⚠ hub 只把主题当不透明键，「它是
一个采集数据源」这件事只有本模块知道（ADR-0007）。

⚠ `PUBLISHER_NAME` 与大屏那侧**必须不同**：对账靠「向 hub 要我名下的主题，
多出来的注销掉」收敛，两条链路共用一个名字就会互相把对方的主题注销光。
"""

import uuid

from platform_server.apps.collect.catalog import COLLECT_VIEW

TOPIC_PREFIX = "collect"
TOPIC_SEPARATOR = ":"
# 订阅一个数据源的实时值所需的权限码。⚠ 「能看采集配置」与「能订它的实时
# 值」是同一件事，不该有第二套判据；字面量必须存在于 auth-server 的目录，
# 否则 hub 登记被拒
TOPIC_REQUIRED_CODE = COLLECT_VIEW
# 推送方名字，对账时用它向 hub 要「我名下的主题」
PUBLISHER_NAME = "platform-collect"


def topic_of(source_id: uuid.UUID) -> str:
    """一个数据源的主题名。

    Args: source_id。
    """
    return f"{TOPIC_PREFIX}{TOPIC_SEPARATOR}{source_id}"


def source_id_of(topic: str) -> uuid.UUID | None:
    """把主题名解析回数据源 id；不是本域的主题或标识不合法时返回 None。

    ⚠ 认不出来一律返回 None 而不是抛：订阅表里同时躺着别的推送方的主题
    （`dashboard:{id}`、`opcua:{instance_id}`），逐条抛异常会让一条无关主题
    掀翻整拍。
    Args: topic。
    """
    prefix, separator, identifier = topic.partition(TOPIC_SEPARATOR)
    if not separator or prefix != TOPIC_PREFIX:
        return None
    try:
        return uuid.UUID(identifier)
    except ValueError:
        return None
