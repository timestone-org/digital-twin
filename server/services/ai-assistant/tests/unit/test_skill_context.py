"""技能恢复保留真实成功的指引，不能恢复失败或已失去权限的技能。"""

import json

from ai_assistant.apps.chat.services.memory.skill_context import (
    restored_messages,
)
from ai_assistant.apps.chat.skills import skills_for
from llmcore.memory import HistoryRow


def _loaded(text: str) -> list[HistoryRow]:
    return [
        HistoryRow(
            role="assistant",
            seq=1,
            content_json={
                "tool_calls": [
                    {
                        "name": "skills.load",
                        "args": {"name": "twin-configure"},
                        "id": "load-1",
                    }
                ]
            },
        ),
        HistoryRow(
            role="tool",
            seq=2,
            content_json={"tool_call_id": "load-1", "text": text},
        ),
    ]


def test_windowed_out_skill_is_restored_without_relying_on_the_summary() -> (
    None
):
    rows = _loaded(json.dumps({"ok": True, "instructions": "旧正文"}))
    restored = restored_messages(rows, [], skills_for("twin-editor"))
    assert len(restored) == 1
    assert "## 工作顺序" in str(restored[0].content)
    assert "旧正文" not in str(restored[0].content)


def test_visible_skill_is_not_duplicated() -> None:
    rows = _loaded("ok: true\nname: twin-configure\ninstructions: 已加载")
    assert restored_messages(rows, rows, skills_for("twin-editor")) == []


def test_failed_or_disallowed_skill_is_not_restored() -> None:
    assert (
        restored_messages(
            _loaded("失败：技能不可用"), [], skills_for("twin-editor")
        )
        == []
    )
    rows = _loaded("ok: true\ninstructions: 已加载")
    assert restored_messages(rows, [], skills_for("dataset-table")) == []
