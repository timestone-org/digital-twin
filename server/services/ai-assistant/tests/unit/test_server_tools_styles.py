"""卡片样式库的四件工具：列、展开、存、删。

守的是「一整套观感是一等资源」——改观感之前先看库里有没有现成的，而不是
逐个字段去凑 40 个外壳键（凑到一半被打断，画面就停在半套样式上）。

⚠ 这一组里几乎每一条守的都是静默故障：清单带上两袋取值就把技能正文与工具
结果挤出上下文；改一条样式时捎上一袋空 `chrome` 会把用户调好的外壳整袋抹平；
删成功回的是 204 空体，照着信封去解会被读成「删失败」。
"""

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from ai_assistant.apps.chat.services.card_styles import StyleRequestRefused
from ai_assistant.apps.chat.services.server_tools import (
    ServerTools,
    UnknownServerTool,
)
from ai_assistant.upstream import PlatformClient, PlatformUnavailable

Handler = Callable[[httpx.Request], httpx.Response]

HEADERS = {"X-Auth-User-Id": "u1", "X-Auth-Sig": "s1"}
STYLE_ID = "0198e2a1-3c4d-7a11-9f00-2b7c5d6e8a90"


def _tools(handler: Handler) -> ServerTools:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return ServerTools(platform=client, headers=dict(HEADERS))


def _envelope(data: object) -> httpx.Response:
    return httpx.Response(
        200,
        json={"code": 0, "message": "ok", "trace_id": "t", "data": data},
    )


def _style(**overrides: object) -> dict[str, object]:
    """上游那一行的完整形状，线上字段名是 snake_case。"""
    row: dict[str, object] = {
        "id": STYLE_ID,
        "name": "暗金报表风",
        "description": "深底细描边，标题带竖条。",
        "module_type": "info-card",
        "chrome_json": {"borderStyle": "hairline", "radius": 4},
        "config_json": {"labelPosition": "below"},
        "thumbnail": "data:image/png;base64,AAAA",
        "created_at": "2026-08-29T02:00:00Z",
        "updated_at": "2026-08-29T03:00:00Z",
    }
    return {**row, **overrides}


def _listing(rows: list[dict[str, object]]) -> Handler:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _envelope(
            {"items": rows, "page": 1, "size": 200, "total": len(rows)}
        )

    return handler


def _one(row: dict[str, object]) -> Handler:
    def handler(_request: httpx.Request) -> httpx.Response:
        return _envelope(row)

    return handler


class _Recorder:
    """记下发出去的那一次请求，用来验调用形状。"""

    def __init__(self, response: httpx.Response) -> None:
        self.calls: list[httpx.Request] = []
        self.bodies: list[Any] = []
        self._response = response

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        self.bodies.append(
            json.loads(request.content) if request.content else None
        )
        return self._response


async def test_the_style_list_leaves_the_two_json_bags_out() -> None:
    """名片只认样式是谁。

    ⚠ 一条样式的外壳就有 40 个键，整表带上取值会把技能正文与工具结果一起
    挤出上下文；缩略图更是一张几十 KB 的 data URL。
    """
    got = await _tools(_listing([_style()]))("styles.list", {})
    assert isinstance(got, dict)
    styles = got["styles"]
    assert isinstance(styles, list)
    card = styles[0]
    assert card == {
        "id": STYLE_ID,
        "name": "暗金报表风",
        "description": "深底细描边，标题带竖条。",
        "module_type": "info-card",
    }


async def test_the_module_type_narrows_the_listing_upstream() -> None:
    recorder = _Recorder(
        _envelope({"items": [], "page": 1, "size": 200, "total": 0})
    )

    await _tools(recorder)("styles.list", {"module_type": "info-card"})
    assert dict(recorder.calls[0].url.params)["module_type"] == "info-card"


async def test_an_empty_library_says_how_to_get_a_first_style() -> None:
    """空库照「真的没有」念，并指一条起步的路。

    ⚠ 含糊过去的话，模型会编一个 style_id 去套，回来的是一次调用失败，
    而它多半会当成自己这一侧坏了。
    """
    got = await _tools(_listing([]))("styles.list", {})
    assert isinstance(got, dict)
    assert got["styles"] == []
    note = str(got["note"])
    assert "不要编一个 style_id" in note
    assert "styles.save" in note


async def test_an_empty_module_scoped_library_names_that_module() -> None:
    got = await _tools(_listing([]))(
        "styles.list", {"module_type": "gauge-card"}
    )
    assert isinstance(got, dict)
    # 「整个库是空的」与「这一类还没有」是两件事
    assert "绑 gauge-card 的" in str(got["note"])


async def test_a_long_library_says_it_was_clipped() -> None:
    rows = [_style(id=f"s{one}", name=f"样式{one}") for one in range(25)]
    got = await _tools(_listing(rows))("styles.list", {})
    assert isinstance(got, dict)
    styles = got["styles"]
    assert isinstance(styles, list)
    assert len(styles) == 20
    # 不说明截断，模型会把「前 20 条里没有」读成「库里没有」
    assert "共 25 条" in str(got["note"])


async def test_expanding_a_style_gives_both_bags_under_the_save_keys() -> None:
    """出参的 chrome / config 与 styles.save 的入参同名，能原样递回去。"""
    got = await _tools(_one(_style()))("styles.get", {"style_id": STYLE_ID})
    assert isinstance(got, dict)
    style = got["style"]
    assert isinstance(style, dict)
    assert style["chrome"] == {"borderStyle": "hairline", "radius": 4}
    assert style["config"] == {"labelPosition": "below"}
    assert style["module_type"] == "info-card"


async def test_expanding_says_to_delete_the_keys_the_style_omits() -> None:
    """外壳是「键不存在 = 没设置」，留着就是上一套样式的残留。"""
    got = await _tools(_one(_style()))("styles.get", {"style_id": STYLE_ID})
    assert isinstance(got, dict)
    note = str(got["note"])
    assert "null" in note
    assert "__cardStyle" in note


async def test_a_style_without_the_two_bags_reads_as_empty_not_a_crash() -> (
    None
):
    got = await _tools(_one(_style(chrome_json=None, config_json=None)))(
        "styles.get", {"style_id": STYLE_ID}
    )
    assert isinstance(got, dict)
    style = got["style"]
    assert isinstance(style, dict)
    assert style["chrome"] == {}
    assert style["config"] == {}


async def test_a_response_that_is_not_a_style_reads_as_empty() -> None:
    """上游换了形状时宁可空，也不要在几个文件之外炸出一个看不懂的类型错。"""

    def handler(_request: httpx.Request) -> httpx.Response:
        return _envelope(["不是一条样式"])

    got = await _tools(handler)("styles.get", {"style_id": STYLE_ID})
    assert isinstance(got, dict)
    style = got["style"]
    assert isinstance(style, dict)
    assert style["id"] is None
    assert style["chrome"] == {}


async def test_saving_a_new_style_posts_with_an_idempotency_key() -> None:
    """网络抖一下重发一次，不带幂等键就会存出两条一模一样的样式。"""
    recorder = _Recorder(_envelope(_style()))

    await _tools(recorder)(
        "styles.save",
        {
            "name": "暗金报表风",
            "description": "深底细描边。",
            "module_type": "info-card",
            "chrome": {"borderStyle": "hairline"},
            "config": {"labelPosition": "below"},
        },
    )
    request = recorder.calls[0]
    assert request.method == "POST"
    assert request.url.path == "/api/v1/platform/card-styles"
    assert request.headers.get("idempotency-key")
    assert recorder.bodies[0] == {
        "name": "暗金报表风",
        "description": "深底细描边。",
        "module_type": "info-card",
        "chrome_json": {"borderStyle": "hairline"},
        "config_json": {"labelPosition": "below"},
    }


async def test_the_identity_headers_go_along_with_the_write() -> None:
    """写样式一样按用户自己的权限判定，助手不是绕过权限的通道。"""
    recorder = _Recorder(_envelope(_style()))

    await _tools(recorder)(
        "styles.save", {"name": "暗金", "chrome": {"radius": 4}}
    )
    for name, value in HEADERS.items():
        assert recorder.calls[0].headers[name.lower()] == value


async def test_naming_a_style_id_patches_that_one() -> None:
    recorder = _Recorder(_envelope(_style()))

    got = await _tools(recorder)(
        "styles.save",
        {
            "style_id": STYLE_ID,
            "name": "暗金报表风",
            "chrome": {"borderStyle": "none"},
        },
    )
    request = recorder.calls[0]
    assert request.method == "PATCH"
    assert request.url.path == f"/api/v1/platform/card-styles/{STYLE_ID}"
    assert isinstance(got, dict)
    assert "全站共享" in str(got["note"])


async def test_an_edit_never_carries_the_keys_it_was_not_given() -> None:
    """没给的键一格都不带。

    ⚠ 捎上 `module_type: null` 会把一条绑 info-card 的样式变成通用样式、
    内芯随即整段作废；捎上一袋空 chrome 则把用户调好的外壳整袋抹平。
    """
    recorder = _Recorder(_envelope(_style()))

    await _tools(recorder)(
        "styles.save", {"style_id": STYLE_ID, "name": "改个名字"}
    )
    assert recorder.bodies[0] == {"name": "改个名字"}


async def test_an_edit_may_not_change_the_module_type() -> None:
    """换类型 = 那袋内芯当场作废，要换就复制一条。

    ⚠ 当场拒而不是捎上去：上游的 PATCH 入参里根本没有这一格，捎上去回的是
    一句「多了字段」的 422，看不出真正的约束是什么。
    """
    recorder = _Recorder(_envelope(_style()))

    with pytest.raises(StyleRequestRefused, match="module_type"):
        await _tools(recorder)(
            "styles.save",
            {
                "style_id": STYLE_ID,
                "name": "暗金报表风",
                "module_type": "gauge-card",
                "chrome": {"radius": 4},
            },
        )
    assert recorder.calls == []


async def test_a_generic_style_may_not_carry_an_inner_core() -> None:
    """不绑模块类型却带内芯：套到别的模块上既不报错也不生效。"""
    recorder = _Recorder(_envelope(_style()))

    with pytest.raises(StyleRequestRefused, match="module_type"):
        await _tools(recorder)(
            "styles.save",
            {"name": "通用外壳", "chrome": {}, "config": {"columns": 2}},
        )
    # 指到字段地当场拒，而不是打上去换一个含糊的 400 回来
    assert recorder.calls == []


async def test_a_new_style_with_no_look_at_all_is_refused() -> None:
    recorder = _Recorder(_envelope(_style()))

    with pytest.raises(StyleRequestRefused, match="chrome"):
        await _tools(recorder)("styles.save", {"name": "空的"})
    assert recorder.calls == []


async def test_a_chrome_that_is_not_a_bag_is_refused() -> None:
    """整袋被序列化成一个串是常见的一种写错。

    ⚠ 当空袋收下的话，存进去的是一条什么观感都没有的样式，而它看着存成功了。
    """
    recorder = _Recorder(_envelope(_style()))

    with pytest.raises(StyleRequestRefused, match="chrome"):
        await _tools(recorder)(
            "styles.save", {"name": "串", "chrome": '{"radius":4}'}
        )
    assert recorder.calls == []


async def test_saving_without_a_name_is_refused_before_the_call() -> None:
    recorder = _Recorder(_envelope(_style()))

    with pytest.raises(StyleRequestRefused, match="name"):
        await _tools(recorder)("styles.save", {"chrome": {"radius": 4}})
    assert recorder.calls == []


async def test_deleting_a_style_reads_a_204_as_success() -> None:
    """上游删成功回的是 204 空体。

    ⚠ 照着统一信封去解，一次成功的删除会被读成「响应不是预期的形状」，
    于是助手告诉用户没删掉——而它已经删了。
    """
    recorder = _Recorder(httpx.Response(204))

    got = await _tools(recorder)("styles.delete", {"style_id": STYLE_ID})
    request = recorder.calls[0]
    assert request.method == "DELETE"
    assert request.url.path == f"/api/v1/platform/card-styles/{STYLE_ID}"
    assert isinstance(got, dict)
    assert got["ok"] is True
    assert got["deleted_id"] == STYLE_ID
    # 套用是把取值抄进节点，不是引用——删样式不会让那些屏跟着变
    assert "不受影响" in str(got["note"])


async def test_a_missing_style_id_is_refused_before_the_call() -> None:
    recorder = _Recorder(_envelope(_style()))

    for name in ("styles.get", "styles.delete"):
        with pytest.raises(UnknownServerTool, match="style_id"):
            await _tools(recorder)(name, {})
    assert recorder.calls == []


async def test_an_upstream_refusal_is_reported_not_swallowed() -> None:
    """写样式要 dashboard:manage，被拒时说清是上游拒了。

    ⚠ 吞掉它读成「存好了」，用户下次来找那条样式会发现它根本不存在。
    """

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"code": 40301, "message": "没有 dashboard:manage"},
        )

    with pytest.raises(PlatformUnavailable, match="403") as error:
        await _tools(handler)(
            "styles.save", {"name": "暗金", "chrome": {"radius": 4}}
        )
    # 只报一个状态码的话，模型不知道是权限不够还是自己写错了键，会原样再试
    assert "没有 dashboard:manage" in str(error.value)


async def test_an_upstream_outage_never_reads_as_an_empty_library() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"code": 50001, "message": "挂了"})

    # 读成「库里是空的」，助手会转头从零凑一套观感
    with pytest.raises(PlatformUnavailable, match="503"):
        await _tools(handler)("styles.list", {})


async def test_without_an_upstream_every_style_tool_says_so() -> None:
    # 「本部署没接上业务面」与「样式库是空的」是两件事，不能混
    calls: list[tuple[str, dict[str, object]]] = [
        ("styles.list", {}),
        ("styles.get", {"style_id": STYLE_ID}),
        ("styles.save", {"name": "暗金", "chrome": {"radius": 4}}),
        ("styles.delete", {"style_id": STYLE_ID}),
    ]
    for name, arguments in calls:
        with pytest.raises(UnknownServerTool, match="业务面"):
            await ServerTools()(name, dict(arguments))
