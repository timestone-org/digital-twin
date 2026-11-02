"""窗口外那一截怎么折成一段，以及折出来的那段什么时候能原样复用。

⚠ **同一个台阶内必须原样复用**是本模块存在的全部理由：重折出来的字句一定与上
一轮不同，而摘要排在历史区最前面——那就是一个新的前缀断点，后面整段历史跟着
作废，且没有任何运行期迹象，只有账单和延迟会慢慢变难看（ADR-0025）。
"""

import json
from typing import Any

import httpx2
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from openai import AsyncOpenAI
from pydantic import SecretStr
from unit.fakes import ScriptedResponder

from llmcore import ModelChoice, ModelUnavailable
from llmcore.deltas import text_of
from llmcore.endpoints import ChatEndpoint
from llmcore.memory import HistoryRow, Summary
from llmcore.memory import summarize as fold
from llmcore.openai_compat import OpenAiCompatAdapter
from llmcore.reasoning import ReasoningChatOpenAI

STAMP = "std:summary"


def _row(role: str, text: str, seq: int) -> HistoryRow:
    return HistoryRow(role=role, seq=seq, content_json={"text": text})


def _summary(through: int = 10, model: str = STAMP) -> Summary:
    return Summary(through_seq=through, text="早先聊了锅炉", model=model)


class _Boom:
    """怎么问都不成的那一路。"""

    async def respond(self, **kwargs: Any) -> AIMessage:
        del kwargs
        raise ModelUnavailable("端点不通")


def test_the_stamp_tells_which_route_and_tier_folded_it() -> None:
    got = fold.stamp_of(ModelChoice(kind="summary", profile="std"))

    assert got == "std:summary"


def test_the_same_step_reuses_the_stored_text_verbatim() -> None:
    stored = _summary(through=10)

    assert fold.reuse(stored, 10, STAMP) is stored


def test_crossing_a_step_forces_a_refold() -> None:
    """⚠ 台阶变了还复用，摘要覆盖的范围就与窗口对不上了。"""
    assert fold.reuse(_summary(through=10), 20, STAMP) is None


def test_switching_models_forces_a_refold() -> None:
    """⚠ 两截摘要由不同模型折出来时口径可以差很远，而拼在一起看不出接缝。"""
    assert fold.reuse(_summary(model="std:summary"), 10, "fast:summary") is None


def test_nothing_stored_means_nothing_to_reuse() -> None:
    assert fold.reuse(None, 10, STAMP) is None


def test_the_summary_hangs_at_the_very_front_of_the_history() -> None:
    """⚠ 挂到末尾去的话，模型会把它读成「刚刚发生的事」。"""
    got = fold.messages_of(_summary())

    assert len(got) == 1
    assert "早先聊了锅炉" in str(got[0].content)


def test_no_summary_hangs_nothing() -> None:
    assert fold.messages_of(None) == []


def test_summary_identity_requires_an_internal_human_message_marker() -> None:
    summary = fold.messages_of(_summary())[0]

    assert fold.is_summary_message(summary)
    assert not fold.is_summary_message(HumanMessage(content=summary.content))
    assert not fold.is_summary_message(
        AIMessage(
            content=summary.content, response_metadata=summary.response_metadata
        )
    )


def _response_output() -> list[dict[str, object]]:
    """提供 Responses 的可见输出块。"""
    return [
        {
            "type": "message",
            "id": "m1",
            "role": "assistant",
            "status": "completed",
            "content": [
                {"type": "output_text", "text": "摘要可见", "annotations": []}
            ],
        }
    ]


def _wire_reply(is_responses: bool) -> dict[str, object]:
    """生成两个真实模型序列化协议的最小成功回包；Args: is_responses。"""
    if is_responses:
        return {
            "id": "r1",
            "created_at": 0,
            "model": "test-model",
            "object": "response",
            "status": "completed",
            "output": _response_output(),
            "usage": {
                "input_tokens": 20,
                "output_tokens": 4,
                "total_tokens": 24,
            },
        }
    return {
        "id": "c1",
        "created": 0,
        "model": "test-model",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "摘要可见"},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 20,
            "completion_tokens": 4,
            "total_tokens": 24,
        },
    }


async def _wire_model() -> ReasoningChatOpenAI:
    """通过生产适配器构造实际序列化模型。"""
    endpoint = ChatEndpoint(
        base_url="https://model.invalid",
        api_key=SecretStr("test-key"),
        model="test-model",
        timeout_s=1,
    )
    adapter = OpenAiCompatAdapter(
        resolve=lambda _kind: endpoint, label="test", models=("test-model",)
    )
    model = await adapter.build(ModelChoice())
    assert isinstance(model, ReasoningChatOpenAI)
    return model


@pytest.mark.parametrize(
    "is_responses", [False, True], ids=["chat", "responses"]
)
async def test_internal_summary_marker_does_not_reach_the_model_wire(
    is_responses: bool,
) -> None:
    messages = fold.messages_of(_summary())
    assert fold.is_summary_message(messages[0])
    requests: list[bytes] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        requests.append(request.content)
        assert request.url.path == (
            "/responses" if is_responses else "/chat/completions"
        )
        assert b"llmcore_summary" not in request.content
        assert b"response_metadata" not in request.content
        body: object = json.loads(request.content)
        assert "早先聊了锅炉" in str(body)
        return httpx2.Response(200, json=_wire_reply(is_responses))

    model = await _wire_model()
    async with (
        httpx2.AsyncClient(
            transport=httpx2.MockTransport(handle), timeout=1
        ) as http,
        AsyncOpenAI(
            api_key="test-key",
            base_url="https://model.invalid",
            http_client=http,
            max_retries=0,
        ) as client,
    ):
        model.root_async_client = client
        model.async_client = client.chat.completions
        model.use_responses_api = is_responses
        reply = await model.ainvoke(messages)

    assert text_of(reply) == "摘要可见"
    assert len(requests) == 1


def test_a_summary_survives_a_round_trip_through_the_column() -> None:
    made = _summary()

    assert fold.stored_of(fold.as_json(made)) == made


def test_a_dirty_column_reads_as_no_summary_instead_of_blowing_up() -> None:
    """⚠ JSONB 是无类型的，一行脏数据不该让这个会话从此发不出任何一句。"""
    assert fold.stored_of(None) is None
    assert fold.stored_of("不是对象") is None
    assert fold.stored_of({"through_seq": "十", "text": "x"}) is None
    assert fold.stored_of({"through_seq": 10, "text": ""}) is None
    assert fold.stored_of({"text": "缺了边界"}) is None


async def test_the_null_summarizer_folds_nothing_and_says_so() -> None:
    """⚠ 装不上就如实缺席，而不是假装折了一段空的。"""
    got = await fold.NullSummarizer().fold([_row("user", "问", 1)], 10, None)

    assert got is None


async def test_a_real_fold_carries_the_boundary_and_the_stamp() -> None:
    responder = ScriptedResponder([AIMessage(content="聊过锅炉参数")])
    folder = fold.ModelSummarizer(model=responder, profile="std")

    got = await folder.fold(
        [_row("user", "锅炉压力多少", 1), _row("assistant", "9.8 MPa", 2)],
        10,
        None,
    )

    assert got is not None
    assert got.through_seq == 10
    assert got.model == STAMP
    assert "锅炉" in got.text


async def test_structured_summary_keeps_text_and_excludes_reasoning() -> None:
    responder = ScriptedResponder(
        [
            AIMessage(
                content=[
                    {
                        "type": "reasoning",
                        "summary": [
                            {"type": "summary_text", "text": "内部推理不应存储"}
                        ],
                        "encrypted_content": "private-reasoning",
                    },
                    {"type": "text", "text": "T001 温度26.5，用户要求只读。"},
                ]
            )
        ]
    )
    folder = fold.ModelSummarizer(model=responder, profile="std")

    got = await folder.fold([_row("user", "只读解释T001温度", 1)], 2, None)

    assert got is not None
    assert got.text == "T001 温度26.5，用户要求只读。"
    assert got.through_seq == 2


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("T001 温度26.5", "T001 温度26.5"),
        ("   ", None),
        ([], None),
        ([{"type": "text", "text": ""}], None),
        (
            [
                {
                    "type": "reasoning",
                    "summary": [{"type": "summary_text", "text": "内部推理"}],
                    "encrypted_content": "private-reasoning",
                }
            ],
            None,
        ),
        ([{"type": "refusal", "refusal": "不可作为既定事实"}], None),
    ],
)
async def test_summary_text_shapes(
    content: str | list[str | dict[str, Any]], expected: str | None
) -> None:
    responder = ScriptedResponder([AIMessage(content=content)])
    folder = fold.ModelSummarizer(model=responder, profile="std")

    got = await folder.fold([_row("user", "只读解释T001温度", 1)], 2, None)

    assert (got.text if got is not None else None) == expected


async def test_folding_feeds_the_previous_summary_not_the_whole_past() -> None:
    """⚠ 不给 `previous` 的话，每跨一个台阶就要把从头到现在的全部脱落消息再喂
    一遍——会话越长这一次调用越贵，最后贵过它省下来的那点上下文。"""
    responder = ScriptedResponder([AIMessage(content="又聊了给水泵")])
    folder = fold.ModelSummarizer(model=responder, profile="std")

    await folder.fold([_row("user", "给水泵呢", 11)], 20, _summary())

    fed = "".join(str(one.content) for one in responder.asked[0])
    assert "早先聊了锅炉" in fed


async def test_tool_messages_never_reach_the_summary() -> None:
    """⚠ 过程不是结论：把工具回执折进去，摘要会被一堆 JSON 占满。"""
    responder = ScriptedResponder([AIMessage(content="折好了")])
    folder = fold.ModelSummarizer(model=responder, profile="std")

    await folder.fold(
        [_row("user", "问一句", 1), _row("tool", '{"hits": 3}', 2)], 10, None
    )

    fed = "".join(str(one.content) for one in responder.asked[0])
    assert "hits" not in fed


async def test_a_failed_fold_gives_none_instead_of_taking_the_turn_down() -> (
    None
):
    """⚠ 折叠失败退回「直接丢」是可接受的降级；让整个回合发不出去不是。"""
    folder = fold.ModelSummarizer(model=_Boom(), profile="std")

    got = await folder.fold([_row("user", "问", 1)], 10, None)

    assert got is None
