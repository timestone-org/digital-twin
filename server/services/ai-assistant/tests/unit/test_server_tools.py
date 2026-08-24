"""服务端工具的分派。

守的是「认不出的名字要抛」：模型编一个不存在的工具名是常事，静默给它一个空
结果，它会当成「查过了，没有」继续往下走，最后给用户一个自信的错误答案。
"""

import pytest

from ai_assistant.apps.chat.services.server_tools import (
    ServerTools,
    UnknownServerTool,
)


async def test_loading_a_skill_returns_its_full_instructions() -> None:
    result = await ServerTools()("skills.load", {"name": "dashboard-binding"})
    assert isinstance(result, dict)
    assert result["ok"] is True
    assert "## 工作顺序" in str(result["instructions"])


async def test_loading_an_unknown_skill_answers_instead_of_failing() -> None:
    # 模型多半是把名字记岔了，告诉它没有这个比让这一步失败有用
    result = await ServerTools()("skills.load", {"name": "no-such-skill"})
    assert isinstance(result, dict)
    assert result["ok"] is False


async def test_an_unknown_tool_name_is_refused_loudly() -> None:
    with pytest.raises(UnknownServerTool):
        await ServerTools()("nothing.like_this", {})
