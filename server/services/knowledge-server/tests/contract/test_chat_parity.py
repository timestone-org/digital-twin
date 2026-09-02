"""对话面与助手那边必须逐字相同的几样：三个闭合集合、`user.ask` 的参数形状。

⚠ 前端渲染步骤、消息、反问选项的那套组件两边共用（PR 4 直接复用
`features/ai`）。这里漂一档，界面就画不出来——而两侧代码单看都对。
"""

import pathlib
import re

from knowledge_server.apps.chat import enums
from knowledge_server.apps.chat.services.tools.client import ASK_SPEC

# 助手的源码在仓里的位置。⚠ 按文件读而不是 import：服务之间不许互相 import
ASSISTANT = (
    pathlib.Path(__file__).resolve().parents[3]
    / "ai-assistant"
    / "src"
    / "ai_assistant"
)


def _tuple_literal(source: str, name: str) -> tuple[str, ...]:
    """从源码里把 `NAME = (...)` 的字符串元组抠出来。"""
    block = re.search(rf"^{name} = \((.*?)\)", source, re.S | re.M)
    assert block is not None, f"助手那边没有 {name}"
    return tuple(re.findall(r'"([^"]+)"', block.group(1)))


def test_the_three_closed_sets_match_the_assistant_verbatim() -> None:
    source = (ASSISTANT / "apps" / "chat" / "enums.py").read_text(
        encoding="utf-8"
    )

    assert _tuple_literal(source, "MESSAGE_ROLES") == enums.MESSAGE_ROLES
    assert _tuple_literal(source, "STEP_KINDS") == enums.STEP_KINDS
    assert _tuple_literal(source, "STEP_STATES") == enums.STEP_STATES


def test_the_ask_tool_has_the_same_parameter_shape_as_the_assistant() -> None:
    """⚠ 浏览器里实现它的是同一份代码，形状漂开前端就渲染不出选项。"""
    source = (
        ASSISTANT
        / "apps"
        / "chat"
        / "services"
        / "tools"
        / "providers"
        / "client_specs"
        / "core.py"
    ).read_text(encoding="utf-8")
    start = source.index('name="user.ask"')
    end = source.index("runs_on=", start)
    theirs = source[start:end]

    ours = ASK_SPEC.parameters
    props = ours["properties"]
    assert set(props) == {
        "question",
        "options",
        "allow_multiple",
        "allow_free_text",
    }
    assert ours["required"] == ["question", "options"]
    option = props["options"]["items"]
    assert set(option["properties"]) == {"value", "label", "hint"}
    assert option["required"] == ["value", "label"]
    # 助手那份也得有这几格；少一格就是它那边改了而我们没跟
    for key in ("question", "options", "allow_multiple", "allow_free_text"):
        assert f'"{key}"' in theirs, f"助手的 user.ask 少了 {key}"


def test_the_ask_tool_runs_on_the_client() -> None:
    assert ASK_SPEC.runs_on == "client"
