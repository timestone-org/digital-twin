"""同步台账点位引用与非强制点位删除，口径见 docs/COLLECT_DESIGN.md §5.2。"""

from collections.abc import Sequence
from hashlib import blake2b

from sqlalchemy import BigInteger, bindparam, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from timeseries import InvalidNodeKey, compose_node_key, split_node_key

_LOCK_NAMESPACE = b"dt-point-ref-v1"
_ACQUIRE = text(
    "SELECT pg_advisory_xact_lock(ordered.lock_id) "
    "FROM (SELECT unnest(:lock_ids) AS lock_id ORDER BY lock_id) AS ordered"
).bindparams(bindparam("lock_ids", type_=ARRAY(BigInteger())))


async def lock_point_references(
    session: AsyncSession, node_keys: Sequence[str]
) -> None:
    """按稳定顺序一次加锁，支持尚未有点位行的配置。

    Args: session, node_keys。
    """
    candidates = {_lock_id(node_key) for node_key in node_keys}
    locks = [item for item in candidates if item is not None]
    if locks:
        await session.execute(_ACQUIRE, {"lock_ids": locks})


def _lock_id(node_key: str) -> int | None:
    """为同一点位的所有 UUID 拼法生成同一个锁编号。Args: node_key。"""
    try:
        source_id, code = split_node_key(node_key)
    except InvalidNodeKey:
        return None
    key = compose_node_key(source_id, code).encode()
    digest = blake2b(key, digest_size=8, person=_LOCK_NAMESPACE).digest()
    return int.from_bytes(digest, "big", signed=True)
