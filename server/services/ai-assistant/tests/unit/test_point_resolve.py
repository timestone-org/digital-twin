"""批量把 node_key 换成人话。

守的是「认不出的进 unknown 而不是给一条空记录」：空记录会被模型读成
「这个点位存在、只是没名字」，于是它不再怀疑这一行绑错了。
另外两条是预算：一次最多 50 个，且 50 个不许一个接一个地串行发出去。
"""

import asyncio
import uuid

import httpx

from ai_assistant.apps.chat.services.point_resolve import (
    MAX_IN_FLIGHT,
    MAX_KEYS,
    resolve_points,
)
from ai_assistant.upstream import PlatformClient

HEADERS = {"X-Auth-User-Id": "u1", "X-Auth-Sig": "s1"}
SOURCE_ID = str(uuid.uuid4())
OTHER_SOURCE_ID = str(uuid.uuid4())


def _envelope(data: object) -> httpx.Response:
    return httpx.Response(
        200, json={"code": 0, "message": "ok", "trace_id": "t", "data": data}
    )


def _point(code: str, name: str, source_id: str = SOURCE_ID) -> object:
    return {
        "node_key": f"{source_id}:{code}",
        "source_id": source_id,
        "code": code,
        "name": name,
        "unit": "°C",
        "data_type": "float",
    }


class _Platform:
    """假的业务面：认得 code 的就给那一条，认不得的给空页。

    ⚠ 顺手记下并发峰值：这一层的用例要证明 50 个 key 不是串行发出去的。
    """

    def __init__(self, known: dict[str, str]) -> None:
        """Args: known（code → 名字）。"""
        self.known = known
        self.sources: list[object] = [{"id": SOURCE_ID, "name": "1 号机组 PLC"}]
        self.paths: list[str] = []
        self.in_flight = 0
        self.peak = 0

    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        # 让出一次，别的请求才有机会在同一时刻进来
        await asyncio.sleep(0)
        self.in_flight -= 1
        if request.url.path.endswith("collect-sources"):
            return _envelope({"items": self.sources})
        code = request.url.params.get("q", "")
        asked_source = request.url.params.get("source_id", "")
        name = self.known.get(code)
        rows = [_point(code, name, asked_source)] if name else []
        return _envelope({"items": rows, "page": 1, "size": 200, "total": 1})


def _client(platform: _Platform) -> PlatformClient:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(platform.handle))
    return client


def _key(code: str, source_id: str = SOURCE_ID) -> str:
    return f"{source_id}:{code}"


async def test_a_batch_comes_back_as_names_units_and_a_source() -> None:
    platform = _Platform({"K1_TMT_OUT_T_PI": "1号机组出口温度"})

    body = await resolve_points(
        _client(platform), HEADERS, [_key("K1_TMT_OUT_T_PI")]
    )

    assert body["points"] == [
        {
            "node_key": _key("K1_TMT_OUT_T_PI"),
            "name": "1号机组出口温度",
            "code": "K1_TMT_OUT_T_PI",
            "unit": "°C",
            "data_type": "float",
            "source_name": "1 号机组 PLC",
        }
    ]
    assert body["unknown"] == []


async def test_a_key_the_library_never_heard_of_goes_to_unknown() -> None:
    """空记录会被读成「这个点位存在、只是没名字」，于是它不再怀疑绑错了。"""
    platform = _Platform({"K1_REAL": "真的有这个"})

    body = await resolve_points(
        _client(platform), HEADERS, [_key("K1_REAL"), _key("K1_GHOST")]
    )

    assert body["unknown"] == [_key("K1_GHOST")]
    assert [one["node_key"] for one in body["points"]] == [_key("K1_REAL")]


async def test_a_key_nobody_can_parse_does_not_sink_the_whole_batch() -> None:
    """一批里混进一个写歪的串是常事，为它整批失败反而更难查。"""
    platform = _Platform({"K1_REAL": "真的有这个"})

    body = await resolve_points(
        _client(platform), HEADERS, ["随手写的", _key("K1_REAL")]
    )

    assert body["unknown"] == ["随手写的"]
    assert len(body["points"]) == 1
    # 读不懂的串一次都不许打上游：那边回的是一条含糊的 422
    assert sum(1 for one in platform.paths if "collect-points" in one) == 1


async def test_too_many_keys_are_cut_and_the_note_says_it_out_loud() -> None:
    """悄悄截断会让模型把「剩下那些不存在」当成结论。"""
    platform = _Platform({f"C{index}": f"点位{index}" for index in range(60)})

    body = await resolve_points(
        _client(platform), HEADERS, [_key(f"C{index}") for index in range(60)]
    )

    assert len(body["points"]) == MAX_KEYS
    assert "60" in str(body["note"])
    assert str(MAX_KEYS) in str(body["note"])


async def test_the_same_key_twice_costs_one_round_trip() -> None:
    """一屏绑定里同一个点位常出现在好几行，不去重就白花名额。"""
    platform = _Platform({"K1_REAL": "真的有这个"})

    body = await resolve_points(
        _client(platform), HEADERS, [_key("K1_REAL"), _key("K1_REAL")]
    )

    assert len(body["points"]) == 1
    assert sum(1 for one in platform.paths if "collect-points" in one) == 1


async def test_a_full_batch_goes_out_concurrently_not_one_by_one() -> None:
    """串行 50 次往返会让一次工具调用等上十几秒。"""
    platform = _Platform({f"C{index}": f"点位{index}" for index in range(50)})

    await resolve_points(
        _client(platform), HEADERS, [_key(f"C{index}") for index in range(50)]
    )

    assert platform.peak > 1
    # 也不许一次全压过去：上游那侧的点位检索是顺序扫描
    assert platform.peak <= MAX_IN_FLIGHT


async def test_nothing_asked_touches_nothing_upstream() -> None:
    platform = _Platform({})

    body = await resolve_points(_client(platform), HEADERS, None)

    assert body == {"points": [], "unknown": [], "note": "没给 node_key"}
    assert platform.paths == []


async def test_an_all_unknown_batch_skips_the_source_lookup() -> None:
    """一个都没认出来时，源清单那一次往返是白发的。"""
    platform = _Platform({})

    await resolve_points(_client(platform), HEADERS, [_key("K1_GHOST")])

    assert not any("collect-sources" in one for one in platform.paths)


async def test_a_point_from_an_unlisted_source_still_comes_back() -> None:
    """源清单里没有它时 `source_name` 留空，但这一条本身仍然是认出来了的。"""
    platform = _Platform({"K9_X": "别处的点位"})

    body = await resolve_points(
        _client(platform), HEADERS, [_key("K9_X", OTHER_SOURCE_ID)]
    )

    assert body["unknown"] == []
    found = body["points"]
    assert isinstance(found, list)
    assert found[0]["name"] == "别处的点位"
    assert found[0]["source_name"] is None


async def test_a_junk_row_in_the_source_list_does_not_sink_the_answer() -> None:
    """上游多一格少一格是常事，认不出的源只是少一个名字，不是整批失败。"""
    platform = _Platform({"K1_REAL": "真的有这个"})
    platform.sources = ["这不是一行", {"id": SOURCE_ID}]

    body = await resolve_points(_client(platform), HEADERS, [_key("K1_REAL")])

    found = body["points"]
    assert isinstance(found, list)
    assert found[0]["source_name"] is None
