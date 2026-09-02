"""推进一个回合的入参。

⚠ 用户发话与工具回填**二选一**。同时给的话，模型会在同一轮里既看到一句新的
要求、又看到上一轮的反问回执——它多半会把两件事揉成一件做。
"""

from typing import Annotated, Any, Self

from pydantic import Field, model_validator

from knowledge_server.apps.chat.schemas.common import InputModel

# 一次回填最多带几条。对话面只有 `user.ask` 一个客户端工具，且它必须单独成批，
# 故实际永远是 1；留余量只为不把「多问了一句」判成 400
MAX_TOOL_RESULTS = 8
MAX_USER_TEXT = 4000
MAX_TOOL_OUTPUT_CHARS = 8_000


class ToolResultIn(InputModel):
    """浏览器跑完一个客户端工具（反问）之后带回来的东西。"""

    # ⚠ 必须是模型给的那个 id 逐字原样：对不上的话，模型看到的是「我问了 A，
    # 回来的是 B 的答案」
    call_id: str = Field(min_length=1, max_length=128)
    output: Any = None
    error: str | None = Field(default=None, max_length=1000)


class ChatAdvanceIn(InputModel):
    """推进一个回合。"""

    user_text: str | None = Field(default=None, max_length=MAX_USER_TEXT)
    tool_results: list[ToolResultIn] = Field(
        default_factory=list[ToolResultIn], max_length=MAX_TOOL_RESULTS
    )
    # 这一页实现了哪些客户端工具（前端自报）。⚠ 对话页只会报 `user.ask`；
    # 没报的模型看不见，于是它只能在正文里问——那正是设计里不许的自由文本反问
    client_tools: list[Annotated[str, Field(min_length=1, max_length=64)]] = (
        Field(default_factory=list[str], max_length=8)
    )

    @model_validator(mode="after")
    def check_exactly_one_source(self) -> Self:
        """发话与回填二选一，且必须有一个。"""
        has_text = self.user_text is not None
        has_results = bool(self.tool_results)
        if has_text == has_results:
            raise ValueError("user_text 与 tool_results 必须二选一")
        return self
