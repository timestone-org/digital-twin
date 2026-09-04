"""消息在库与模型之间的往返。

守的是「存结构不存提示词文本」：把整段提示词拼好再存，将来改了写法，历史会话
会用两套口径重放。另守工具消息必须带回 `tool_call_id`——丢了它，模型看到的是
「有人回了句话，但不知道回的是哪次调用」。

还守一条只有真会话才碰得到的：**没等到回执的调用要认得出来**。上一轮被掐掉、
页面被关掉、回执整批被判不合法，都会在尾部留下这样一批孤儿，而端点对「有调用
没回应」的一段历史一律判 400——认不出来就是这个会话从此一句都发不出去。
"""

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from llmcore.memory import HistoryRow, history

# 助手用的那两个取值，钉在这里当被测口径。⚠ 不从某个服务的 settings 取：
# 这一层被两个服务共用，取谁的都等于把另一家的口径写死
MAX_HISTORY_MESSAGES = 40
HISTORY_DROP_STEP = 10


def _row(role: str, body: dict[str, Any], seq: int = 1) -> HistoryRow:
    return HistoryRow(role=role, seq=seq, content_json=body)


def _seq_rows(count: int) -> list[HistoryRow]:
    """一段一问一答，seq 从 1 数起。

    Args: count（几条）。
    """
    return [
        _row(
            "user" if index % 2 else "assistant",
            {"text": f"第 {index} 句"},
            seq=index,
        )
        for index in range(1, count + 1)
    ]


def test_the_two_halves_cover_every_row_exactly_once() -> None:
    """折叠区与窗口区拼起来就是原样那一段，一条不多一条不少。

    ⚠ 少一条的表现最难查：那一条既没进摘要也没进窗口，于是它从对话里凭空
    消失，而两边看起来都正常。
    """
    rows = _seq_rows(MAX_HISTORY_MESSAGES + 15)
    dropped, kept = history.split(rows, MAX_HISTORY_MESSAGES)

    assert [one.seq for one in [*dropped, *kept]] == [one.seq for one in rows]


def test_nothing_drops_while_the_session_is_short() -> None:
    rows = _seq_rows(4)
    dropped, kept = history.split(rows, MAX_HISTORY_MESSAGES)

    assert dropped == []
    assert len(kept) == 4


def test_the_orphan_tool_replies_go_to_the_folded_half() -> None:
    """掐掉的孤儿回执归折叠区——它们不是凭空消失，只是不进窗口。

    切点正落在「带调用的助手消息」与它的回执之间时，窗口会以一条没有调用的
    回执开头，端点直接判 400。掐掉是对的，但掐掉的那条得有个去处。
    """
    rows = [
        _row("user", {"text": "问"}, seq=1),
        _row("assistant", {"text": "调工具"}, seq=2),
        _row("tool", {"text": "回执"}, seq=3),
        _row("user", {"text": "继续"}, seq=4),
        _row("assistant", {"text": "好"}, seq=5),
    ]
    # 切点落在 seq=3 那条回执上：它进不了窗口，于是归折叠区
    dropped, kept = history.split(rows, 3, step=1)

    assert [one.seq for one in dropped] == [1, 2, 3]
    assert [one.seq for one in kept] == [4, 5]


def test_the_fold_boundary_holds_still_inside_one_step() -> None:
    """折叠区的右边界与窗口的左边界是同一个位置，且每 `step` 条才动一次。

    ⚠ 这是摘要能被逐字复用的全部依据。边界每轮都动的话，摘要每轮都要重折，
    而它排在历史区前面——那就是一个新的前缀断点。
    """
    over = MAX_HISTORY_MESSAGES + 1
    edges = {
        history.split(_seq_rows(count), MAX_HISTORY_MESSAGES)[1][0].seq
        for count in range(over, over + HISTORY_DROP_STEP)
    }

    assert len(edges) == 1


def test_a_user_message_round_trips() -> None:
    role, body = history.to_content(HumanMessage(content="你好"))
    assert role == "user"
    back = history.to_message(_row(role, body))
    assert back.content == "你好"


def test_an_assistant_message_keeps_its_tool_calls() -> None:
    reply = AIMessage(
        content="",
        tool_calls=[{"name": "points.search", "args": {}, "id": "c1"}],
    )
    role, body = history.to_content(reply)
    back = history.to_message(_row(role, body))
    assert isinstance(back, AIMessage)
    assert [call["id"] for call in back.tool_calls] == ["c1"]


def test_a_tool_message_keeps_the_call_it_answers() -> None:
    role, body = history.to_content(
        ToolMessage(content="结果", tool_call_id="c1")
    )
    back = history.to_message(_row(role, body))
    assert isinstance(back, ToolMessage)
    assert back.tool_call_id == "c1"


def test_replay_orders_by_sequence_not_by_insertion() -> None:
    rows = [
        _row("user", {"text": "第二句"}, seq=2),
        _row("user", {"text": "第一句"}, seq=1),
    ]
    assert [m.content for m in history.replay(rows)] == ["第一句", "第二句"]


def test_a_row_with_nothing_in_it_still_replays() -> None:
    # 库里存着的东西不一定是本版本写的，读不出来也不能炸掉整段历史
    back = history.to_message(_row("assistant", {}))
    assert back.content == ""


def test_window_takes_the_most_recent_slice() -> None:
    rows = [_row("user", {"text": f"m{i}"}, seq=i) for i in range(1, 11)]
    kept = history.window(rows, 3, step=1)
    assert [one.seq for one in kept] == [8, 9, 10]


def test_window_drops_a_whole_step_at_a_time() -> None:
    """脱落点在两次脱落之间原地不动。

    每条消息都挪一格的话，会话一过高水位，发出去的历史区前缀每一轮都对不上，
    端点的前缀缓存从此再也命中不了——而这件事没有任何运行期迹象。
    """
    rows = [_row("user", {"text": f"m{i}"}, seq=i) for i in range(1, 21)]
    starts = {
        history.window(rows[:count], 10, step=5)[0].seq
        for count in range(11, 16)
    }
    assert starts == {6}
    assert history.window(rows[:16], 10, step=5)[0].seq == 11


def test_window_never_empties_when_the_step_overshoots_the_limit() -> None:
    # 台阶比高水位还大时，一个台阶就能把整段历史削光——表现是模型突然
    # 什么都不记得了
    rows = [_row("user", {"text": f"m{i}"}, seq=i) for i in range(1, 6)]
    assert history.window(rows, 3, step=10) != []


def test_window_never_starts_with_an_orphan_tool_message() -> None:
    """切点落在工具调用与它的回应之间时，孤儿工具消息必须掐掉。

    不掐的话，发给端点的历史以几条没有调用的工具回应开头，回来的是一条
    与真实原因毫无关系的 400，且回合越长越容易触发。
    """
    rows = [
        _row("user", {"text": "绑点"}, seq=1),
        _row("assistant", {"text": "", "tool_calls": []}, seq=2),
        _row("tool", {"tool_call_id": "c1", "text": "结果一"}, seq=3),
        _row("tool", {"tool_call_id": "c2", "text": "结果二"}, seq=4),
        _row("assistant", {"text": "好了"}, seq=5),
    ]
    kept = history.window(rows, 3, step=1)
    assert [one.seq for one in kept] == [5]


def test_window_keeps_a_complete_pair_intact() -> None:
    rows = [
        _row("assistant", {"text": "", "tool_calls": []}, seq=1),
        _row("tool", {"tool_call_id": "c1", "text": "结果"}, seq=2),
        _row("user", {"text": "继续"}, seq=3),
    ]
    kept = history.window(rows, 3, step=1)
    assert [one.seq for one in kept] == [1, 2, 3]


def _asks(call_ids: list[str]) -> AIMessage:
    """一条要调若干工具的助手消息。

    Args: call_ids。
    """
    return AIMessage(
        content="",
        tool_calls=[
            {"name": "dashboard.set_geometry", "args": {}, "id": one}
            for one in call_ids
        ],
    )


def test_a_call_that_never_got_an_answer_is_spotted() -> None:
    # 一步 37 个调用、回填上限 32 的那次，尾部就留下了这样一批
    said = [
        HumanMessage(content="排一下版"),
        _asks(["c1", "c2", "c3"]),
        ToolMessage(content="好", tool_call_id="c2"),
    ]

    assert history.unanswered(said) == ("c1", "c3")


def test_a_fully_answered_stretch_has_no_orphans() -> None:
    said = [
        _asks(["c1"]),
        ToolMessage(content="好", tool_call_id="c1"),
        HumanMessage(content="继续"),
    ]

    assert history.unanswered(said) == ()


def test_an_answer_to_a_call_nobody_made_is_ignored() -> None:
    # 窗口掐头之后可能只剩下回执那一半，那不是孤儿调用
    said = [ToolMessage(content="好", tool_call_id="c9")]

    assert history.unanswered(said) == ()


def test_the_filler_says_there_was_no_answer() -> None:
    """补的是**失败**回执，不是编一个成功。

    ⚠ 编一个成功的话，模型会以为那一步做完了，接着往下走——而画布上其实
    什么都没发生。
    """
    made = history.fillers(("c1",))

    assert len(made) == 1
    one = made[0]
    assert isinstance(one, ToolMessage)
    assert one.tool_call_id == "c1"
    assert "没有回执" in str(one.content)


def test_a_multipart_message_flattens_to_its_text_parts() -> None:
    """模型认的内容可以是一串块，而落库的是一段文字。"""
    made = history.to_content(
        HumanMessage(
            content=[
                {"type": "text", "text": "看这张"},
                {"type": "image_url", "image_url": {"url": "data:..."}},
            ]
        )
    )

    assert "看这张" in made[1]["text"]


def test_an_image_part_becomes_a_placeholder_not_the_bytes() -> None:
    """⚠ 回放时不重新塞图：一次回放会把会话里每一张图都再喂一遍，而模型早已在
    当时看过并给出了结论——重塞一遍既贵又可能让它改口。"""
    made = history.to_content(
        HumanMessage(
            content=[{"type": "image_url", "image_url": {"url": "data:..."}}]
        )
    )

    assert history.IMAGE_PLACEHOLDER in made[1]["text"]


def test_a_reasoning_block_is_dropped_not_mistaken_for_an_image() -> None:
    """⚠ 带思考摘要的那几路（Responses 方言）把摘要放进 `reasoning` 块里，
    与正文块并排。当成图的表现是界面上冒出一句「[图片]」——用户读成一张加载
    失败的插图，而正文其实好好的。"""
    made = history.to_content(
        AIMessage(
            content=[
                {
                    "type": "reasoning",
                    "id": "rs_1",
                    "summary": [{"type": "summary_text", "text": "先查库"}],
                },
                {"type": "text", "text": "上限是 65 ℃。①"},
            ]
        )
    )

    assert made[1]["text"] == "上限是 65 ℃。①"


def test_a_message_that_only_thought_lands_as_empty_text() -> None:
    """只想不说的那一条（只发工具调用）落库是空正文，不是一串占位。

    ⚠ 落成「[图片] [图片]」的话，那句话既回放到界面上，也在下一轮原样喂回给
    模型——它会看见自己上一轮「说」过一句 `[图片]`。
    """
    made = history.to_content(
        AIMessage(
            content=[
                {"type": "reasoning", "id": "rs_1", "summary": []},
                {"type": "reasoning", "id": "rs_2", "summary": []},
            ],
            tool_calls=[
                {"id": "c1", "name": "kb.search", "args": {"query": "冷却水"}}
            ],
        )
    )

    assert made[1]["text"] == ""
    assert [one["id"] for one in made[1]["tool_calls"]] == ["c1"]


def test_a_budget_of_zero_keeps_the_whole_window() -> None:
    """⚠ 不知道窗口时一条都不削：这一层只在知道窗口时才收紧。"""
    said = [HumanMessage(content="甲" * 100), AIMessage(content="乙" * 100)]

    assert history.fitted(said, 0) == said


def test_the_oldest_messages_go_first_when_the_budget_is_tight() -> None:
    """⚠ 条数窗口管不住 token：一次检索回执三千多 token，三四轮下来光历史就把
    小模型的窗口占满，而表现是每次都在同一步 400。"""
    said = [
        HumanMessage(content="最旧" * 50),
        AIMessage(content="中间" * 50),
        HumanMessage(content="最新" * 10),
    ]

    made = history.fitted(said, 60)

    assert [str(one.content) for one in made] == ["最新" * 10]


def test_a_window_never_starts_with_an_orphan_tool_reply() -> None:
    """⚠ 窗口以几条没有调用的工具回应开头时，端点直接判整段请求不合法，
    而报出来的 400 与真实原因毫无关系。"""
    said = [
        AIMessage(content="", tool_calls=[_call("kb.search", "c1")]),
        ToolMessage(content="回执" * 40, tool_call_id="c1"),
        HumanMessage(content="接着问"),
    ]

    made = history.fitted(said, 100)

    assert not isinstance(made[0], ToolMessage)


def test_a_call_with_big_arguments_counts_as_big() -> None:
    """⚠ 入参也进请求：只数正文的话，一次带一大段查询的调用会被当成很小。"""
    small = AIMessage(content="", tool_calls=[_call("kb.search", "c1")])
    big = AIMessage(
        content="",
        tool_calls=[_call("kb.search", "c2", {"query": "甲" * 500})],
    )

    assert history.fitted([big, small], 200) == [small]


def _call(name: str, call_id: str, args: dict[str, Any] | None = None) -> Any:
    return {
        "name": name,
        "args": args or {},
        "id": call_id,
        "type": "tool_call",
    }
