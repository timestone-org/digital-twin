"""`user.ask` 的形状：模型只能靠这一份判断该怎么问用户。

守的是三条只在真对话里才现形的规矩（AI_ASSISTANT_ASK_DESIGN §1）：
`options` 不是必给的话，模型会一路退回「不给选项的自由提问」——那正是今天
的行为；取消送成失败会让它去排查「工具坏了」而不是换条路往下走；而 ask 与
写动作混在同一批发出去时，用户点了「取消」覆盖照样发生了。
"""

from typing import Any

from ai_assistant.apps.chat.services.tools.shapes import ToolSpec
from ai_assistant.apps.chat.services.tools.specs import spec_of

ASK = "user.ask"


def _spec() -> ToolSpec:
    """规格本体；缺席就当场红，下面每一条都指着它。"""
    spec = spec_of(ASK)
    assert spec is not None
    return spec


def _properties() -> dict[str, Any]:
    props: Any = _spec().parameters["properties"]
    return props


def _option_schema() -> dict[str, Any]:
    item: Any = _properties()["options"]["items"]
    return item


def test_the_ask_tool_is_executed_by_the_browser() -> None:
    # 问题要渲染成可点的按钮，答案由用户给——服务端这一侧没有实现
    assert _spec().runs_on == "client"


def test_the_question_and_the_options_are_both_required() -> None:
    assert set(_spec().parameters["required"]) == {"question", "options"}


def test_every_option_carries_a_value_and_a_label() -> None:
    schema = _option_schema()
    assert set(schema["required"]) == {"value", "label"}
    # hint 可省，但必须有这一格：只有它能说清「这一项意味着什么」
    assert "hint" in schema["properties"]


def test_the_two_switches_are_optional_booleans() -> None:
    props = _properties()
    for name in ("allow_multiple", "allow_free_text"):
        assert props[name]["type"] == "boolean"
        assert name not in _spec().parameters["required"]


def test_every_parameter_tells_the_model_what_to_put_there() -> None:
    # 缺 description 的那一格，模型会自己编一个看起来合理的值
    missing = {
        name
        for name, schema in _properties().items()
        if not str(schema.get("description", "")).strip()
    }
    assert missing == set()
    assert {
        name
        for name, schema in _option_schema()["properties"].items()
        if not str(schema.get("description", "")).strip()
    } == set()


def test_the_description_pins_how_many_options_to_give() -> None:
    assert "2–6" in _spec().description


def test_the_description_says_free_text_still_needs_candidates() -> None:
    """开放问题也要给候选，否则这个工具就退化成今天的自由提问。"""
    body = _spec().description
    assert "allow_free_text" in body
    assert "仍然要给几个常见候选" in body


def test_the_description_says_a_cancel_is_a_normal_result() -> None:
    """送成失败的话，模型会去排查「工具坏了」而不是换个方式往下走。"""
    body = _spec().description
    assert "is_cancelled" in body
    assert "正常回执" in body


def test_the_description_demands_a_batch_of_its_own() -> None:
    """混批是确认类提问最要命的一种错法，理由必须写在模型看得见的地方。"""
    body = _spec().description
    assert "必须单独成一批" in body
    assert "取消" in body
