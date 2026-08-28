"""工作面快照进提示词。

**守的是一句用户每天都在说的话**：「把**这个**模块的标题改掉」。没有快照时，
「这个」在模型手里没有指代——它只能反问，或者挑一个看着像的画布节点动手，
而后者是这套东西最容易失去信任的地方。
"""

from typing import Any

from ai_assistant.apps.chat.services import state_block
from ai_assistant.apps.chat.services.prompt import build_system_prompt
from ai_assistant.apps.chat.services.surface_context import (
    MAX_CONTEXT_CHARS,
    MAX_NAMED,
    render,
)


def _shot(**extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"node_count": 2, "selected_id": None}
    body.update(extra)
    return body


def test_no_snapshot_renders_nothing() -> None:
    """没快照时不留一段空标题——那会让模型以为这一屏是空的。"""
    assert render(None) == ""
    assert render({}) == ""


def test_the_selected_node_gets_a_sentence_of_its_own() -> None:
    """选中项要单拎出来说一遍。

    ⚠ 只让它躺在 JSON 里的一格 `selected_id` 的话，模型十次里有三次读不出
    「用户说的『这个』指的是它」，而那三次它会去改另一个。
    """
    text = render(
        _shot(
            selected_id="n7",
            selected={
                "id": "n7",
                "module_type": "metric-card",
                "label": "机组温度",
            },
        )
    )

    assert "机组温度" in text
    assert "metric-card" in text
    assert "n7" in text


def test_a_multi_selection_names_every_one_of_them() -> None:
    """多选时只说个数等于让模型自己挑。

    ⚠ 而它挑错的那一次，用户看到的是「我明明选了这三个，它去改了别的」。
    """
    text = render(
        _shot(
            selected_ids=["n1", "n2", "n3"],
            selected=[
                {"id": "n1", "module_type": "metric-card", "label": "进水温度"},
                {"id": "n2", "module_type": "metric-card", "label": "出水温度"},
                {"id": "n3", "module_type": "gauge-card", "label": "负荷"},
            ],
        )
    )

    assert "选中了 3 个" in text
    for name in ("进水温度", "出水温度", "负荷"):
        assert name in text
    for node_id in ("n1", "n2", "n3"):
        assert f"`{node_id}`" in text
    assert "不要扩大到别的节点" in text


def test_the_old_single_object_shape_is_still_understood() -> None:
    """会话是跨版本的：只认数组会让老前端的快照连选中项都读不出来。"""
    text = render(
        _shot(selected={"id": "n7", "type": "panel", "name": "1 号信息板"})
    )

    assert "1 号信息板" in text
    assert "n7" in text


def test_ids_without_briefs_still_get_named() -> None:
    """孪生那两面的快照可能只带 id，没有名片。"""
    text = render(_shot(selected_ids=["n1", "n2"]))

    assert "选中了 2 个" in text
    assert "`n1`" in text
    assert "`n2`" in text


def test_a_huge_selection_says_it_was_cut() -> None:
    """整屏全选是一次点击的事；名单截断了必须挑明。"""
    many = [{"id": f"n{index}", "label": f"卡片{index}"} for index in range(20)]
    text = render(_shot(selected=many))

    assert "选中了 20 个" in text
    assert "截断" in text
    assert f"还有 {20 - MAX_NAMED} 个" in text
    # 点名的那一句里不许有第 13 个往后的；JSON 那一段里有是另一回事
    assert "卡片19" not in text.split("```json")[0]


def test_an_empty_selection_array_reads_as_nothing_selected() -> None:
    assert "没有选中" in render(_shot(selected=[], selected_ids=[]))


def test_no_selection_is_said_out_loud() -> None:
    """没选中也要说出来。

    ⚠ 不说的话，模型会把上一轮记得的那个当成还选着，而用户早点到别处去了。
    """
    assert "没有选中" in render(_shot())


def test_a_bare_selected_id_still_gets_named() -> None:
    assert "n7" in render(_shot(selected_id="n7"))


def test_an_oversized_snapshot_says_it_was_cut() -> None:
    """悄悄截断会让模型把「我看到的就是全部」当成事实。"""
    text = render(_shot(nodes=[{"id": f"n{index}"} for index in range(9000)]))

    assert "只给了前面一截" in text
    assert len(text) < MAX_CONTEXT_CHARS * 2


def test_the_snapshot_rides_along_in_the_state_block() -> None:
    assert "n7" in state_block.render(_shot(selected_id="n7"), None)


def test_the_snapshot_never_rides_along_in_the_system_prompt() -> None:
    """快照不许进常驻提示词。

    ⚠ 常驻提示词与工具声明是端点前缀缓存唯一能命中的那一段。快照每一轮都变，
    塞进去等于把它后面十几 k 字符连同整段历史一起作废。
    """
    prompt = build_system_prompt("dashboard-editor", surface_label="大屏编辑器")

    assert "这一页此刻的样子" not in prompt
