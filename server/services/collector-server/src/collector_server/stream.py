"""Redis 归档流：一个数据源一条 Stream，采集侧写、落库侧读完即删。

零业务逻辑——准入与编码归 apps/collect/archive，本模块只搬 JSON 并统一
收敛 Redis 异常。
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from collectwire import TRACEPARENT_KEY
from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("collect.stream")

KEY_PREFIX = "collect:archive"
# 条目载荷的字段名，与 writer 的解码一一对应
ROWS_FIELD = "rows"
# SCAN 一次取多少键。采集自己的键只有数据源那么多，不必调大
SCAN_CHUNK = 100
# 防止 SCAN 在异常的键空间里无限转下去
MAX_SCAN_ROUNDS = 1000


def stream_key(source_id: UUID) -> str:
    """一个数据源的归档流键。

    Args: source_id。
    """
    return f"{KEY_PREFIX}:{source_id}"


def source_of(key: str) -> UUID | None:
    """从流键取回数据源 id；不是本服务的键就给 None。

    ⚠ source_id 只存在于**键名**里，不在每一行里重复：一行历史只有六列，
    多一列就多一份写放大（COLLECT_DESIGN.md §6）。

    Args: key。
    """
    prefix, separator, tail = key.partition(f"{KEY_PREFIX}:")
    if prefix or not separator:
        return None
    try:
        return UUID(tail)
    except ValueError:
        return None


def envelope_with_traceparent(
    rows: Sequence[Mapping[str, object]],
) -> dict[str, str]:
    """把一批行编成条目的字段表。

    ⚠ 链路必须随信封一起走：落库发生在另一拍、可能在另一个副本上，漏了它
    链路就在异步处齐断（observability §4.2）。

    Args: rows。
    """
    return {
        ROWS_FIELD: json.dumps(list(rows), ensure_ascii=False, default=str),
        TRACEPARENT_KEY: current_traceparent(),
    }


@dataclass(frozen=True)
class StreamEntry:
    """一条 Stream 条目：一批行加它的 id。id 是 XDEL 的凭据。"""

    entry_id: str
    rows: tuple[Mapping[str, Any], ...]


class ArchiveStream(Protocol):
    """归档流的读写面。真实现打 Redis，测试用进程内假件。"""

    async def append(
        self,
        source_id: UUID,
        rows: Sequence[Mapping[str, object]],
        *,
        maxlen: int,
    ) -> int: ...

    async def keys(self) -> list[str]: ...

    async def read(self, key: str, *, count: int) -> list[StreamEntry]: ...

    async def delete(self, key: str, entry_ids: Sequence[str]) -> int: ...

    async def close(self) -> None: ...


class RedisArchiveStream:
    """Redis Stream 实现。生产端与消费端共用一个连接池。"""

    def __init__(self, *, url: str, timeout_s: float = 1.0) -> None:
        """按连接串初始化。

        Args: url, timeout_s。
        """
        # pyright: ignore 的理由 —— redis-py 的 from_url 形参标成 Unknown
        self._client: Redis = (
            Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
                url,
                decode_responses=True,
                socket_timeout=timeout_s,
                socket_connect_timeout=timeout_s,
            )
        )

    async def append(
        self,
        source_id: UUID,
        rows: Sequence[Mapping[str, object]],
        *,
        maxlen: int,
    ) -> int:
        """追加一批行，返回追加后的流长度。

        ⚠ 必须带 traceparent：落库发生在另一拍、可能在另一个副本上，信封里
        漏了它链路就在异步处齐断（observability §4.2）。
        ⚠ `MAXLEN ~` 裁掉的是**最旧**的条目：长度顶到上限就等于在丢历史，
        所以这里把长度回给调用方去告警。

        Args: source_id, rows, maxlen。
        """
        payload = envelope_with_traceparent(rows)
        key = stream_key(source_id)
        pipeline = self._client.pipeline()
        # cast 的理由 —— redis-py 的 fields 形参用了自己的编码类型变量
        pipeline.xadd(
            key, cast("Any", payload), maxlen=maxlen, approximate=True
        )
        pipeline.xlen(key)
        outcome = cast("Sequence[Any]", await self._run(pipeline.execute()))
        return int(outcome[-1])

    async def keys(self) -> list[str]:
        """扫出此刻存在的全部归档流键。

        ⚠ 用扫描而不是照计划列举：数据源从计划里删掉之后，它留在流里的行
        仍然必须落库——按计划列举会让那些行永远排不出去。
        """
        found: list[str] = []
        cursor = 0
        for _ in range(MAX_SCAN_ROUNDS):
            cursor, batch = await self._scan(cursor)
            found.extend(batch)
            if cursor == 0:
                break
        return found

    async def read(self, key: str, *, count: int) -> list[StreamEntry]:
        """从最旧的一端取若干条目，不消费也不加锁。

        Args: key, count。
        """
        raw = await self._run(
            self._client.xrange(
                key, count=count
            )  # pyright: ignore[reportUnknownMemberType]
        )
        entries = cast("Sequence[Any]", raw)
        return [entry for item in entries if (entry := decode_entry(item))]

    async def delete(self, key: str, entry_ids: Sequence[str]) -> int:
        """删掉已经落库的条目。

        ⚠ 只允许在**写库成功之后**调用：反过来会在库写失败时丢数据
        （COLLECT_DESIGN.md §4.3 ⑦）。

        Args: key, entry_ids。
        """
        if not entry_ids:
            return 0
        deleted = await self._run(self._client.xdel(key, *entry_ids))
        return int(cast("int", deleted))

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    async def _scan(self, cursor: int) -> tuple[int, list[str]]:
        raw = await self._run(
            self._client.scan(  # pyright: ignore[reportUnknownMemberType]
                cursor=cursor, match=f"{KEY_PREFIX}:*", count=SCAN_CHUNK
            )
        )
        cursor_and_keys = cast("tuple[int, Sequence[Any]]", raw)
        return int(cursor_and_keys[0]), [str(key) for key in cursor_and_keys[1]]

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "归档流暂时不可用", context={"dependency": "redis"}
            ) from error


def decode_entry(item: object) -> StreamEntry | None:
    """把 XRANGE 的一项解成条目；解不出给 None。

    ⚠ 一条坏条目不许让落库循环退出，否则它会把整条流永久堵死。

    Args: item。
    """
    if not isinstance(item, list | tuple):
        return None
    pair = cast("Sequence[object]", item)
    entry_id = pair[0]
    fields = pair[1] if len(pair) > 1 else None
    if not isinstance(entry_id, str) or not isinstance(fields, dict):
        return None
    body = cast("Mapping[str, object]", fields).get(ROWS_FIELD)
    if not isinstance(body, str):
        return None
    return StreamEntry(entry_id=entry_id, rows=_rows(body))


def _rows(body: str) -> tuple[Mapping[str, Any], ...]:
    """解出条目里的行；解不出就是空批。

    Args: body。
    """
    try:
        decoded: object = json.loads(body)
    except json.JSONDecodeError:
        _logger.warning(
            "archive_entry_undecodable", "归档条目不是合法 JSON，已跳过"
        )
        return ()
    if not isinstance(decoded, list):
        return ()
    rows = cast("Sequence[object]", decoded)
    # JSON 的边界：未知类型在这里收敛成有类型的行，不许流进落库层
    return tuple(
        cast("Mapping[str, Any]", row) for row in rows if isinstance(row, dict)
    )
