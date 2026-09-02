"""语音输入协议常量的契约：路径与服务前缀同源、路由挂的就是那一条、
子协议标记与 realtime-hub 逐字相同、关闭码与闭合集合不重不漏。

⚠ 前端 `features/speech/protocol.ts` 按路径读 `protocol.py` 逐字比对，所以
这里的常量必须是**字面量**：拼出来的值前端读不到。
"""

import pathlib
import re

from knowledge_server.apps.speech.api import ws
from knowledge_server.apps.speech.services import protocol
from knowledge_server.settings import API_PREFIX

# realtime-hub 的源码在仓里的位置。⚠ 按文件读而不是 import：服务之间不许
# 互相 import
HUB_WS = (
    pathlib.Path(__file__).resolve().parents[3]
    / "realtime-hub"
    / "src"
    / "realtime_hub"
    / "apps"
    / "channel"
    / "api"
    / "ws.py"
)
PROTOCOL_PY = pathlib.Path(protocol.__file__)


def test_the_ws_path_sits_under_the_service_prefix() -> None:
    assert f"{API_PREFIX}/speech/ws" == protocol.SPEECH_WS_PATH


def test_the_router_mounts_exactly_that_path() -> None:
    paths = [getattr(route, "path", "") for route in ws.router.routes]
    assert paths == [protocol.SPEECH_WS_PATH]


def test_the_auth_marker_matches_the_realtime_hub_verbatim() -> None:
    """⚠ 前端两条 WS 共用 `REALTIME_AUTH_SUBPROTOCOL`；这边漂一个字符，
    浏览器就判握手失败。"""
    line = next(
        one
        for one in HUB_WS.read_text(encoding="utf-8").splitlines()
        if one.startswith("AUTH_SUBPROTOCOL = ")
    )
    assert line == f'AUTH_SUBPROTOCOL = "{protocol.AUTH_SUBPROTOCOL}"'


def test_every_constant_is_a_plain_literal() -> None:
    """前端契约用例按 `NAME = "…"` / `NAME = 1000` 的形状读，拼出来的读不到。"""
    source = PROTOCOL_PY.read_text(encoding="utf-8")
    for name in (
        "SPEECH_WS_PATH",
        "AUTH_SUBPROTOCOL",
        "ACTION_STOP",
        "ACTION_CANCEL",
        "EVENT_READY",
        "EVENT_DONE",
        "STAGE_PARTIAL",
        "STAGE_FINAL",
        "CLOSE_UNAUTHENTICATED",
        "CLOSE_ASR_UNAVAILABLE",
        "CLOSE_INTERNAL_ERROR",
    ):
        assert re.search(rf'^{name} = (?:"[^"]+"|\d+)$', source, re.M), name


def test_close_codes_are_distinct() -> None:
    codes = (
        protocol.CLOSE_NORMAL,
        protocol.CLOSE_BAD_FRAME,
        protocol.CLOSE_UNAUTHENTICATED,
        protocol.CLOSE_INTERNAL_ERROR,
        protocol.CLOSE_ASR_UNAVAILABLE,
    )
    assert len(set(codes)) == len(codes)


def test_actions_and_stages_are_closed_sets() -> None:
    assert frozenset({"stop", "cancel"}) == protocol.ACTIONS
    assert protocol.client_action('{"action":"stop"}') == "stop"
    assert protocol.client_action('{"action":"jump"}') is None
    assert protocol.client_action("[]") is None
    assert protocol.client_action("not json") is None
    assert {protocol.STAGE_PARTIAL, protocol.STAGE_FINAL} == {
        "partial",
        "final",
    }
