"""点位身份 `node_key` 的组合与拆分：`{source_id}:{point_code}`。

口径与「point_code 是身份而 address 是配置」的理由见 docs/COLLECT_DESIGN.md §2。
"""

from uuid import UUID

SEPARATOR = ":"  # 数据源与点位编码之间的分隔符


class InvalidNodeKey(ValueError):
    """不符合 `{source_id}:{point_code}` 口径的 node_key。"""


def compose_node_key(source_id: UUID, point_code: str) -> str:
    """拼出一个点位的 node_key。

    Args: source_id, point_code。
    """
    if not point_code:
        raise InvalidNodeKey("point_code 不许为空")
    return f"{source_id}{SEPARATOR}{point_code}"


def split_node_key(node_key: str) -> tuple[UUID, str]:
    """把 node_key 拆回数据源与点位编码，不合法即抛 InvalidNodeKey。

    Args: node_key。
    """
    # ⚠ 只切第一个冒号：source_id 是 UUID 不含冒号，而 point_code 可以含
    source_text, separator, point_code = node_key.partition(SEPARATOR)
    if not separator:
        raise InvalidNodeKey(f"node_key 缺分隔符 {SEPARATOR!r}：{node_key!r}")
    if not point_code:
        raise InvalidNodeKey(f"node_key 的 point_code 为空：{node_key!r}")
    try:
        source_id = UUID(source_text)
    except ValueError as error:
        raise InvalidNodeKey(
            f"node_key 的 source_id 不是 UUID：{node_key!r}"
        ) from error
    return source_id, point_code
