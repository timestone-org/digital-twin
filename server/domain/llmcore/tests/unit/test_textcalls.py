"""模型把工具调用写成正文时的捡回。

⚠ 这一层的每一条都在守同一件事：捡得**够**（现场那几路小模型真会这么写），
但绝不**多捡**（正文里提一句工具名不是调用）。
"""

from llmcore.textcalls import MAX_SALVAGED, salvage

KNOWN = frozenset({"kb.read_chunk", "kb.search"})

# 现场实录的那一段：模型先说了句人话，然后把调用打进了正文
REAL = """根据检索结果，第一条①是核心规程，但内容太简略，需要看更多原文。

<tool_call>
<function=kb.read_chunk>
<parameter=chunk_id>
01a069c3-c4e7-7795-b862-a5cf4785e10c
</parameter>
</function>
</tool_call>"""


def test_the_xml_shaped_call_comes_back_as_a_real_call() -> None:
    """⚠ 不捡的表现是双重失败：那一步没人执行，而这坨尖括号成了给用户的答案。"""
    made = salvage(REAL, KNOWN)

    assert len(made.calls) == 1
    assert made.calls[0].name == "kb.read_chunk"
    assert made.calls[0].arguments == {
        "chunk_id": "01a069c3-c4e7-7795-b862-a5cf4785e10c"
    }


def test_the_block_is_taken_out_of_the_text() -> None:
    """剩下的正文里一个尖括号都不许有：它会落库、进标题、进下一轮上下文。"""
    made = salvage(REAL, KNOWN)

    assert "<tool_call>" not in made.text
    assert "kb.read_chunk" not in made.text
    assert made.text.startswith("根据检索结果")


def test_an_unclosed_block_is_taken_out_too() -> None:
    """⚠ 流被截断时留下的是半截尖括号，它同样会落库。"""
    made = salvage(f"{REAL}\n\n<tool_call>\n<function=kb.search>", KNOWN)

    assert "<tool_call>" not in made.text
    assert len(made.calls) == 1


def test_the_json_shaped_block_is_understood_as_well() -> None:
    """另一种常见写法：块里直接是一段 JSON。"""
    body = (
        '<tool_call>{"name": "kb.search", '
        '"arguments": {"query": "冷却水"}}</tool_call>'
    )

    made = salvage(body, KNOWN)

    assert len(made.calls) == 1
    assert made.calls[0].arguments == {"query": "冷却水"}


def test_numbers_keep_being_numbers() -> None:
    """⚠ `limit` 收到字符串 "5" 时，工具那一侧的 isinstance 会判假然后悄悄
    退回缺省值——现象是「我明明让它查 5 条」。"""
    body = (
        "<tool_call><function=kb.search>"
        "<parameter=query>冷却水</parameter>"
        "<parameter=limit>5</parameter>"
        "</function></tool_call>"
    )

    made = salvage(body, KNOWN)

    assert made.calls[0].arguments == {"query": "冷却水", "limit": 5}


def test_a_name_that_was_never_offered_is_not_salvaged() -> None:
    """⚠ 「像调用就当调用」的话，模型在正文里讨论一个工具会被当成真调用执行。"""
    body = (
        "<tool_call><function=shell.run>"
        "<parameter=cmd>rm -rf /</parameter>"
        "</function></tool_call>"
    )

    made = salvage(body, KNOWN)

    assert made.calls == ()
    # 一个都没捡到时正文逐字不动：摘掉的话，用户连模型说了什么都看不见
    assert made.text == body


def test_no_tools_were_offered_means_nothing_is_salvaged() -> None:
    """没发工具的那几轮里出现 `<tool_call>` 一定是模型在复读。"""
    assert salvage(REAL, frozenset()).calls == ()


def test_plain_prose_is_left_alone() -> None:
    made = salvage("我本来想调 kb.search，但资料里已经有了。", KNOWN)

    assert made.calls == ()
    assert made.text == "我本来想调 kb.search，但资料里已经有了。"


def test_several_blocks_all_come_back_in_order() -> None:
    body = (
        "<tool_call><function=kb.search>"
        "<parameter=query>甲</parameter></function></tool_call>"
        "中间说了句话"
        "<tool_call><function=kb.search>"
        "<parameter=query>乙</parameter></function></tool_call>"
    )

    made = salvage(body, KNOWN)

    assert [one.arguments["query"] for one in made.calls] == ["甲", "乙"]
    assert made.text == "中间说了句话"


def test_a_runaway_repeat_is_capped() -> None:
    """⚠ 有上限：正文里一段跑飞的重复能写出几十个调用，而每一个都要真去执行。"""
    one = (
        "<tool_call><function=kb.search>"
        "<parameter=query>甲</parameter></function></tool_call>"
    )

    made = salvage(one * (MAX_SALVAGED + 5), KNOWN)

    assert len(made.calls) == MAX_SALVAGED
