"""本服务这整册工具名换得到线形、也换得回来。

⚠ 换算本身在 `llmcore.codex.wire_names`（两个消费方共用），这条只钉**本服务
的花名册**：那个端点只认 `^[a-zA-Z0-9_-]+$`，而换回来是按 `__` 反着切——
规范名里出现 `__` 就分不开了，现象是「模型说它调了工具，然后什么都没发生」。
"""

import re

from ai_assistant.apps.chat.services.tools.specs import TOOL_SPECS
from llmcore.codex import wire_names
from llmcore.tools.shapes import openai_schema

# 端点认的名字长什么样（实测出来的那条正则）
ENDPOINT_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


def test_every_declared_tool_name_survives_the_round_trip() -> None:
    for spec in TOOL_SPECS:
        assert wire_names.from_wire(wire_names.to_wire(spec.name)) == spec.name


def test_every_declared_tool_name_is_acceptable_to_the_endpoint() -> None:
    for spec in TOOL_SPECS:
        assert ENDPOINT_PATTERN.fullmatch(wire_names.to_wire(spec.name))


def test_the_declarations_this_service_sends_go_out_dotless() -> None:
    schemas = [openai_schema(spec) for spec in TOOL_SPECS[:3]]
    for one in wire_names.wired_tools(schemas):
        assert isinstance(one, dict)
        assert ENDPOINT_PATTERN.fullmatch(one["function"]["name"])
    # 原件不许被就地改：同一批声明还要发给别的路
    assert schemas[0]["function"]["name"] == TOOL_SPECS[0].name
