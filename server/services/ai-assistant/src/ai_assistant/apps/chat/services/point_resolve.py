"""把一批 `node_key` 换成人话：绑定里存的是身份串，串上看不出绑没绑对。

⚠ 上游没有「按一批 node_key 取点位」的口子，只有按 `q` 模糊匹配的那一条，
所以一个 key 就是一次往返。串行 50 次会让一次工具调用等上十几秒，故分批并发。

⚠ 认不出的进 `unknown` 而不是给一条空记录：空记录会被模型读成「这个点位存在、
只是没名字」，于是它不再怀疑这一行绑错了。
"""

import asyncio
import uuid
from typing import Any, cast

from ai_assistant.upstream import PlatformClient

# 一次最多认几个 node_key。⚠ 有上限：每个 key 都是一次上游往返，而模型很容易
# 把整屏几百条绑定一股脑丢进来
MAX_KEYS = 50
# 同时压几个往返给 platform。⚠ 不是越大越好：点位检索在上游是顺序扫描，
# 一次全压过去会把它的连接池占满，而助手不是那一侧唯一的调用方
MAX_IN_FLIGHT = 8


async def resolve_points(
    platform: PlatformClient, headers: dict[str, str], given: object
) -> dict[str, Any]:
    """批量把 node_key 换成名字、编码、单位、数据类型与所属源。

    Args: platform, headers（要转发的身份头）, given（模型给的那串 key）。
    """
    asked = _keys_of(given)
    wanted = asked[:MAX_KEYS]
    found = await _find_all(platform, headers, wanted)
    names = (
        await _source_names(platform, headers) if any(found.values()) else {}
    )
    return {
        "points": [
            _resolved_of(key, row, names)
            for key, row in found.items()
            if row is not None
        ],
        "unknown": [key for key, row in found.items() if row is None],
        "note": _note(len(wanted), len(asked)),
    }


async def _find_all(
    platform: PlatformClient, headers: dict[str, str], keys: list[str]
) -> dict[str, object | None]:
    """逐个找，每 `MAX_IN_FLIGHT` 个一批并发。保序，认不出的留 None。

    Args: platform, headers, keys。
    """
    found: dict[str, object | None] = {}
    for start in range(0, len(keys), MAX_IN_FLIGHT):
        batch = keys[start : start + MAX_IN_FLIGHT]
        rows = await asyncio.gather(
            *(_find_one(platform, headers, one) for one in batch)
        )
        found.update(zip(batch, rows, strict=True))
    return found


async def _find_one(
    platform: PlatformClient, headers: dict[str, str], node_key: str
) -> object | None:
    """找一个点位；读不懂的串与库里没有的都给 None。

    ⚠ 读不懂的串也走 None 而不是抛：一批里混进一个写歪的 key 是常事，
    为它整批失败反而让模型看不见其余那些其实认出来了。

    Args: platform, headers, node_key。
    """
    parts = split_node_key(node_key)
    if parts is None:
        return None
    source_id, code = parts
    return await platform.find_point(headers, source_id=source_id, code=code)


def split_node_key(node_key: str) -> tuple[str, str] | None:
    """拆 `{数据源id}:{点位编码}`；拆不动就给 None。

    ⚠ 前半段必须是 UUID：直接拿去打上游的话，回来的是一个含糊的 422，
    而真正的问题只是 node_key 写错了。

    Args: node_key。
    """
    source_id, _, code = node_key.partition(":")
    if not code or not _is_uuid(source_id):
        return None
    return source_id, code


def _is_uuid(given: str) -> bool:
    try:
        uuid.UUID(given)
    except ValueError:
        return False
    return True


async def _source_names(
    platform: PlatformClient, headers: dict[str, str]
) -> dict[str, str]:
    """数据源 id → 名字。

    ⚠ 点位那一行只带 `source_id`，人话名字得另问一次源清单：不问的话
    `source_name` 就只是一个 uuid，而那与「认出来了」差得很远。

    Args: platform, headers。
    """
    found: dict[str, str] = {}
    for row in await platform.list_sources(headers):
        body = _as_body(row)
        source_id = body.get("id")
        name = body.get("name")
        if isinstance(source_id, str) and isinstance(name, str):
            found[source_id] = name
    return found


def _resolved_of(
    node_key: str, row: object, names: dict[str, str]
) -> dict[str, Any]:
    """一条认出来的点位。

    Args: node_key, row, names（源 id → 名字）。
    """
    body = _as_body(row)
    return {
        "node_key": node_key,
        "name": body.get("name"),
        "code": body.get("code"),
        "unit": body.get("unit"),
        "data_type": body.get("data_type"),
        "source_name": names.get(str(body.get("source_id") or "")),
    }


def _keys_of(given: object) -> list[str]:
    """收下那串 key，去空去重且保序。

    ⚠ 去重是因为一屏绑定里同一个点位常出现在好几行；不去重的话 50 个名额
    有一半花在同一个 key 上。

    Args: given。
    """
    if not isinstance(given, list):
        return []
    found: list[str] = []
    for one in cast("list[object]", given):
        key = one.strip() if isinstance(one, str) else ""
        if key and key not in found:
            found.append(key)
    return found


def _note(shown: int, asked: int) -> str:
    """末尾那句话：截断要挑明，unknown 要按「库里真的没有」念。

    Args: shown, asked。
    """
    if asked > shown:
        return (
            f"一次最多认 {MAX_KEYS} 个，你给了 {asked} 个，只认了前 {shown} 个"
            "——余下的分批再问一次"
        )
    if shown == 0:
        return "没给 node_key"
    return f"共 {shown} 个；unknown 里的是库里真的没有的点位，不要当成有"


def _as_body(row: object) -> dict[str, object]:
    """把上游那一行收成一张确定形状的表。

    Args: row。
    """
    if not isinstance(row, dict):
        return {}
    # ⚠ 收窄一次而不是遍历重建：`isinstance` 从 `object` narrow 出来的是
    # `dict[Unknown, Unknown]`，遍历它的键值同样是未知的
    return cast("dict[str, object]", row)
