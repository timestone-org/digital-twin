"""工具名别名只在本轮声明内唯一时恢复。"""

import pytest
from langchain_core.messages import AIMessage
from unit.fakes import tool_call

from llmcore.tools.names import restore_offered_aliases


def test_a_unique_single_underscore_alias_is_restored(
    caplog: pytest.LogCaptureFixture,
) -> None:
    reply = AIMessage(
        content="", tool_calls=[tool_call("records_find", {}, "c1")]
    )

    with caplog.at_level("WARNING"):
        restored = restore_offered_aliases(reply, frozenset({"records.find"}))

    assert restored.tool_calls[0]["name"] == "records.find"
    assert reply.tool_calls[0]["name"] == "records_find"
    events = [
        getattr(one, "payload", {}).get("event") for one in caplog.records
    ]
    assert "tool_call_alias_restored" in events


@pytest.mark.parametrize(
    ("offered", "given"),
    [
        (frozenset({"records.find", "records_find"}), "records_find"),
        (
            frozenset({"records.find_item", "records_find.item"}),
            "records_find_item",
        ),
        (frozenset({"records.find"}), "missing_read"),
        (frozenset[str](), "records_find"),
    ],
    ids=("canonical", "collision", "not-offered", "nothing-offered"),
)
def test_only_an_unambiguous_offered_alias_is_restored(
    offered: frozenset[str], given: str
) -> None:
    reply = AIMessage(content="", tool_calls=[tool_call(given, {}, "c1")])

    assert restore_offered_aliases(reply, offered) is reply
