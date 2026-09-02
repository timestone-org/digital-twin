"""SSE 分帧。

守两条：载荷必须压成一行（`data:` 里的换行会被读成「这一帧结束」，多行 JSON
于是在对端被切成几帧，而每一帧都不是合法 JSON），以及事件种类是闭合集合。
"""

import json

from llmcore.output import events
from llmcore.turn.types import (
    ClientToolCall,
    TurnDelta,
    TurnOutcome,
    TurnStep,
)


def _payload(frame: str) -> dict[str, object]:
    line = next(
        part for part in frame.splitlines() if part.startswith("data: ")
    )
    body = json.loads(line.removeprefix("data: "))
    assert isinstance(body, dict)
    return body


def test_a_frame_ends_with_a_blank_line() -> None:
    assert events.frame("step", {"a": 1}).endswith("\n\n")


def test_a_multiline_payload_is_flattened_to_one_line() -> None:
    frame = events.frame("step", {"text": "第一行\n第二行"})
    data_lines = [
        part for part in frame.splitlines() if part.startswith("data: ")
    ]
    # 换行会被对端读成「这一帧结束」，切出来的每一段都不是合法 JSON
    assert len(data_lines) == 1


def test_a_payload_that_json_cannot_reach_still_frames() -> None:
    frame = events.frame("step", {"when": object()})
    assert "data: " in frame


def test_a_step_frame_carries_what_the_list_renders() -> None:
    step = TurnStep(
        kind="server_tool",
        name="points.search",
        state="succeeded",
        title="跑完了",
    )
    body = _payload(events.step_frame(step))
    assert body["kind"] == "server_tool"
    assert body["title"] == "跑完了"


def test_a_step_frame_carries_the_input_and_output_it_can_show() -> None:
    step = TurnStep(
        kind="server_tool",
        name="points.search",
        state="succeeded",
        title="跑完了",
        input_json={"q": "温度"},
        output_json={"body": "命中 3 条"},
    )
    body = _payload(events.step_frame(step))
    # 不带这两格的话，「它到底把什么写进去了」要等会话重开才看得见
    assert body["input"] == {"q": "温度"}
    assert body["output"] == "命中 3 条"


def test_a_step_without_input_frames_them_as_null() -> None:
    step = TurnStep(
        kind="model", name="model", state="succeeded", title="给出答复"
    )
    body = _payload(events.step_frame(step))
    assert body["input"] is None
    assert body["output"] is None


def test_a_finished_turn_frames_as_done() -> None:
    frame = events.outcome_frame(TurnOutcome(reply="好了"))
    assert events.EVENT_DONE in frame
    assert _payload(frame)["reply"] == "好了"


def test_a_waiting_turn_frames_as_a_client_request() -> None:
    outcome = TurnOutcome(
        pending=(
            ClientToolCall(
                call_id="c1",
                name="dashboard.write_binding",
                arguments={"node_id": "n1"},
            ),
        )
    )
    frame = events.outcome_frame(outcome)
    assert events.EVENT_CLIENT_TOOL in frame
    calls = _payload(frame)["calls"]
    assert isinstance(calls, list)
    assert calls[0]["call_id"] == "c1"


def test_an_error_frame_carries_the_trace_id() -> None:
    # 用户报「刚才出错了」时，它是唯一能把界面上那一条与后端日志接起来的东西
    body = _payload(events.error_frame(52202, "模型暂时不可用", "abc123"))
    assert body["trace_id"] == "abc123"
    assert body["code"] == 52202


def test_the_event_names_are_a_closed_set() -> None:
    assert set(events.EVENT_NAMES) == {
        events.EVENT_DELTA,
        events.EVENT_STEP,
        events.EVENT_CLIENT_TOOL,
        events.EVENT_DONE,
        events.EVENT_ERROR,
        events.EVENT_PLAN,
    }


def test_a_delta_frame_says_which_channel_it_came_from() -> None:
    """思考与正文必须分得开。

    ⚠ 混成一路的话，界面只能把模型的自言自语和结论一起铺在对话里，
    而用户要读的只有结论。
    """
    body = _payload(
        events.delta_frame(TurnDelta(channel="reasoning", text="先查点位"))
    )

    assert body["channel"] == "reasoning"
    assert body["text"] == "先查点位"
