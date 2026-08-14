"""大屏主题的命名与它要求的权限码。

形状照 api-contract §10 的 `<域>:<标识>`。⚠ hub 只把主题当不透明键，「它是
一张大屏」这件事只有本模块知道——这正是 ADR-0007 要的方向。
"""

import uuid

from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW

TOPIC_PREFIX = "dashboard"
TOPIC_SEPARATOR = ":"
# 订阅一张大屏所需的权限码。⚠ 「能看这张大屏」与「能订它的实时值」是同一件
# 事，不该有第二套判据；字面量必须存在于 auth-server 的目录，否则登记被拒
TOPIC_REQUIRED_CODE = DASHBOARD_VIEW
# 推送方名字，对账时用它向 hub 要「我名下的主题」
PUBLISHER_NAME = "platform-publisher"


def topic_of(dashboard_id: uuid.UUID) -> str:
    """一张大屏的主题名。

    Args: dashboard_id。
    """
    return f"{TOPIC_PREFIX}{TOPIC_SEPARATOR}{dashboard_id}"


def dashboard_id_of(topic: str) -> uuid.UUID | None:
    """把主题名解析回大屏 id；不是本域的主题或标识不合法时返回 None。

    ⚠ 认不出来一律返回 None 而不是抛：订阅表里同时躺着别的推送方的主题
    （`opcua:{instance_id}` 之类），逐条抛异常会让一条无关主题掀翻整拍。
    Args: topic。
    """
    prefix, separator, identifier = topic.partition(TOPIC_SEPARATOR)
    if not separator or prefix != TOPIC_PREFIX:
        return None
    try:
        return uuid.UUID(identifier)
    except ValueError:
        return None
