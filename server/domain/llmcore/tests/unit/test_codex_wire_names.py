"""订阅账号那一路的工具名口径。⚠ 消费方各有一条用例钉自己那整册工具名。

守的是一条只在真端点上才现形的规矩：那边只认 `^[a-zA-Z0-9_-]+$` 的工具名，
点号原样发过去是一条 400，而那条 400 既不说是哪个工具、也不说问题出在点号上。
换过去还得换得回来——换不回来的现象是「模型说它调了工具，然后什么都没发生」。
"""

import re

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from llmcore.codex import wire_names
from llmcore.testing import asks

# 端点认的名字长什么样（实测出来的那条正则）
ENDPOINT_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
# 消费方那边的工具名长这样：点分命名空间
NAMES = ("points.search", "kb.read_chunk", "dashboard.capture")


def test_a_dotted_name_survives_the_round_trip() -> None:
    # ⚠ 换回来是按 `__` 反着切：规范名里出现 `__` 就分不开了
    for name in NAMES:
        assert wire_names.from_wire(wire_names.to_wire(name)) == name


def test_a_wired_name_is_acceptable_to_the_endpoint() -> None:
    for name in NAMES:
        assert ENDPOINT_PATTERN.fullmatch(wire_names.to_wire(name))


def test_the_tool_declarations_go_out_dotless() -> None:
    schemas = [
        {"type": "function", "function": {"name": name}} for name in NAMES
    ]
    wired = wire_names.wired_tools(schemas)
    for one in wired:
        assert isinstance(one, dict)
        assert ENDPOINT_PATTERN.fullmatch(one["function"]["name"])
    # 原件不许被就地改：同一批声明还要发给别的路
    assert schemas[0]["function"]["name"] == NAMES[0]


def test_the_history_calls_go_out_dotless_too() -> None:
    # 上一轮的调用原样重放同样是 400，而那时只有这一个会话说不了话
    history = [
        HumanMessage(content="你好"),
        asks("points.search", "c1", keyword="温度"),
        ToolMessage(content="[]", tool_call_id="c1"),
    ]
    wired = wire_names.wired_messages(history)
    said = wired[1]
    assert isinstance(said, AIMessage)
    assert said.tool_calls[0]["name"] == "points__search"
    # 原件不动
    original = history[1]
    assert isinstance(original, AIMessage)
    assert original.tool_calls[0]["name"] == "points.search"


def test_the_reply_comes_back_with_the_canonical_names() -> None:
    reply = asks("points__search", "c1", keyword="温度")
    assert wire_names.restored(reply).tool_calls[0]["name"] == "points.search"


def test_a_reply_without_tool_calls_is_left_alone() -> None:
    reply = AIMessage(content="好")
    assert wire_names.restored(reply) is reply
