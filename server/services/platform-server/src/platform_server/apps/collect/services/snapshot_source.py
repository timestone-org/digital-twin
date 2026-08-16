"""点位当前值的读侧：从 collector 写的 Redis 快照里按点位取读数。

键与字段形状的唯一真源是 `collectwire`，写侧用的是同一份（ADR-0017）。
⚠ 只 HMGET 要用的字段，**绝不 HGETALL**：一个数据源下可能挂着上万个点位，
而一张大屏只绑其中十几个。
"""

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, cast
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from collectwire import (
    FIELD_QUALITY,
    FIELD_TIMESTAMP_MS,
    FIELD_VALUE,
    snapshot_key,
)
from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from timeseries import (
    InvalidNodeKey,
    Quality,
    compose_node_key,
    normalize_quality,
    split_node_key,
)

_logger = get_logger("platform.collect.snapshot")


@dataclass(frozen=True)
class PointReading:
    """一个点位的当前读数。"""

    value: object
    timestamp_ms: int
    quality: Quality


class SnapshotSource(Protocol):
    """快照读侧的最小面。真实现打 Redis，测试用进程内假件。"""

    async def read(
        self, node_keys: Sequence[str]
    ) -> dict[str, PointReading]: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class RedisSnapshotSource:
    """Redis 哈希实现。构造不连网。"""

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

    async def read(self, node_keys: Sequence[str]) -> dict[str, PointReading]:
        """取一批点位的当前读数。取不到的点位**不出现在结果里**。

        ⚠ 缺失与「值是 0」必须分得开：补一个零值等于凭空造一条现场读数。
        调用方据「不在结果里」判定取不到，并把它如实标成 error。

        Args: node_keys。
        """
        grouped = group_by_source(node_keys)
        if not grouped:
            return {}
        pipeline = self._client.pipeline()
        for source_id, codes in grouped.items():
            # ⚠ 只取本屏用得上的字段，不 HGETALL
            pipeline.hmget(snapshot_key(source_id), list(codes))
        rows: Any = await self._run(pipeline.execute())
        return decode_rows(grouped, rows)

    async def ping(self) -> bool:
        """连通性自检。不抛，供启动自检复用。"""
        try:
            await self._client.ping()  # pyright: ignore[reportUnknownMemberType]
        except RedisError as error:
            _logger.warning("redis_ping_failed", "Redis 不可达", error=error)
            return False
        return True

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用", context={"dependency": "redis"}
            ) from error


def group_by_source(node_keys: Iterable[str]) -> dict[UUID, tuple[str, ...]]:
    """把点位身份按数据源分组，组内按 `point_code` 排序去重。

    形状不合法的身份直接丢掉：它取不到值，调用方会把它标成 error，而不是让
    整批读数一起失败。
    Args: node_keys。
    """
    grouped: dict[UUID, set[str]] = {}
    for node_key in node_keys:
        try:
            source_id, point_code = split_node_key(node_key)
        except InvalidNodeKey:
            _logger.warning(
                "node_key_malformed", "点位身份形状不合法，本次取值跳过它"
            )
            continue
        grouped.setdefault(source_id, set()).add(point_code)
    return {
        source_id: tuple(sorted(codes)) for source_id, codes in grouped.items()
    }


def decode_rows(
    grouped: Mapping[UUID, tuple[str, ...]], rows: Sequence[Any]
) -> dict[str, PointReading]:
    """把 HMGET 的逐行结果解码成按点位身份索引的读数。

    Args: grouped（与 rows 同序）, rows。
    """
    readings: dict[str, PointReading] = {}
    for (source_id, codes), values in zip(grouped.items(), rows, strict=False):
        for point_code, raw in zip(codes, values, strict=False):
            reading = decode_reading(raw)
            if reading is not None:
                readings[compose_node_key(source_id, point_code)] = reading
    return readings


def decode_reading(raw: object) -> PointReading | None:
    """把一个哈希字段解码成读数；缺失或损坏返回 None。

    ⚠ 损坏不当成「值是 null」：那会让一次编码事故看起来像现场真的报了空值。
    Args: raw。
    """
    if not isinstance(raw, str):
        return None
    try:
        parsed: object = json.loads(raw)
    except json.JSONDecodeError:
        _logger.warning("snapshot_value_corrupt", "快照值不是合法 JSON")
        return None
    if not isinstance(parsed, dict):
        return None
    # cast 的理由 —— json.loads 的返回是 Any，isinstance 只能窄到
    # dict[Unknown, Unknown]；键类型由 JSON 语法保证是 str
    fields = cast("dict[str, Any]", parsed)
    timestamp_ms = fields.get(FIELD_TIMESTAMP_MS)
    if not isinstance(timestamp_ms, int):
        _logger.warning("snapshot_value_corrupt", "快照值缺采样时刻")
        return None
    return PointReading(
        value=fields.get(FIELD_VALUE),
        timestamp_ms=timestamp_ms,
        quality=normalize_quality(fields.get(FIELD_QUALITY)),
    )
